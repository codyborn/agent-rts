import {
  Directive,
  DirectiveType,
  GameEventType,
  GridPosition,
  UnitType,
  UnitBehaviorState,
  ResourceType,
  BuildingType,
  positionToLabel,
  FogState,
  UNIT_STATS,
} from '../shared/types';
import { EventBus } from '../engine/EventBus';
import { UnitManager } from '../units/UnitManager';
import { GameMap } from '../map/GameMap';
import { FogOfWar } from '../map/FogOfWar';
import { ResourceManager } from '../resources/ResourceManager';
import { GameState } from '../engine/GameState';

// ============================================================
// StrategicCommander - Event-driven batch AI coordinator
//
// LLM calls happen ONLY when the situation meaningfully changes:
//   1. Player issues a command (highest priority)
//   2. New enemy comes into vision for the first time
//   3. New resource tiles are discovered
//   4. One of our units is destroyed
//   5. A building finishes construction
//   6. Periodic heartbeat (~2 min) as a safety net
//
// Everything else is handled autonomously by the DirectiveExecutor.
// ============================================================

/** Periodic heartbeat interval — safety net re-evaluation (~2 min at 10 tps). */
const HEARTBEAT_INTERVAL = 1200;

/** Minimum gap between any two evaluations (~20s at 10 tps). */
const MIN_EVALUATION_GAP = 200;

/** Player commands bypass the normal min gap and use this shorter one (~3s). */
const PLAYER_COMMAND_GAP = 30;

/** Default TTL for directives — long-lived so they don't churn (~2 min). */
const DEFAULT_DIRECTIVE_TTL = 1200;

/** How often (ticks) we scan fog for newly discovered enemies/resources. */
const WORLD_SCAN_INTERVAL = 20;

export class StrategicCommander {
  private readonly playerId: string;
  private readonly eventBus: EventBus;
  private readonly unitManager: UnitManager;
  private readonly gameMap: GameMap;
  private readonly fogOfWar: FogOfWar;
  private readonly resourceManager: ResourceManager;
  private readonly gameState: GameState;

  private directives: Map<string, Directive> = new Map();
  private lastEvalTick = 0;
  private evaluating = false;
  private llmEnabled = true;

  // ---- Event-driven trigger state ----
  private pendingPlayerCommand = false;
  private pendingWorldChange = false;
  /** The freshly issued command (cleared after one evaluation). */
  private currentPlayerCommand: string | null = null;
  private commandTargetUnitIds: string[] = [];
  private hasReceivedCommand = false;
  /** Description of what triggered the evaluation (included in prompt). */
  private triggerReason: string | null = null;

  /**
   * Per-unit standing orders from the player. These persist across
   * evaluations and are included in every prompt so the LLM never
   * forgets what the player asked for. Only cleared when the player
   * gives a unit a new command.
   */
  private standingOrders: Map<string, string> = new Map();

  // ---- World knowledge (for diffing) ----
  /** Enemy unit IDs we've already reported to the LLM. */
  private knownEnemyIds: Set<string> = new Set();
  /** Resource tile keys ("col,row") we've already reported. */
  private knownResourceKeys: Set<string> = new Set();
  /** Last tick we scanned the fog for new discoveries. */
  private lastWorldScanTick = 0;

  constructor(
    playerId: string,
    eventBus: EventBus,
    unitManager: UnitManager,
    gameMap: GameMap,
    fogOfWar: FogOfWar,
    resourceManager: ResourceManager,
    gameState: GameState,
  ) {
    this.playerId = playerId;
    this.eventBus = eventBus;
    this.unitManager = unitManager;
    this.gameMap = gameMap;
    this.fogOfWar = fogOfWar;
    this.resourceManager = resourceManager;
    this.gameState = gameState;

    this.subscribeToEvents();
  }

