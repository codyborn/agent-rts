// ============================================================
// CombatSystem - Handles unit-to-unit and unit-to-building combat
// ============================================================
// Processes attack cooldowns, executes attacks when units are
// in range, handles target tracking and pursuit via pathfinding,
// and provides auto-targeting for idle combat units.
//
// Runs each tick in the following order per unit:
//   1. Decrement attack cooldown (skip unit if still on cooldown)
//   2. Process active attack orders (damage, kill, chase)
//   3. Auto-acquire targets for idle combat units (units first, then buildings)
// ============================================================

import { GameEngine, System } from '../engine/GameEngine';
import { GameState } from '../engine/GameState';
import { UnitManager } from '../units/UnitManager';
import { GameMap } from '../map/GameMap';
import { findPath } from '../map/Pathfinding';
import {
  UnitBehaviorState,
  UnitType,
  UNIT_STATS,
  GameEventType,
  ATTACK_COOLDOWN_TICKS,
  BuildingType,
  BUILDING_STATS,
  gridDistance,
  BuildingState,
} from '../shared/types';
import { EventBus } from '../engine/EventBus';

/** Unit types that will auto-acquire nearby enemy targets when idle. */
const COMBAT_UNIT_TYPES: ReadonlySet<UnitType> = new Set([
  UnitType.SOLDIER,
  UnitType.SIEGE,
  UnitType.CAPTAIN,
]);

export class CombatSystem implements System {
  private eventBus!: EventBus;

  constructor(
    private readonly unitManager: UnitManager,
    private readonly gameMap: GameMap,
    private readonly localPlayerId: string = '0',
    private readonly gameState?: GameState,
  ) {}

  // ---- System lifecycle ----

  /**
   * Called once when the system is registered with the engine.
   * Captures a reference to the shared EventBus for emitting
   * combat-related events.
   */
  init(engine: GameEngine): void {
    this.eventBus = engine.eventBus;
  }

  /**
   * Called every simulation tick. Iterates over all living units
   * and processes cooldowns, active attacks, and auto-targeting.
   *
   * @param tick - The current simulation tick number.
   * @param _deltaTime - Fixed time step in seconds (unused by combat).
   */
  update(tick: number, _deltaTime: number): void {
    const units = this.unitManager.getAllUnits();

    for (const unit of units) {
      if (!unit.isAlive()) {
        continue;
      }

      // Step 1: Decrement attack cooldown. If still cooling down, skip.
      if (unit.attackCooldown > 0) {
        unit.attackCooldown -= 1;
        continue;
      }

      // Step 2: Process active attack orders.
      if (
        unit.behaviorState === UnitBehaviorState.ATTACKING &&
        unit.attackTargetId !== null
      ) {
        this.processAttack(unit.id, tick);
        continue;
      }

      // Step 3: Auto-acquire targets for idle combat units.
      // Skip local player units — their combat is controlled by the DirectiveExecutor.
      if (
        unit.behaviorState === UnitBehaviorState.IDLE &&
        unit.attackTargetId === null &&
        COMBAT_UNIT_TYPES.has(unit.type) &&
        unit.playerId !== this.localPlayerId
      ) {
        this.autoAcquireTarget(unit.id);
      }
    }
  }

  // ---- Internal helpers ----

  /**
   * Processes an active attack order for the given unit.
   *
   * If the target is dead or gone, clears the attacker's state.
   * If in range, deals damage and handles destruction.
   * If out of range with no path, pathfinds toward the target.
   */
  private processAttack(unitId: string, tick: number): void {
    const unit = this.unitManager.getUnit(unitId);
    if (!unit || !unit.attackTargetId) {
      return;
    }

    // Check if the target is a building
    if (unit.attackTargetId.startsWith('building_') && this.gameState) {
      this.processAttackBuilding(unit, tick);
      return;
    }

    const target = this.unitManager.getUnit(unit.attackTargetId);

    // Target no longer exists or is dead -- clear state and bail.
    if (!target || !target.isAlive()) {
      unit.attackTargetId = null;
      unit.behaviorState = UnitBehaviorState.IDLE;
      return;
    }

    const stats = UNIT_STATS[unit.type];
    const distance = gridDistance(unit.position, target.position);

    if (distance <= stats.attackRange) {
      // In range -- deal damage.
      const actualDamage = target.takeDamage(stats.attack);

      unit.attackCooldown = ATTACK_COOLDOWN_TICKS;
      unit.lastActionTick = tick;

      this.eventBus.emit(GameEventType.UNIT_ATTACKED, {
        attackerId: unit.id,
        targetId: target.id,
        damage: actualDamage,
      });

      // Check if the target was killed.
      if (!target.isAlive()) {
        this.eventBus.emit(GameEventType.UNIT_DESTROYED, {
          unitId: target.id,
          killedBy: unit.id,
        });
        this.unitManager.destroyUnit(target.id);

        unit.attackTargetId = null;
        unit.behaviorState = UnitBehaviorState.IDLE;
      }
    } else if (!unit.path || unit.path.length === 0) {
      // Out of range with no path -- chase the target.
      const path = findPath(
        unit.position,
        target.position,
        this.gameMap,
        unit.type,
      );

      if (path.length > 0) {
        unit.setPath(path);
      }
    }
  }

