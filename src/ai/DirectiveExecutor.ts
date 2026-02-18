import {
  Directive,
  DirectiveType,
  UnitAction,
  GridPosition,
  UnitBehaviorState,
  FogState,
  GameEventType,
  UNIT_STATS,
  positionToLabel,
  gridDistance,
} from '../shared/types';
import { Unit } from '../units/Unit';
import { UnitManager } from '../units/UnitManager';
import { GameMap } from '../map/GameMap';
import { FogOfWar } from '../map/FogOfWar';
import { EventBus } from '../engine/EventBus';

// ============================================================
// DirectiveExecutor - Translates high-level directives into
// concrete UnitActions each tick. Uses rule-based logic to
// autonomously pursue the directive's goal without needing
// further LLM calls.
// ============================================================

/** Maps directive types to the event types that should wake a MOVING unit. */
const WAKE_SUBSCRIPTIONS = new Map<DirectiveType, Set<GameEventType>>([
  [DirectiveType.GATHER_RESOURCES, new Set<GameEventType>([GameEventType.RESOURCE_NEARBY])],
  [DirectiveType.ATTACK_MOVE,      new Set<GameEventType>([GameEventType.ENEMY_NEARBY])],
  [DirectiveType.DEFEND_POSITION,  new Set<GameEventType>([GameEventType.ENEMY_NEARBY])],
  [DirectiveType.PATROL_AREA,      new Set<GameEventType>([GameEventType.ENEMY_NEARBY])],
  [DirectiveType.ESCORT,           new Set<GameEventType>([GameEventType.ENEMY_NEARBY])],
]);

export class DirectiveExecutor {
  private readonly unitManager: UnitManager;
  private readonly gameMap: GameMap;
  private readonly fogOfWar: FogOfWar;
  private readonly playerId: string;

  /** Per-unit exploration state for systematic coverage. */
  private exploreState: Map<string, { waypoints: GridPosition[]; index: number }> = new Map();

  /** Wake flags — set to true when a subscribed proximity event fires for this unit. */
  private wakeFlags: Map<string, boolean> = new Map();

  /** Directive cache for looking up a unit's current directive type in event handlers. */
  private activeDirectives: Map<string, DirectiveType> = new Map();

  constructor(unitManager: UnitManager, gameMap: GameMap, fogOfWar: FogOfWar, playerId: string, eventBus?: EventBus) {
    this.unitManager = unitManager;
    this.gameMap = gameMap;
    this.fogOfWar = fogOfWar;
    this.playerId = playerId;

    if (eventBus) {
      eventBus.on<{ unitId: string; position: GridPosition }>(GameEventType.RESOURCE_NEARBY, (data) => {
        this.handleProximityEvent(data.unitId, GameEventType.RESOURCE_NEARBY);
      });
      eventBus.on<{ unitId: string; enemyId: string; position: GridPosition }>(GameEventType.ENEMY_NEARBY, (data) => {
        this.handleProximityEvent(data.unitId, GameEventType.ENEMY_NEARBY);
      });
    }
  }

  /** Check if the unit's current directive subscribes to this event type, and set wake flag if so. */
  private handleProximityEvent(unitId: string, eventType: GameEventType): void {
    const directiveType = this.activeDirectives.get(unitId);
    if (!directiveType) return;
    const subscriptions = WAKE_SUBSCRIPTIONS.get(directiveType);
    if (subscriptions?.has(eventType)) {
      this.wakeFlags.set(unitId, true);
    }
  }