  private subscribeToEvents(): void {
    // Player commands — highest priority trigger
    this.eventBus.on(GameEventType.PLAYER_COMMAND, (data: any) => {
      this.pendingPlayerCommand = true;
      this.hasReceivedCommand = true;
      if (data?.transcript) {
        this.currentPlayerCommand = data.transcript;
      }
    });

    this.eventBus.on(GameEventType.UNIT_COMMAND, (data: any) => {
      if (data?.type === 'voice' && data?.payload?.transcript) {
        this.pendingPlayerCommand = true;
        this.hasReceivedCommand = true;
        this.currentPlayerCommand = data.payload.transcript;
        this.commandTargetUnitIds = Array.isArray(data.targetUnitIds)
          ? [...data.targetUnitIds]
          : [];

        // Persist as standing orders for each targeted unit
        const transcript = data.payload.transcript as string;
        for (const id of this.commandTargetUnitIds) {
          this.standingOrders.set(id, transcript);
        }
      }
    });

    // Our unit destroyed — meaningful strategic event
    this.eventBus.on(GameEventType.UNIT_DESTROYED, (data: any) => {
      const unit = data?.unit ?? data;
      if (unit?.playerId === this.playerId) {
        this.pendingWorldChange = true;
        this.triggerReason = `Our ${unit.type ?? 'unit'} was destroyed`;
      }
    });

    // Building completed — unlocks new capabilities
    this.eventBus.on(GameEventType.BUILDING_COMPLETED, (data: any) => {
      if (data?.playerId === this.playerId) {
        this.pendingWorldChange = true;
        this.triggerReason = `${data.buildingType ?? 'Building'} completed`;
      }
    });

    // NOTE: We intentionally do NOT subscribe to UNIT_DAMAGED, ENEMY_SPOTTED,
    // or RESOURCE_DEPLETED here. Those fire too frequently. Instead we do a
    // periodic fog scan (every ~2s) to detect genuinely new discoveries.
  }

  // ---- Public API ----

  shouldEvaluate(tick: number): boolean {
    if (this.evaluating) return false;

    // Player command — always allowed (use shorter gap)
    if (this.pendingPlayerCommand) {
      const gap = tick - this.lastEvalTick;
      return gap >= PLAYER_COMMAND_GAP;
    }

    // No command has ever been given — stay idle, ignore all other triggers
    if (!this.hasReceivedCommand) return false;

    const gap = tick - this.lastEvalTick;
    if (gap < MIN_EVALUATION_GAP) return false;

    // World change (new enemy, new resource, unit lost, building done)
    if (this.pendingWorldChange) return true;

    // Periodic heartbeat
    if (gap >= HEARTBEAT_INTERVAL) return true;

    return false;
  }

  /**
   * Periodic scan of the fog of war to detect new enemies and resources
   * entering our vision. Called from AISystem.update() every tick but
   * internally throttled to run every WORLD_SCAN_INTERVAL ticks.
   */
  scanForDiscoveries(tick: number): void {
    if (tick - this.lastWorldScanTick < WORLD_SCAN_INTERVAL) return;
    this.lastWorldScanTick = tick;

    // Check for new enemies in vision
    const allUnits = this.unitManager.getAllUnits();
    const newEnemies: string[] = [];
    for (const u of allUnits) {
      if (u.playerId === this.playerId || !u.isAlive()) continue;
      if (this.knownEnemyIds.has(u.id)) continue;
      if (this.fogOfWar.isVisible(this.playerId, u.position)) {
        this.knownEnemyIds.add(u.id);
        newEnemies.push(`${u.type} at ${positionToLabel(u.position)}`);
      }
    }

    // Check for new resource tiles in explored/visible fog
    const grid = this.fogOfWar.getFogGrid(this.playerId);
    const newResources: string[] = [];
    if (grid) {
      for (let row = 0; row < grid.length; row++) {
        for (let col = 0; col < (grid[row]?.length ?? 0); col++) {
          if (grid[row][col] === FogState.UNEXPLORED) continue;
          const key = `${col},${row}`;
          if (this.knownResourceKeys.has(key)) continue;
          const tile = this.gameMap.getTile({ col, row });
          if (tile?.resource && tile.resourceAmount > 0) {
            this.knownResourceKeys.add(key);
            newResources.push(`${tile.resource} at ${positionToLabel({ col, row })}`);
          }
        }
      }
    }

    // Only trigger if there are genuinely new discoveries
    if (newEnemies.length > 0) {
      this.pendingWorldChange = true;
      this.triggerReason = `New enemies discovered: ${newEnemies.join(', ')}`;
      console.log(`[Commander] ${this.triggerReason}`);
    } else if (newResources.length > 0 && !this.pendingWorldChange) {
      // Resources are lower priority — only trigger if nothing else is pending
      // and we found a significant number (batch small discoveries)
      if (newResources.length >= 3) {
        this.pendingWorldChange = true;
        this.triggerReason = `New resources discovered: ${newResources.slice(0, 3).join(', ')}`;
        console.log(`[Commander] ${this.triggerReason}`);
      }
    }
  }

