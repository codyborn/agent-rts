import { GameEngine, System } from '../engine/GameEngine';
import { EventBus } from '../engine/EventBus';
import { UnitManager } from '../units/UnitManager';
import { GameMap } from '../map/GameMap';
import { findPath } from '../map/Pathfinding';
import { AgentController } from '../ai/AgentController';
import { UnitBrain } from '../ai/UnitBrain';
import { Communication } from '../ai/Communication';
import { StrategicCommander } from '../ai/StrategicCommander';
import { DirectiveExecutor } from '../ai/DirectiveExecutor';
import { Unit } from '../units/Unit';
import {
  UnitBehaviorState,
  UnitAction,
  UNIT_STATS,
  UNIT_COMMUNICATION_RANGE,
  GameEventType,
  GridPosition,
  TerrainType,
  gridDistance,
} from '../shared/types';

// ============================================================
// AISystem - Wires UnitBrain and AgentController into the game
// loop so that units think and act autonomously each tick.
//
// Each alive unit is given a UnitBrain (lazily created). The
// brain periodically builds a perception of the world and asks
// the AgentController for an action. The system then translates
// that action into concrete state mutations on the unit (path
// assignment, behavior state changes, communication, etc.).
//
// Actions are only executed when the unit is IDLE or has
// finished its current activity. Units in the middle of
// gathering, attacking, or building are not interrupted unless
// they receive a new player command.
// ============================================================

/** Ticks between stale-message cleanup passes. */
const MESSAGE_CLEANUP_INTERVAL = 100;

/** How far back (in ticks) to retain messages. */
const MESSAGE_RETENTION_TICKS = 200;

/** How far (tiles) to scan for nearby resources when emitting proximity events. */
const RESOURCE_SCAN_RANGE = 3;

export class AISystem implements System {
  private readonly unitManager: UnitManager;
  private readonly gameMap: GameMap;
  private readonly agentController: AgentController;
  private readonly communication: Communication;
  private readonly commander: StrategicCommander | null;
  private readonly directiveExecutor: DirectiveExecutor | null;
  private readonly localPlayerId: string;

  /** Lazily populated map of unit ID to its UnitBrain instance. */
  private brains: Map<string, UnitBrain> = new Map();

  /** Track in-flight think requests to prevent duplicate concurrent calls. */
  private inFlight: Set<string> = new Set();

  /** Reference to the event bus, stored during init(). */
  private eventBus: EventBus | null = null;

  /** Per-unit tracking to avoid spamming proximity events every tick. */
  private lastNotifiedResource: Map<string, string> = new Map(); // unitId -> "col,row"
  private lastNotifiedEnemy: Map<string, string> = new Map(); // unitId -> enemyId

  constructor(
    unitManager: UnitManager,
    gameMap: GameMap,
    agentController: AgentController,
    communication: Communication,
    commander?: StrategicCommander,
    directiveExecutor?: DirectiveExecutor,
    localPlayerId: string = '0',
  ) {
    this.unitManager = unitManager;
    this.gameMap = gameMap;
    this.agentController = agentController;
    this.communication = communication;
    this.commander = commander ?? null;
    this.directiveExecutor = directiveExecutor ?? null;
    this.localPlayerId = localPlayerId;
  }

  // ---- System interface ----

  init(engine: GameEngine): void {
    this.eventBus = engine.eventBus;

    // Clean up tracking state when a unit is destroyed
    this.eventBus.on(GameEventType.UNIT_DESTROYED, (data: any) => {
      const unitId: string | undefined = data?.unit?.id ?? data?.unitId;
      if (!unitId) return;
      this.directiveExecutor?.clearUnit(unitId);
      this.lastNotifiedResource.delete(unitId);
      this.lastNotifiedEnemy.delete(unitId);
      this.brains.delete(unitId);
      this.inFlight.delete(unitId);
    });
  }

  update(tick: number, _deltaTime: number): void {
    // Step 0: Strategic Commander — scan for new discoveries, tick directives, evaluate if needed
    if (this.commander && this.directiveExecutor) {
      this.commander.scanForDiscoveries(tick);
      this.commander.tickDirectives(tick);

      if (this.commander.shouldEvaluate(tick)) {
        this.commander.evaluate(tick).catch(err => {
          console.error('[AISystem] Commander evaluate() failed:', err);
        });
      }
    }

    // Emit proximity events for MOVING local player units (wake system)
    if (this.eventBus) {
      this.emitProximityEvents();
    }

    const allUnits = this.unitManager.getAllUnits();

    for (const unit of allUnits) {
      if (!unit.isAlive()) continue;

      // Local player units: use Commander + DirectiveExecutor if available
      if (this.commander && this.directiveExecutor && unit.playerId === this.localPlayerId) {
        const directive = this.commander.getDirective(unit.id);
        if (directive && !directive.completed) {
          const action = this.directiveExecutor.execute(unit, directive);
          if (action) {
            this.tryExecuteAction(unit, action, tick);
          }
        }
        continue;
      }

      // Enemy units (and local player units if no Commander): use UnitBrain
      const brain = this.getOrCreateBrain(unit);

      if (brain.shouldThink(tick) && !this.inFlight.has(unit.id)) {
        this.thinkForUnit(unit, brain, tick);
      }

      const pendingAction = brain.getPendingAction();
      if (pendingAction) {
        this.tryExecuteAction(unit, pendingAction, tick);
      }
    }

    // Periodic cleanup of old messages to bound memory usage.
    if (tick > 0 && tick % MESSAGE_CLEANUP_INTERVAL === 0) {
      this.communication.cleanupOldMessages(tick - MESSAGE_RETENTION_TICKS);
    }
  }