  /**
   * Given a unit and its active directive, produce a UnitAction
   * for this tick. Returns null if the unit is already busy and
   * shouldn't be interrupted — this is critical so we don't
   * re-pathfind every tick and blow away the unit's current path.
   */
  execute(unit: Unit, directive: Directive): UnitAction | null {
    // Track the unit's active directive type so event handlers can check subscriptions.
    this.activeDirectives.set(unit.id, directive.type);

    const { behaviorState } = unit;
    const isIdle = behaviorState === UnitBehaviorState.IDLE;
    const isMoving = behaviorState === UnitBehaviorState.MOVING;

    // If the unit is mid-gather, mid-attack, or mid-build, never interrupt.
    // It will go IDLE when done and we'll issue the next action then.
    if (!isIdle && !isMoving) return null;

    // If the unit is MOVING (following a path), check for interrupts.
    if (isMoving) {
      // Combat interrupt (highest priority)
      const combatAction = this.checkCombatInterrupt(unit, directive);
      if (combatAction) return combatAction;

      // Event-based wake: a subscribed proximity event fired for this unit
      if (this.wakeFlags.get(unit.id)) {
        this.wakeFlags.delete(unit.id);
        // Fall through to the IDLE handlers below to re-evaluate
      } else {
        return null; // Keep moving
      }
    }

    // Unit is IDLE (or woken from MOVING) — give it something to do.
    switch (directive.type) {
      case DirectiveType.GATHER_RESOURCES:
        return this.executeGather(unit, directive);
      case DirectiveType.EXPLORE_AREA:
        return this.executeExplore(unit, directive);
      case DirectiveType.DEFEND_POSITION:
        return this.executeDefend(unit, directive);
      case DirectiveType.ATTACK_MOVE:
        return this.executeAttackMove(unit, directive);
      case DirectiveType.PATROL_AREA:
        return this.executePatrol(unit, directive);
      case DirectiveType.BUILD_STRUCTURE:
        return this.executeBuild(unit, directive);
      case DirectiveType.RETREAT:
        return this.executeRetreat(unit, directive);
      case DirectiveType.ESCORT:
        return this.executeEscort(unit, directive);
      case DirectiveType.IDLE:
        return { type: 'idle', details: 'Holding position' };
      default:
        return null;
    }
  }

  /**
   * While a unit is MOVING, check if it should interrupt to fight.
   * Only combat-relevant directives (attack_move, defend, patrol, escort)
   * can interrupt movement — the rest let the unit finish its path.
   */
  private checkCombatInterrupt(unit: Unit, directive: Directive): UnitAction | null {
    const combatDirectives = [
      DirectiveType.ATTACK_MOVE,
      DirectiveType.DEFEND_POSITION,
      DirectiveType.PATROL_AREA,
      DirectiveType.ESCORT,
    ];
    if (!combatDirectives.includes(directive.type)) return null;

    const nearbyEnemies = this.getVisibleEnemies(unit);
    if (nearbyEnemies.length === 0) return null;

    const nearest = this.findClosestUnit(unit.position, nearbyEnemies);
    if (!nearest) return null;

    const dist = gridDistance(unit.position, nearest.position);
    if (dist <= UNIT_STATS[unit.type].attackRange + 2) {
      return {
        type: 'attack',
        targetUnitId: nearest.id,
        details: `Engaging ${nearest.type}`,
      };
    }

    return null;
  }

  // ---- Directive executors ----

  private executeGather(unit: Unit, directive: Directive): UnitAction | null {
    // If carrying resources, return to base
    if (unit.carryingAmount > 0 && unit.homeBase) {
      return {
        type: 'move',
        target: unit.homeBase,
        details: 'Returning resources to base',
      };
    }

    // If we have a specific target from the directive, go there
    if (directive.targetPosition) {
      const tile = this.gameMap.getTile(directive.targetPosition);
      if (tile?.resource && tile.resourceAmount > 0) {
        return {
          type: 'gather',
          target: directive.targetPosition,
          details: `Gathering ${tile.resource} at ${positionToLabel(directive.targetPosition)}`,
        };
      }
    }

    // Find nearest visible resource
    const nearestResource = this.gameMap.findNearestAnyResource(unit.position, 10);
    if (nearestResource) {
      return {
        type: 'gather',
        target: nearestResource,
        details: 'Gathering nearest resource',
      };
    }

    // No resources found, explore systematically to find some
    const target = this.findNearestUnexplored(unit.position);
    if (target) {
      return { type: 'move', target, details: 'Searching for resources' };
    }

    return { type: 'idle', details: 'No resources found' };
  }