  async evaluate(tick: number): Promise<void> {
    this.evaluating = true;
    this.pendingPlayerCommand = false;
    this.pendingWorldChange = false;
    this.lastEvalTick = tick;

    const reason = this.currentPlayerCommand
      ? `Player command: "${this.currentPlayerCommand}"`
      : this.triggerReason ?? 'Periodic heartbeat';

    try {
      const prompt = this.buildBatchPerception(tick, reason);
      console.log(`[Commander] Evaluating (${reason})`, { tick, promptLength: prompt.length });

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      try {
        const res = await fetch('/api/command', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ perception: prompt }),
          signal: controller.signal,
        });

        if (!res.ok) {
          if (res.status === 503) {
            this.llmEnabled = false;
            console.warn('[Commander] LLM not configured, using default directives');
          }
          this.assignDefaultDirectives(tick);
          return;
        }

        const data = await res.json() as {
          directives: Array<{
            unitId: string;
            type: string;
            target?: { col: number; row: number };
            targetUnitId?: string;
            buildingType?: string;
            resourceType?: string;
            priority?: number;
            reasoning?: string;
          }>;
        };

        this.applyDirectives(data.directives, tick);
      } catch {
        console.warn('[Commander] LLM call failed, using default directives');
        this.assignDefaultDirectives(tick);
      } finally {
        clearTimeout(timeout);
      }
    } finally {
      this.evaluating = false;
      this.currentPlayerCommand = null;
      this.commandTargetUnitIds = [];
      this.triggerReason = null;
    }
  }

  getDirective(unitId: string): Directive | undefined {
    return this.directives.get(unitId);
  }

  /**
   * Directives persist until explicitly replaced by a new LLM evaluation.
   * No time-based expiry — the Commander only changes directives when
   * the situation meaningfully changes (player command, new discoveries, etc.).
   */
  tickDirectives(_tick: number): void {
    // Intentionally no TTL-based expiry. Directives are only replaced
    // when a new evaluate() call issues fresh ones.
  }

  isLLMEnabled(): boolean {
    return this.llmEnabled;
  }

  // ---- Perception building ----

  private buildBatchPerception(tick: number, reason: string): string {
    const lines: string[] = [];
    const resources = this.resourceManager.getResources(this.playerId);
    const exploredPct = this.getExploredPercentage();

    lines.push(`Map: ${this.gameMap.width}x${this.gameMap.height} (0-indexed: col 0-${this.gameMap.width - 1}, row 0-${this.gameMap.height - 1}). Top-left=(0,0) Bottom-right=(${this.gameMap.width - 1},${this.gameMap.height - 1}). Use these numbers for target col/row.`);
    lines.push(`Tick: ${tick} | Minerals: ${resources.minerals} | Energy: ${resources.energy} | Explored: ${exploredPct}%`);
    lines.push(`Trigger: ${reason}`);
    lines.push('');

    // Units — include current directive and standing player orders
    lines.push('UNITS:');
    const playerUnits = this.unitManager.getUnitsForPlayer(this.playerId);
    for (const unit of playerUnits) {
      if (!unit.isAlive()) continue;
      const hpPct = Math.round((unit.health / UNIT_STATS[unit.type].maxHealth) * 100);
      const label = positionToLabel(unit.position);
      const carrying = unit.carryingAmount > 0
        ? ` carrying:${unit.carryingType}(${unit.carryingAmount})`
        : '';
      const currentDirective = this.directives.get(unit.id);
      const directiveStr = currentDirective && !currentDirective.completed
        ? ` [${currentDirective.type}]`
        : ' [idle]';
      const standing = this.standingOrders.get(unit.id);
      const orderStr = standing ? ` ORDER="${standing}"` : '';
      lines.push(`- ${unit.id} ${unit.type.toUpperCase()} @${label} hp:${hpPct}%${directiveStr}${orderStr}${carrying}`);
    }
    lines.push('');

    // Enemies (visible)
    const allUnits = this.unitManager.getAllUnits();
    const enemies = allUnits.filter(u =>
      u.playerId !== this.playerId &&
      u.isAlive() &&
      this.fogOfWar.isVisible(this.playerId, u.position)
    );
    if (enemies.length > 0) {
      lines.push('ENEMIES:');
      for (const e of enemies) {
        const hpPct = Math.round((e.health / UNIT_STATS[e.type].maxHealth) * 100);
        lines.push(`- ${e.type} @${positionToLabel(e.position)} hp:${hpPct}%`);
      }
    } else {
      lines.push('ENEMIES: none visible');
    }
    lines.push('');

    // Resources (visible tiles with resources)
    const resourceTiles = this.getVisibleResourceTiles();
    if (resourceTiles.length > 0) {
      lines.push('RESOURCES:');
      const summaries = resourceTiles.slice(0, 10).map(r =>
        `${positionToLabel(r.position)}(${r.type})`
      );
      lines.push(`- ${summaries.join(' ')}`);
    } else {
      lines.push('RESOURCES: none visible');
    }
    lines.push('');

    // Buildings
    const buildings = this.gameState.getAllBuildings().filter(b => b.playerId === this.playerId);
    if (buildings.length > 0) {
      lines.push('BUILDINGS:');
      for (const b of buildings) {
        const constructing = b.isConstructing ? ` (${Math.round(b.constructionProgress * 100)}%)` : '';
        lines.push(`- ${b.type}@${positionToLabel(b.position)}${constructing}`);
      }
      lines.push('');
    }

    // Fresh player command (just issued this evaluation)
    if (this.currentPlayerCommand) {
      if (this.commandTargetUnitIds.length > 0) {
        lines.push(`NEW COMMAND (to ${this.commandTargetUnitIds.join(', ')}): "${this.currentPlayerCommand}"`);
        lines.push('Issue new directives for the commanded units. Do not change other units.');
      } else {
        lines.push(`NEW COMMAND (to all): "${this.currentPlayerCommand}"`);
      }
      lines.push('');
    }

    // Reminder: standing orders MUST be respected
    const unitsWithOrders = playerUnits.filter(u => u.isAlive() && this.standingOrders.has(u.id));
    if (unitsWithOrders.length > 0) {
      lines.push('STANDING ORDERS (these are player commands — always respect them):');
      for (const unit of unitsWithOrders) {
        lines.push(`- ${unit.id}: "${this.standingOrders.get(unit.id)}"`);
      }
      lines.push('Directives MUST align with the standing orders above. Do not override player intent.');
      lines.push('');
    }

    return lines.join('\n');
  }

  private getExploredPercentage(): number {
    const grid = this.fogOfWar.getFogGrid(this.playerId);
    if (!grid) return 0;
    let explored = 0;
    let total = 0;
    for (const row of grid) {
      for (const cell of row) {
        total++;
        if (cell !== FogState.UNEXPLORED) explored++;
      }
    }
    return total > 0 ? Math.round((explored / total) * 100) : 0;
  }

  private getVisibleResourceTiles(): Array<{ position: GridPosition; type: ResourceType }> {
    const results: Array<{ position: GridPosition; type: ResourceType }> = [];
    const grid = this.fogOfWar.getFogGrid(this.playerId);
    if (!grid) return results;

    for (let row = 0; row < grid.length; row++) {
      for (let col = 0; col < (grid[row]?.length ?? 0); col++) {
        if (grid[row][col] === FogState.VISIBLE || grid[row][col] === FogState.EXPLORED) {
          const tile = this.gameMap.getTile({ col, row });
          if (tile?.resource && tile.resourceAmount > 0) {
            results.push({ position: { col, row }, type: tile.resource });
          }
        }
      }
    }
    return results;
  }

  // ---- Directive management ----

  private applyDirectives(
    raw: Array<{
      unitId: string;
      type: string;
      target?: { col: number; row: number };
      targetUnitId?: string;
      buildingType?: string;
      resourceType?: string;
      priority?: number;
      reasoning?: string;
    }>,
    tick: number,
  ): void {
    for (const d of raw) {
      const unit = this.unitManager.getUnit(d.unitId);
      if (!unit || unit.playerId !== this.playerId || !unit.isAlive()) continue;

      const directiveType = this.parseDirectiveType(d.type);
      if (!directiveType) continue;

      // Units without a standing order (never commanded by the player) must
      // stay IDLE. The LLM sometimes assigns gather/explore to uncommanded
      // units during heartbeat evaluations — reject those.
      if (!this.standingOrders.has(d.unitId) && directiveType !== DirectiveType.IDLE) {
        this.directives.delete(d.unitId);
        console.log(`[Commander] Rejected ${directiveType} for ${d.unitId} (no standing order)`);
        continue;
      }

      const directive: Directive = {
        unitId: d.unitId,
        type: directiveType,
        targetPosition: d.target ? this.clampPosition(d.target) : undefined,
        targetUnitId: d.targetUnitId,
        buildingType: d.buildingType as BuildingType | undefined,
        resourceType: d.resourceType as ResourceType | undefined,
        priority: d.priority ?? 3,
        reasoning: d.reasoning,
        createdAtTick: tick,
        ttl: DEFAULT_DIRECTIVE_TTL,
        completed: false,
      };

      this.directives.set(d.unitId, directive);
      unit.lastThought = `[Directive] ${directive.type}${directive.reasoning ? ': ' + directive.reasoning : ''}`;
      console.log(`[Commander] ${d.unitId} -> ${directive.type}${d.reasoning ? ': ' + d.reasoning : ''}`);
    }

    // Only assign idle defaults for units that have NO directive at all
    const playerUnits = this.unitManager.getUnitsForPlayer(this.playerId);
    for (const unit of playerUnits) {
      if (!unit.isAlive()) continue;
      if (!this.directives.has(unit.id)) {
        this.assignDefaultForUnit(unit.id, unit.type, tick);
      }
    }
  }

  assignDefaultDirectives(tick: number): void {
    const playerUnits = this.unitManager.getUnitsForPlayer(this.playerId);
    for (const unit of playerUnits) {
      if (!unit.isAlive()) continue;
      if (!this.directives.has(unit.id)) {
        this.assignDefaultForUnit(unit.id, unit.type, tick);
      }
    }
  }

  private assignDefaultForUnit(unitId: string, _unitType: UnitType, tick: number): void {
    const directive: Directive = {
      unitId,
      type: DirectiveType.IDLE,
      priority: 1,
      reasoning: 'Awaiting orders',
      createdAtTick: tick,
      ttl: DEFAULT_DIRECTIVE_TTL,
      completed: false,
    };

    this.directives.set(unitId, directive);

    const unit = this.unitManager.getUnit(unitId);
    if (unit) {
      unit.lastThought = 'Awaiting orders';
    }
  }

  private clampPosition(pos: { col: number; row: number }): GridPosition {
    return {
      col: Math.max(0, Math.min(this.gameMap.width - 1, Math.round(pos.col))),
      row: Math.max(0, Math.min(this.gameMap.height - 1, Math.round(pos.row))),
    };
  }

  private parseDirectiveType(type: string): DirectiveType | null {
    const normalized = type.toLowerCase().replace(/[\s-]/g, '_');
    const values = Object.values(DirectiveType) as string[];
    if (values.includes(normalized)) {
      return normalized as DirectiveType;
    }
    return null;
  }
}