  /**
   * Processes an attack against an enemy building.
   * Deals damage, and destroys the building when health reaches 0.
   */
  private processAttackBuilding(unit: import('../units/Unit').Unit, tick: number): void {
    if (!this.gameState) return;
    const building = this.gameState.getBuilding(unit.attackTargetId!);

    if (!building || building.health <= 0) {
      unit.attackTargetId = null;
      unit.behaviorState = UnitBehaviorState.IDLE;
      return;
    }

    const stats = UNIT_STATS[unit.type];
    // Use building center for distance check (buildings are 2x2, except watchtower 1x1)
    const bSize = building.type === BuildingType.WATCHTOWER ? 1 : 2;
    const bCenter = { col: building.position.col + bSize / 2, row: building.position.row + bSize / 2 };
    const distance = gridDistance(unit.position, bCenter);

    if (distance <= stats.attackRange + 1) {
      // In range -- deal damage.
      building.health -= stats.attack;
      unit.attackCooldown = ATTACK_COOLDOWN_TICKS;
      unit.lastActionTick = tick;

      if (building.health <= 0) {
        building.health = 0;
        this.eventBus.emit(GameEventType.BUILDING_DESTROYED, {
          buildingId: building.id,
          killedBy: unit.id,
        });
        this.gameState.removeBuilding(building.id);
        unit.attackTargetId = null;
        unit.behaviorState = UnitBehaviorState.IDLE;
      }
    } else if (!unit.path || unit.path.length === 0) {
      // Chase the building
      const path = findPath(unit.position, building.position, this.gameMap, unit.type);
      if (path.length > 0) {
        unit.setPath(path);
      }
    }
  }

  /**
   * Find the nearest enemy building within vision range for a unit.
   */
  private findNearestEnemyBuilding(unit: import('../units/Unit').Unit): BuildingState | null {
    if (!this.gameState) return null;
    const stats = UNIT_STATS[unit.type];
    let nearest: BuildingState | null = null;
    let nearestDist = Infinity;

    for (const building of this.gameState.getAllBuildings()) {
      if (building.playerId === unit.playerId) continue;
      if (building.health <= 0) continue;
      const dist = gridDistance(unit.position, building.position);
      if (dist <= stats.visionRange && dist < nearestDist) {
        nearest = building;
        nearestDist = dist;
      }
    }
    return nearest;
  }

  /**
   * Scans for the nearest enemy unit within vision range and, if
   * found, sets the unit to attack it. Only called for idle combat
   * units (Soldier, Siege, Captain).
   */
  private autoAcquireTarget(unitId: string): void {
    const unit = this.unitManager.getUnit(unitId);
    if (!unit) {
      return;
    }

    const stats = UNIT_STATS[unit.type];
    const nearbyUnits = this.unitManager.getUnitsInRange(
      unit.position,
      stats.visionRange,
    );

    let nearestEnemy: { id: string; distance: number } | null = null;

    for (const candidate of nearbyUnits) {
      // Skip friendly units and self.
      if (candidate.playerId === unit.playerId) {
        continue;
      }

      // Skip dead units.
      if (!candidate.isAlive()) {
        continue;
      }

      const distance = gridDistance(unit.position, candidate.position);

      if (nearestEnemy === null || distance < nearestEnemy.distance) {
        nearestEnemy = { id: candidate.id, distance };
      }
    }

    if (nearestEnemy !== null) {
      unit.attackTargetId = nearestEnemy.id;
      unit.behaviorState = UnitBehaviorState.ATTACKING;
      return;
    }

    // No enemy units found — check for enemy buildings
    const building = this.findNearestEnemyBuilding(unit);
    if (building) {
      unit.attackTargetId = building.id;
      unit.behaviorState = UnitBehaviorState.ATTACKING;
    }
  }
}