  private executeExplore(unit: Unit, directive: Directive): UnitAction | null {
    // Check for nearby enemies to report
    const nearbyEnemies = this.getVisibleEnemies(unit);
    if (nearbyEnemies.length > 0) {
      const enemy = nearbyEnemies[0];
      return {
        type: 'communicate',
        message: `Enemy ${enemy.type} spotted at ${positionToLabel(enemy.position)}`,
        details: 'Reporting enemy position',
      };
    }

    // If directive has a target, go there first
    if (directive.targetPosition) {
      const dist = gridDistance(unit.position, directive.targetPosition);
      if (dist >= 2) {
        return {
          type: 'move',
          target: directive.targetPosition,
          details: `Exploring toward ${positionToLabel(directive.targetPosition)}`,
        };
      }
      // Reached directive target — clear it so we switch to systematic exploration
      directive.targetPosition = undefined;
    }

    // Systematic exploration: find nearest unexplored tile
    const target = this.findNearestUnexplored(unit.position);
    if (target) {
      return {
        type: 'move',
        target,
        details: `Exploring toward ${positionToLabel(target)}`,
      };
    }

    // Whole map explored — spiral outward from center to revisit
    const spiralTarget = this.getSpiralWaypoint(unit);
    return {
      type: 'move',
      target: spiralTarget,
      details: 'Scouting (full coverage)',
    };
  }

  private executeDefend(unit: Unit, directive: Directive): UnitAction | null {
    const defendPos = directive.targetPosition ?? unit.homeBase ?? unit.position;

    // Attack enemies in range
    const nearbyEnemies = this.getVisibleEnemies(unit);
    if (nearbyEnemies.length > 0) {
      const nearest = this.findClosestUnit(unit.position, nearbyEnemies);
      if (nearest) {
        const dist = gridDistance(unit.position, nearest.position);
        const attackRange = UNIT_STATS[unit.type].attackRange;

        if (dist <= attackRange + 2) {
          return {
            type: 'attack',
            targetUnitId: nearest.id,
            details: `Defending against ${nearest.type}`,
          };
        }
      }
    }

    // Move to defend position if not there
    const distToDefend = gridDistance(unit.position, defendPos);
    if (distToDefend > 3) {
      return {
        type: 'move',
        target: defendPos,
        details: 'Moving to defend position',
      };
    }

    return { type: 'idle', details: 'Holding defensive position' };
  }

  private executeAttackMove(unit: Unit, directive: Directive): UnitAction | null {
    // Engage enemies encountered
    const nearbyEnemies = this.getVisibleEnemies(unit);
    if (nearbyEnemies.length > 0) {
      const nearest = this.findClosestUnit(unit.position, nearbyEnemies);
      if (nearest) {
        return {
          type: 'attack',
          targetUnitId: nearest.id,
          details: `Engaging ${nearest.type} during attack move`,
        };
      }
    }

    // Move toward target
    const target = directive.targetPosition;
    if (target) {
      const dist = gridDistance(unit.position, target);
      if (dist >= 2) {
        return {
          type: 'move',
          target,
          details: 'Attack-moving to target',
        };
      }
      // Reached target but no enemies found — keep searching the area.
      // Explore nearby unexplored tiles so the unit continues hunting.
      const unexplored = this.findNearestUnexplored(unit.position);
      if (unexplored) {
        return {
          type: 'move',
          target: unexplored,
          details: 'Searching area for enemies',
        };
      }
    }

    // No target or fully explored — patrol outward from current position
    const spiralTarget = this.getSpiralWaypoint(unit);
    return {
      type: 'move',
      target: spiralTarget,
      details: 'Sweeping area for enemies',
    };
  }