  // ---- Brain management ----

  /**
   * Returns the existing UnitBrain for the given unit, or creates
   * one if this is the first time the unit has been encountered.
   */
  private getOrCreateBrain(unit: Unit): UnitBrain {
    let brain = this.brains.get(unit.id);
    if (!brain) {
      brain = new UnitBrain(unit.id, unit.type, unit.playerId, this.agentController);
      this.brains.set(unit.id, brain);
    }
    return brain;
  }

  // ---- Perception & thinking ----

  /**
   * Build the perception data for a unit and invoke brain.think().
   * The think() call is async but resolves immediately for the
   * rule-based AI stub, so we fire-and-forget here.
   */
  private thinkForUnit(unit: Unit, brain: UnitBrain, tick: number): void {
    const unitState = unit.toState();
    const stats = UNIT_STATS[unit.type];

    // Visible units: all units within this unit's vision range.
    const nearbyUnits = this.unitManager.getUnitsInRange(
      unit.position,
      stats.visionRange,
    );
    const visibleUnits = nearbyUnits
      .filter((u) => u.id !== unit.id)
      .map((u) => ({
        id: u.id,
        type: u.type,
        position: { col: u.position.col, row: u.position.row },
        playerId: u.playerId,
        health: u.health,
        maxHealth: UNIT_STATS[u.type].maxHealth,
      }));

    // Visible terrain: tiles within the unit's vision range.
    const visibleTerrain = this.getTilesInRange(unit.position, stats.visionRange);

    // Messages received since the last think interval.
    const sinceTick = Math.max(0, tick - brain['thinkInterval']);
    const messages = this.communication.getMessagesForUnit(unit.id, sinceTick);

    this.inFlight.add(unit.id);
    brain
      .think(unitState, visibleUnits, visibleTerrain, messages, tick)
      .catch((err) => {
        console.error(`[AISystem] think() failed for unit ${unit.id}:`, err);
      })
      .finally(() => {
        this.inFlight.delete(unit.id);
      });
  }

  /**
   * Collect all map tiles within a given radius of a position.
   * Returns an array of { position, terrain, resource } objects
   * suitable for passing to UnitBrain.think().
   */
  private getTilesInRange(
    center: GridPosition,
    range: number,
  ): Array<{ position: GridPosition; terrain: TerrainType; resource: string | null }> {
    const tiles: Array<{ position: GridPosition; terrain: TerrainType; resource: string | null }> = [];
    const rangeInt = Math.ceil(range);

    for (let dr = -rangeInt; dr <= rangeInt; dr++) {
      for (let dc = -rangeInt; dc <= rangeInt; dc++) {
        // Use Euclidean distance to match the circular vision range.
        if (Math.sqrt(dc * dc + dr * dr) > range) continue;

        const pos: GridPosition = {
          col: center.col + dc,
          row: center.row + dr,
        };

        const tile = this.gameMap.getTile(pos);
        if (!tile) continue;

        tiles.push({
          position: pos,
          terrain: tile.terrain,
          resource: tile.resource,
        });
      }
    }

    return tiles;
  }

  // ---- Proximity event emission (wake system) ----

