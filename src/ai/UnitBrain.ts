import {
  UnitState,
  UnitPerception,
  UnitAction,
  UnitType,
  GridPosition,
  UnitMessage,
  AuditLogEntry,
  UNIT_STATS,
  positionToLabel,
  MapTile,
  TerrainType,
} from '../shared/types';

// ============================================================
// UnitBrain - Per-unit AI decision loop
// Each unit has its own brain that periodically builds a
// perception of the world and requests an action from the
// AgentController (rule-based stub or LLM).
// ============================================================

/**
 * Interface for the action requester to avoid circular imports.
 * Matches AgentController.requestAction signature.
 */
interface ActionRequester {
  requestAction(perception: UnitPerception, playerId?: string): Promise<UnitAction>;
}

/** Visible unit info passed to think() */
interface VisibleUnitInfo {
  id: string;
  type: UnitType;
  position: GridPosition;
  playerId: string;
  health: number;
  maxHealth: number;
}

/** Visible terrain info passed to think() */
interface VisibleTerrainInfo {
  position: GridPosition;
  terrain: TerrainType;
  resource: string | null;
}

export class UnitBrain {
  public readonly unitId: string;
  public readonly unitType: UnitType;
  public readonly playerId: string;

  private readonly controller: ActionRequester;
  private lastThinkTick = 0;
  private thinkInterval: number;
  private pendingAction: UnitAction | null = null;

  constructor(unitId: string, unitType: UnitType, playerId: string, controller: ActionRequester) {
    this.unitId = unitId;
    this.unitType = unitType;
    this.playerId = playerId;
    this.controller = controller;

    // Think intervals in ticks. When LLM is active these get overridden
    // in requestAction's LLM path (throttled by fetch timeout). For the
    // rule-based fallback we use fast intervals.
    switch (unitType) {
      case UnitType.SCOUT:
        this.thinkInterval = 5;
        break;
      case UnitType.CAPTAIN:
        this.thinkInterval = 6;
        break;
      case UnitType.SOLDIER:
        this.thinkInterval = 8;
        break;
      case UnitType.ENGINEER:
        this.thinkInterval = 12;
        break;
      default:
        this.thinkInterval = 10;
        break;
    }
  }

  /**
   * Check whether enough ticks have elapsed for this unit to make
   * a new decision.
   */
  shouldThink(currentTick: number): boolean {
    return currentTick - this.lastThinkTick >= this.thinkInterval;
  }

  /**
   * Build a perception of the world and request an action from the controller.
   *
   * @param unitState - The full state of this unit
   * @param visibleUnits - Other units this unit can see
   * @param visibleTerrain - Terrain tiles this unit can see
   * @param messages - Recent messages addressed to this unit
   * @param currentTick - Current simulation tick
   * @returns The action the unit should take
   */
  async think(
    unitState: UnitState,
    visibleUnits: VisibleUnitInfo[],
    visibleTerrain: VisibleTerrainInfo[],
    messages: UnitMessage[],
    currentTick: number
  ): Promise<UnitAction> {
    const perception = this.buildPerception(
      unitState,
      visibleUnits,
      visibleTerrain,
      messages
    );

    const action = await this.controller.requestAction(perception, this.playerId);

    this.lastThinkTick = currentTick;
    this.pendingAction = action;

    return action;
  }

  /**
   * Retrieve and clear the pending action. Called by the game engine
   * to consume the brain's decision.
   */
  getPendingAction(): UnitAction | null {
    const action = this.pendingAction;
    this.pendingAction = null;
    return action;
  }

  /**
   * Build a full UnitPerception from raw game state data.
   * This is the "lens" through which the unit sees the world.
   */
  buildPerception(
    unitState: UnitState,
    visibleUnits: VisibleUnitInfo[],
    visibleTerrain: VisibleTerrainInfo[],
    messages: UnitMessage[]
  ): UnitPerception {
    const stats = UNIT_STATS[unitState.type];

    return {
      self: {
        id: unitState.id,
        type: unitState.type,
        position: { ...unitState.position },
        gridLabel: positionToLabel(unitState.position),
        health: unitState.health,
        maxHealth: stats.maxHealth,
        energy: unitState.energy,
        maxEnergy: stats.maxEnergy,
        afflictions: unitState.afflictions.map(a => ({ ...a })),
      },

      visibleUnits: visibleUnits.map(u => ({
        id: u.id,
        type: u.type,
        relativePosition: {
          dx: u.position.col - unitState.position.col,
          dy: u.position.row - unitState.position.row,
        },
        gridLabel: positionToLabel(u.position),
        isFriendly: u.playerId === unitState.playerId,
        healthPercent: u.maxHealth > 0 ? u.health / u.maxHealth : 0,
      })),

      visibleTerrain: visibleTerrain.map(t => {
        const hasResource = t.resource !== null;
        const entry: UnitPerception['visibleTerrain'][0] = {
          gridLabel: positionToLabel(t.position),
          type: t.terrain,
          hasResource,
          walkable: t.terrain !== TerrainType.WATER,
          relativePosition: {
            dx: t.position.col - unitState.position.col,
            dy: t.position.row - unitState.position.row,
          },
        };
        // Include resource type if present
        if (hasResource && t.resource) {
          entry.resourceType = t.resource as UnitPerception['visibleTerrain'][0]['resourceType'];
        }
        return entry;
      }),

      recentAuditLog: unitState.auditLog.slice(-10),

      currentCommand: unitState.currentCommand,

      nearbyMessages: messages,
    };
  }
}