  private executePatrol(unit: Unit, directive: Directive): UnitAction | null {
    // Attack enemies in range
    const nearbyEnemies = this.getVisibleEnemies(unit);
    if (nearbyEnemies.length > 0) {
      const nearest = this.findClosestUnit(unit.position, nearbyEnemies);
      if (nearest) {
        return {
          type: 'attack',
          targetUnitId: nearest.id,
          details: 'Engaging enemy during patrol',
        };
      }
    }

    // Patrol: move in a pattern around the target
    const center = directive.targetPosition ?? unit.homeBase ?? unit.position;
    const patrolRadius = 5;
    const angle = ((Date.now() / 5000) % (Math.PI * 2));
    const patrolTarget: GridPosition = {
      col: Math.max(0, Math.min(this.gameMap.width - 1, Math.round(center.col + Math.cos(angle) * patrolRadius))),
      row: Math.max(0, Math.min(this.gameMap.height - 1, Math.round(center.row + Math.sin(angle) * patrolRadius))),
    };

    return {
      type: 'move',
      target: patrolTarget,
      details: 'Patrolling area',
    };
  }

  private executeBuild(unit: Unit, directive: Directive): UnitAction | null {
    if (directive.targetPosition) {
      const dist = gridDistance(unit.position, directive.targetPosition);
      if (dist > 1) {
        return {
          type: 'move',
          target: directive.targetPosition,
          details: 'Moving to build site',
        };
      }
    }

    return {
      type: 'build',
      buildingType: directive.buildingType,
      target: directive.targetPosition,
      details: `Building ${directive.buildingType ?? 'structure'}`,
    };
  }

  private executeRetreat(unit: Unit, _directive: Directive): UnitAction | null {
    const target = unit.homeBase ?? { col: 2, row: 2 };
    const dist = gridDistance(unit.position, target);

    if (dist < 3) {
      return { type: 'idle', details: 'Reached safety' };
    }

    return {
      type: 'move',
      target,
      details: 'Retreating to base',
    };
  }

  private executeEscort(unit: Unit, directive: Directive): UnitAction | null {
    // Attack threats near the escort target
    const nearbyEnemies = this.getVisibleEnemies(unit);
    if (nearbyEnemies.length > 0) {
      const nearest = this.findClosestUnit(unit.position, nearbyEnemies);
      if (nearest) {
        const dist = gridDistance(unit.position, nearest.position);
        if (dist <= UNIT_STATS[unit.type].attackRange + 2) {
          return {
            type: 'attack',
            targetUnitId: nearest.id,
            details: 'Protecting escort target',
          };
        }
      }
    }

    // Follow target unit
    if (directive.targetUnitId) {
      const target = this.unitManager.getUnit(directive.targetUnitId);
      if (target && target.isAlive()) {
        const dist = gridDistance(unit.position, target.position);
        if (dist > 2) {
          return {
            type: 'move',
            target: target.position,
            details: `Escorting ${target.type}`,
          };
        }
        return { type: 'idle', details: 'Escorting (in position)' };
      }
    }

    // Fallback: move to target position
    if (directive.targetPosition) {
      return {
        type: 'move',
        target: directive.targetPosition,
        details: 'Moving to escort position',
      };
    }

    return { type: 'idle', details: 'No escort target' };
  }

  // ---- Exploration helpers ----

  /**
   * Find the nearest UNEXPLORED tile reachable from the unit's position.
   * Uses a BFS-like expanding ring search so we always pick the closest one.
   */
  private findNearestUnexplored(from: GridPosition): GridPosition | null {
    const grid = this.fogOfWar.getFogGrid(this.playerId);
    if (!grid) return null;

    const maxRadius = 20;
    for (let r = 1; r <= maxRadius; r++) {
      // Scan the ring at distance r
      for (let dr = -r; dr <= r; dr++) {
        for (let dc = -r; dc <= r; dc++) {
          // Only check the outer ring
          if (Math.abs(dr) !== r && Math.abs(dc) !== r) continue;

          const row = from.row + dr;
          const col = from.col + dc;
          if (row < 0 || row >= this.gameMap.height || col < 0 || col >= this.gameMap.width) continue;

          if (grid[row][col] === FogState.UNEXPLORED) {
            // Check the tile is walkable
            const tile = this.gameMap.getTile({ col, row });
            if (tile?.walkable) {
              return { col, row };
            }
          }
        }
      }
    }

    return null;
  }