  /**
   * For each MOVING local player unit, check if there are nearby
   * resources or enemies and emit events so the DirectiveExecutor
   * can wake the unit for re-evaluation.
   */
  private emitProximityEvents(): void {
    for (const unit of this.unitManager.getUnitsForPlayer(this.localPlayerId)) {
      if (!unit.isAlive()) continue;
      if (unit.behaviorState !== UnitBehaviorState.MOVING) {
        // Clear stale tracking when no longer moving
        this.lastNotifiedResource.delete(unit.id);
        this.lastNotifiedEnemy.delete(unit.id);
        continue;
      }

      // Check nearby resources (within RESOURCE_SCAN_RANGE tiles)
      const nearestResource = this.gameMap.findNearestAnyResource(unit.position, RESOURCE_SCAN_RANGE);
      if (nearestResource) {
        const key = `${nearestResource.col},${nearestResource.row}`;
        if (this.lastNotifiedResource.get(unit.id) !== key) {
          this.lastNotifiedResource.set(unit.id, key);
          this.eventBus!.emit(GameEventType.RESOURCE_NEARBY, {
            unitId: unit.id,
            position: nearestResource,
          });
        }
      }

      // Check nearby enemies (within vision range)
      const stats = UNIT_STATS[unit.type];
      const nearbyUnits = this.unitManager.getUnitsInRange(unit.position, stats.visionRange);
      let nearestEnemy: { id: string; position: GridPosition; distance: number } | null = null;
      for (const candidate of nearbyUnits) {
        if (candidate.playerId === unit.playerId || !candidate.isAlive()) continue;
        const dist = gridDistance(unit.position, candidate.position);
        if (!nearestEnemy || dist < nearestEnemy.distance) {
          nearestEnemy = { id: candidate.id, position: candidate.position, distance: dist };
        }
      }
      if (nearestEnemy && this.lastNotifiedEnemy.get(unit.id) !== nearestEnemy.id) {
        this.lastNotifiedEnemy.set(unit.id, nearestEnemy.id);
        this.eventBus!.emit(GameEventType.ENEMY_NEARBY, {
          unitId: unit.id,
          enemyId: nearestEnemy.id,
          position: { col: nearestEnemy.position.col, row: nearestEnemy.position.row },
        });
      }
    }
  }

  // ---- Action execution ----

  /**
   * Attempt to execute an action on a unit. Actions are only applied
   * when the unit is IDLE or has finished its current activity.
   * Units in the middle of gathering, attacking, or building are not
   * interrupted -- they must finish or be explicitly stopped by a
   * new player command first.
   */
  private tryExecuteAction(unit: Unit, action: UnitAction, tick: number): void {
    if (!this.canAcceptNewAction(unit)) {
      return;
    }

    unit.lastThought = action.details
      ? `${action.type}: ${action.details}`
      : action.type;

    switch (action.type) {
      case 'move':
        this.executeMove(unit, action);
        break;

      case 'gather':
        this.executeGather(unit, action);
        break;

      case 'attack':
        this.executeAttack(unit, action);
        break;

      case 'build':
        this.executeBuild(unit);
        break;

      case 'communicate':
        this.executeCommunicate(unit, action, tick);
        break;

      case 'idle':
        unit.behaviorState = UnitBehaviorState.IDLE;
        break;

      default:
        // Unknown action type -- treat as idle.
        break;
    }

    unit.lastActionTick = tick;
  }

  /**
   * A unit can accept a new action if it is IDLE or MOVING (moving
   * can be freely re-routed). Units that are mid-gather, mid-attack,
   * or mid-build should not be interrupted by AI decisions -- only a
   * fresh player command (which resets behaviorState externally)
   * should break them out.
   */
  private canAcceptNewAction(unit: Unit): boolean {
    return (
      unit.behaviorState === UnitBehaviorState.IDLE ||
      unit.behaviorState === UnitBehaviorState.MOVING
    );
  }

  // ---- Individual action handlers ----

  private executeMove(unit: Unit, action: UnitAction): void {
    if (!action.target) return;

    const path = findPath(unit.position, action.target, this.gameMap, unit.type);
    if (path.length > 0) {
      unit.setPath(path);
      unit.behaviorState = UnitBehaviorState.MOVING;
    }
  }

  private executeGather(unit: Unit, action: UnitAction): void {
    if (!action.target) return;

    unit.behaviorState = UnitBehaviorState.GATHERING;
    unit.gatherTarget = { col: action.target.col, row: action.target.row };

    // Pathfind to the gather target so the unit walks there first.
    const path = findPath(unit.position, action.target, this.gameMap, unit.type);
    if (path.length > 0) {
      unit.setPath(path);
    }
  }

  private executeAttack(unit: Unit, action: UnitAction): void {
    if (!action.targetUnitId) return;

    unit.behaviorState = UnitBehaviorState.ATTACKING;
    unit.attackTargetId = action.targetUnitId;
  }

  private executeBuild(unit: Unit): void {
    unit.behaviorState = UnitBehaviorState.BUILDING;
  }

  private executeCommunicate(unit: Unit, action: UnitAction, tick: number): void {
    if (!action.message) return;

    // Broadcast to nearby friendly units.
    const allUnits = this.unitManager.getAllUnits();
    this.communication.broadcastNearby(
      unit,
      action.message,
      UNIT_COMMUNICATION_RANGE,
      allUnits,
      tick,
    );

    // Also emit to the player's chat feed via the EventBus.
    if (this.eventBus) {
      this.eventBus.emit(GameEventType.UNIT_COMMUNICATION, {
        unitId: unit.id,
        unitType: unit.type,
        message: action.message,
        position: { col: unit.position.col, row: unit.position.row },
        tick,
      });
    }
  }
}
