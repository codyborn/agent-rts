import { GameEngine, System } from '../engine/GameEngine';
import { UnitManager } from '../units/UnitManager';
import { ResourceManager } from '../resources/ResourceManager';
import { GameState } from '../engine/GameState';
import {
  BuildingState,
  BuildingType,
  UnitType,
  UnitBehaviorState,
  GameEventType,
  PRODUCTION_TIME,
  BUILDING_STATS,
  GridPosition,
} from '../shared/types';
import { EventBus } from '../engine/EventBus';

// ============================================================
// BuildingSystem - Handles building construction and unit
// production each simulation tick.
//
// Construction: Buildings with `isConstructing === true` have
// their progress incremented each tick. When complete the flag
// is cleared and BUILDING_COMPLETED is emitted.
//
// Production: Completed buildings with a non-empty production
// queue advance production progress each tick. When a unit
// finishes, it is spawned near the building's rally point (or
// position) and PRODUCTION_COMPLETED is emitted.
// ============================================================

/** The eight cardinal + diagonal neighbour offsets. */
const NEIGHBOR_OFFSETS: ReadonlyArray<{ dRow: number; dCol: number }> = [
  { dRow: -1, dCol: -1 },
  { dRow: -1, dCol:  0 },
  { dRow: -1, dCol:  1 },
  { dRow:  0, dCol: -1 },
  { dRow:  0, dCol:  1 },
  { dRow:  1, dCol: -1 },
  { dRow:  1, dCol:  0 },
  { dRow:  1, dCol:  1 },
];

export class BuildingSystem implements System {
  private eventBus!: EventBus;

  constructor(
    private readonly unitManager: UnitManager,
    private readonly resourceManager: ResourceManager,
    private readonly gameState: GameState,
  ) {}

  // ---- System lifecycle ----------------------------------------

  /** Called once when the system is registered with the engine. */
  init(engine: GameEngine): void {
    this.eventBus = engine.eventBus;
  }

  /**
   * Called every simulation tick. Advances construction progress
   * for buildings under construction, drives unit production
   * queues, and kicks off new production runs when items are
   * waiting but the building is idle.
   */
  update(_tick: number, _deltaTime: number): void {
    const buildings = this.gameState.getAllBuildings();

    for (const building of buildings) {
      this.processConstruction(building);
      this.processProduction(building);
      this.startProduction(building);
    }
  }

  // ---- Construction --------------------------------------------

  /**
   * Advance construction progress for a building that is still
   * being built. When progress reaches 1.0 the building is
   * marked as complete and BUILDING_COMPLETED is emitted.
   */
  private processConstruction(building: BuildingState): void {
    if (!building.isConstructing || building.constructionTime <= 0) {
      return;
    }

    // Only advance construction if an engineer is adjacent and in BUILDING state
    if (!this.hasEngineerNearby(building)) {
      return;
    }

    building.constructionProgress += 1 / building.constructionTime;

    if (building.constructionProgress >= 1.0) {
      building.isConstructing = false;
      building.constructionProgress = 1.0;
      building.health = building.maxHealth;

      this.eventBus.emit(GameEventType.BUILDING_COMPLETED, {
        buildingId: building.id,
        type: building.type,
      });
    }
  }

  // ---- Unit Production -----------------------------------------

  /**
   * Advance production progress for a completed building that has
   * an active production run. When progress reaches 1.0 the first
   * unit in the queue is popped, spawned near the building, and
   * PRODUCTION_COMPLETED is emitted. If additional items remain
   * in the queue the next production run is initialised.
   */
  private processProduction(building: BuildingState): void {
    // Only completed buildings with an active production run.
    if (building.isConstructing) {
      return;
    }
    if (building.productionQueue.length === 0 || building.productionTime <= 0) {
      return;
    }

    building.productionProgress += 1 / building.productionTime;

    if (building.productionProgress >= 1.0) {
      const unitType = building.productionQueue.shift()!;

      const spawnPos = this.findSpawnPosition(building);

      this.unitManager.spawnUnit(
        unitType,
        building.playerId,
        spawnPos,
        building.position,
      );

      building.productionProgress = 0;

      if (building.productionQueue.length > 0) {
        const nextUnitType = building.productionQueue[0];
        building.productionTime = PRODUCTION_TIME[nextUnitType];
      } else {
        building.productionTime = 0;
      }

      this.eventBus.emit(GameEventType.PRODUCTION_COMPLETED, {
        buildingId: building.id,
        unitType,
      });
    }
  }

  /**
   * If a building has items waiting in its production queue but no
   * active production run (`productionTime === 0`), kick off the
   * first item and emit PRODUCTION_STARTED.
   */
  private startProduction(building: BuildingState): void {
    if (building.isConstructing) {
      return;
    }
    if (building.productionQueue.length === 0 || building.productionTime !== 0) {
      return;
    }

    const unitType = building.productionQueue[0];
    building.productionTime = PRODUCTION_TIME[unitType];
    building.productionProgress = 0;

    this.eventBus.emit(GameEventType.PRODUCTION_STARTED, {
      buildingId: building.id,
      unitType,
    });
  }

  // ---- Helpers -------------------------------------------------

  /**
   * Find a walkable tile adjacent to the building's rally point
   * (or position if no rally point is set). Checks all eight
   * neighbours and returns the first walkable tile. Falls back
   * to the building's own position if no walkable neighbour is
   * found.
   *
   * @param building - The building to find a spawn position for.
   * @returns A grid position where a new unit can be placed.
   */
  private findSpawnPosition(building: BuildingState): GridPosition {
    const origin: GridPosition = building.rallyPoint ?? building.position;

    for (const offset of NEIGHBOR_OFFSETS) {
      const candidate: GridPosition = {
        row: origin.row + offset.dRow,
        col: origin.col + offset.dCol,
      };

      const tile = this.gameState.getTile(candidate);
      if (tile && tile.walkable) {
        return candidate;
      }
    }

    // No walkable neighbour found -- fall back to the building position.
    return { row: building.position.row, col: building.position.col };
  }

  /**
   * Check if an engineer in BUILDING state is adjacent to the building.
   */
  private hasEngineerNearby(building: BuildingState): boolean {
    const footprint = building.type === BuildingType.WATCHTOWER ? 1 : 2;
    for (const unit of this.unitManager.getUnitsForPlayer(building.playerId)) {
      if (
        unit.type !== UnitType.ENGINEER ||
        unit.behaviorState !== UnitBehaviorState.BUILDING ||
        !unit.isAlive()
      ) {
        continue;
      }
      // Check if engineer is adjacent to any tile in the building footprint
      for (let dr = -1; dr <= footprint; dr++) {
        for (let dc = -1; dc <= footprint; dc++) {
          if (
            unit.position.row === building.position.row + dr &&
            unit.position.col === building.position.col + dc
          ) {
            return true;
          }
        }
      }
    }
    return false;
  }
}