  /**
   * Generate spiral waypoints for a unit when the whole map is explored.
   * Returns the next waypoint in a clockwise spiral from map center.
   */
  private getSpiralWaypoint(unit: Unit): GridPosition {
    let state = this.exploreState.get(unit.id);

    if (!state || state.index >= state.waypoints.length) {
      // Generate spiral waypoints from the unit's current position outward
      const waypoints = this.generateSpiralWaypoints(unit.position);
      state = { waypoints, index: 0 };
      this.exploreState.set(unit.id, state);
    }

    // Advance if we're close to the current waypoint
    const wp = state.waypoints[state.index];
    if (gridDistance(unit.position, wp) < 2) {
      state.index++;
      if (state.index >= state.waypoints.length) {
        state.index = 0; // loop the spiral
      }
    }

    return state.waypoints[state.index];
  }

  /**
   * Generate a clockwise spiral of waypoints covering the map.
   * Spacing of 8 tiles ensures vision ranges overlap for full coverage.
   */
  private generateSpiralWaypoints(center: GridPosition): GridPosition[] {
    const waypoints: GridPosition[] = [];
    const spacing = 8;
    const w = this.gameMap.width;
    const h = this.gameMap.height;
    const maxRing = Math.ceil(Math.max(w, h) / spacing);

    waypoints.push({ col: clamp(center.col, 0, w - 1), row: clamp(center.row, 0, h - 1) });

    for (let ring = 1; ring <= maxRing; ring++) {
      const dist = ring * spacing;
      // Top edge: left to right
      for (let dc = -dist; dc <= dist; dc += spacing) {
        addIfValid(center.col + dc, center.row - dist);
      }
      // Right edge: top to bottom
      for (let dr = -dist + spacing; dr <= dist; dr += spacing) {
        addIfValid(center.col + dist, center.row + dr);
      }
      // Bottom edge: right to left
      for (let dc = dist - spacing; dc >= -dist; dc -= spacing) {
        addIfValid(center.col + dc, center.row + dist);
      }
      // Left edge: bottom to top
      for (let dr = dist - spacing; dr >= -dist + spacing; dr -= spacing) {
        addIfValid(center.col - dist, center.row + dr);
      }
    }

    return waypoints;

    function addIfValid(col: number, row: number) {
      const c = clamp(col, 0, w - 1);
      const r = clamp(row, 0, h - 1);
      // Avoid duplicate consecutive waypoints
      const last = waypoints[waypoints.length - 1];
      if (!last || last.col !== c || last.row !== r) {
        waypoints.push({ col: c, row: r });
      }
    }
  }

  // ---- General helpers ----

  private getVisibleEnemies(unit: Unit): Unit[] {
    const visionRange = UNIT_STATS[unit.type].visionRange;
    const nearby = this.unitManager.getUnitsInRange(unit.position, visionRange);
    return nearby.filter(u => u.playerId !== this.playerId && u.isAlive());
  }

  private findClosestUnit(pos: GridPosition, units: Unit[]): Unit | null {
    if (units.length === 0) return null;
    let closest = units[0];
    let closestDist = gridDistance(pos, closest.position);
    for (let i = 1; i < units.length; i++) {
      const dist = gridDistance(pos, units[i].position);
      if (dist < closestDist) {
        closest = units[i];
        closestDist = dist;
      }
    }
    return closest;
  }

  /** Remove all tracking state for a destroyed unit. */
  clearUnit(unitId: string): void {
    this.wakeFlags.delete(unitId);
    this.activeDirectives.delete(unitId);
    this.exploreState.delete(unitId);
  }
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}
