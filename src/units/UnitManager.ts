import { UnitType, UnitState, GridPosition, GameEventType, gridDistance } from '../shared/types';
import { EventBus } from '../engine/EventBus';
import { Unit } from './Unit';

// ============================================================
// UnitManager - Central registry for all units in the game
// Handles spawning, destruction, selection, and spatial queries.
// All mutations emit events through the EventBus so that other
// subsystems (renderer, AI, networking) can react accordingly.
// ============================================================

export class UnitManager {
  private units: Map<string, Unit> = new Map();
  private nextId: number = 1;

  constructor(private readonly eventBus: EventBus) {}

  // ---- Lifecycle ----

  /**
   * Spawn a new unit and register it.
   *
   * @param type      - The unit archetype to create.
   * @param playerId  - Owning player identifier.
   * @param position  - Starting grid position.
   * @param homeBase  - Optional home base position (for auto-return logic).
   * @returns The newly created Unit instance.
   */
  spawnUnit(
    type: UnitType,
    playerId: string,
    position: GridPosition,
    homeBase?: GridPosition,
  ): Unit {
    const id = `unit_${this.nextId++}`;
    const unit = new Unit(id, type, playerId, position);

    if (homeBase) {
      unit.homeBase = { col: homeBase.col, row: homeBase.row };
    }

    this.units.set(id, unit);
    this.eventBus.emit(GameEventType.UNIT_SPAWNED, { unit: unit.toState() });

    return unit;
  }

  /**
   * Remove a unit from the game and notify listeners.
   *
   * @param id - The unit ID to destroy.
   */
  destroyUnit(id: string): void {
    this.units.delete(id);
    this.eventBus.emit(GameEventType.UNIT_DESTROYED, { unitId: id });
  }

  // ---- Lookups ----

  /** Retrieve a single unit by ID, or undefined if not found. */
  getUnit(id: string): Unit | undefined {
    return this.units.get(id);
  }

  /** Return an array of every living unit. */
  getAllUnits(): Unit[] {
    return Array.from(this.units.values());
  }

  /** Return all units belonging to a specific player. */
  getUnitsForPlayer(playerId: string): Unit[] {
    return this.getAllUnits().filter((u) => u.playerId === playerId);
  }

  /**
   * Return all units within a given Euclidean distance of a position.
   *
   * @param position - Centre of the search area.
   * @param range    - Maximum Euclidean tile distance (inclusive).
   */
  getUnitsInRange(position: GridPosition, range: number): Unit[] {
    return this.getAllUnits().filter(
      (u) => gridDistance(u.position, position) <= range,
    );
  }

  /** Return all units of a specific type belonging to a player. */
  getUnitsOfType(playerId: string, type: UnitType): Unit[] {
    return this.getAllUnits().filter(
      (u) => u.playerId === playerId && u.type === type,
    );
  }

  // ---- Selection ----

  /** Return units currently selected for a player. */
  getSelectedUnits(playerId: string): Unit[] {
    return this.getAllUnits().filter(
      (u) => u.playerId === playerId && u.isSelected,
    );
  }

  /**
   * Set the active selection.
   * All units are deselected first, then the provided IDs are selected.
   * Emits SELECTION_CHANGED.
   *
   * @param unitIds - The unit IDs that should become selected.
   */
  selectUnits(unitIds: string[]): void {
    // Deselect everything.
    for (const unit of this.units.values()) {
      unit.isSelected = false;
    }

    // Select the requested units.
    for (const id of unitIds) {
      const unit = this.units.get(id);
      if (unit) {
        unit.isSelected = true;
      }
    }

    this.eventBus.emit(GameEventType.SELECTION_CHANGED, { unitIds });
  }

  /**
   * Deselect all units belonging to a player.
   * Emits SELECTION_CHANGED with an empty array.
   *
   * @param playerId - The player whose units should be deselected.
   */
  deselectAll(playerId: string): void {
    for (const unit of this.units.values()) {
      if (unit.playerId === playerId) {
        unit.isSelected = false;
      }
    }

    this.eventBus.emit(GameEventType.SELECTION_CHANGED, { unitIds: [] });
  }

  // ---- Serialisation ----

  /**
   * Build a snapshot map of every unit's serialised state.
   * Useful for saving, networking, or rendering.
   */
  getUnitStates(): Map<string, UnitState> {
    const states = new Map<string, UnitState>();
    for (const [id, unit] of this.units) {
      states.set(id, unit.toState());
    }
    return states;
  }
}
