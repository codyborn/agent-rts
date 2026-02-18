import { GameEngine, System } from '../engine/GameEngine';
import { EventBus } from '../engine/EventBus';
import { UnitManager } from '../units/UnitManager';
import { Unit } from '../units/Unit';
import { GameMap } from '../map/GameMap';
import { ResourceManager } from '../resources/ResourceManager';
import { findPath } from '../map/Pathfinding';
import {
  UnitBehaviorState,
  UnitType,
  GameEventType,
  GATHER_TICKS,
  GATHER_AMOUNT,
  GATHER_RANGE,
  gridDistance,
} from '../shared/types';

// ============================================================
// ResourceSystem - Handles the engineer resource gathering cycle
// ============================================================
// Engineers follow a gather-return-deposit loop:
//   1. Move to a resource tile (pathing handled by MovementSystem)
//   2. Harvest resources over GATHER_TICKS ticks
//   3. Return to home base and deposit
//   4. Repeat
//
// Only units of type ENGINEER participate in this system.
// ============================================================

export class ResourceSystem implements System {
  private eventBus!: EventBus;

  constructor(
    private readonly unitManager: UnitManager,
    private readonly gameMap: GameMap,
    private readonly resourceManager: ResourceManager,
    private readonly localPlayerId: string = '0',
  ) {}

  init(engine: GameEngine): void {
    this.eventBus = engine.eventBus;
  }

  update(_tick: number, _deltaTime: number): void {
    const units = this.unitManager.getAllUnits();

    for (const unit of units) {
      // Only engineers gather resources.
      if (unit.type !== UnitType.ENGINEER) continue;

      // Only process living units.
      if (!unit.isAlive()) continue;

      if (unit.behaviorState === UnitBehaviorState.GATHERING) {
        this.processGathering(unit);
      } else if (unit.behaviorState === UnitBehaviorState.RETURNING) {
        this.processReturning(unit);
      }
    }
  }

  /**
   * Handles the GATHERING state: move to the resource tile, then
   * harvest over multiple ticks until the carry capacity is filled.
   */
  private processGathering(unit: Unit): void {
    const { gatherTarget } = unit;

    // No gather target assigned -- nothing to do.
    if (!gatherTarget) return;

    const distanceToTarget = gridDistance(unit.position, gatherTarget);

    // Still en route -- movement is handled by the MovementSystem.
    if (distanceToTarget > GATHER_RANGE) return;

    // Unit is adjacent to or on the resource tile.
    const tile = this.gameMap.getTile(gatherTarget);

    // Tile is invalid, has no resource, or is already depleted.
    if (!tile || !tile.resource || tile.resourceAmount <= 0) {
      unit.gatherTarget = null;
      unit.gatherProgress = 0;
      unit.behaviorState = UnitBehaviorState.IDLE;
      return;
    }

    // Increment gathering progress each tick.
    unit.gatherProgress++;

    // Check if gathering is complete.
    if (unit.gatherProgress >= GATHER_TICKS) {
      const harvestAmount = Math.min(GATHER_AMOUNT, tile.resourceAmount);

      // Load the unit with gathered resources.
      unit.carryingType = tile.resource;
      unit.carryingAmount = harvestAmount;

      // Deduct from the tile.
      tile.resourceAmount -= harvestAmount;

      // If the tile is fully depleted, clear it and emit an event.
      if (tile.resourceAmount <= 0) {
        tile.resource = null;
        this.eventBus.emit(GameEventType.RESOURCE_DEPLETED, {
          position: { col: gatherTarget.col, row: gatherTarget.row },
        });
      }

      // Reset gather progress for the next trip.
      unit.gatherProgress = 0;

      // Transition to RETURNING state to bring resources back to base.
      unit.behaviorState = UnitBehaviorState.RETURNING;

      // Pathfind back to home base.
      if (unit.homeBase) {
        const path = findPath(unit.position, unit.homeBase, this.gameMap, UnitType.ENGINEER);
        if (path.length > 0) {
          unit.setPath(path);
        }
      }
    }
  }

  /**
   * Handles the RETURNING state: move back to the home base,
   * deposit carried resources, then head back out for more.
   */
  private processReturning(unit: Unit): void {
    if (!unit.homeBase) return;

    const distanceToBase = gridDistance(unit.position, unit.homeBase);

    if (distanceToBase <= 1) {
      // At base -- deposit resources.
      if (unit.carryingType !== null && unit.carryingAmount > 0) {
        this.resourceManager.deposit(
          unit.playerId,
          unit.carryingType,
          unit.carryingAmount,
        );
      }

      // Clear carrying state.
      unit.carryingType = null;
      unit.carryingAmount = 0;

      // Local player units: go IDLE so the DirectiveExecutor decides what to do next.
      if (unit.playerId === this.localPlayerId) {
        unit.behaviorState = UnitBehaviorState.IDLE;
      } else {
        // AI units: auto-restart the gather cycle.
        unit.behaviorState = UnitBehaviorState.GATHERING;

        // Pathfind back to the gather target for another load.
        if (unit.gatherTarget) {
          const path = findPath(
            unit.position,
            unit.gatherTarget,
            this.gameMap,
            UnitType.ENGINEER,
          );
          if (path.length > 0) {
            unit.setPath(path);
          }
        }
      }
    } else if (!unit.path || unit.path.length === 0) {
      // Not near base and has no active path -- recalculate.
      const path = findPath(unit.position, unit.homeBase, this.gameMap, UnitType.ENGINEER);
      if (path.length > 0) {
        unit.setPath(path);
      }
    }
  }
}
