import { ResourceType, GameEventType } from '../shared/types';
import { EventBus } from '../engine/EventBus';

// ============================================================
// ResourceManager - Tracks per-player resource balances
// Supports minerals and energy with safe spend/deposit/gather
// operations. All mutations emit events through the EventBus.
// ============================================================

/** Default starting resources for a new player. */
const DEFAULT_STARTING_RESOURCES: Record<ResourceType, number> = {
  [ResourceType.MINERALS]: 500,
  [ResourceType.ENERGY]: 200,
};

export class ResourceManager {
  private playerResources: Map<string, Record<ResourceType, number>> = new Map();

  constructor(private readonly eventBus: EventBus) {}

  // ---- Initialisation ----

  /**
   * Initialise a player's resource pool.
   * Merges the optional `starting` values on top of the defaults
   * (minerals: 500, energy: 200).
   *
   * @param playerId - Unique player identifier.
   * @param starting - Optional overrides for individual resource types.
   */
  initPlayer(
    playerId: string,
    starting?: Partial<Record<ResourceType, number>>,
  ): void {
    const resources: Record<ResourceType, number> = {
      ...DEFAULT_STARTING_RESOURCES,
      ...starting,
    };
    this.playerResources.set(playerId, resources);
  }

  // ---- Queries ----

  /**
   * Return a copy of a player's current resources.
   * Returns zeroed-out resources if the player has not been initialised.
   */
  getResources(playerId: string): Record<ResourceType, number> {
    const resources = this.playerResources.get(playerId);
    if (!resources) {
      return {
        [ResourceType.MINERALS]: 0,
        [ResourceType.ENERGY]: 0,
      };
    }
    return { ...resources };
  }

  /** Return the current amount of a single resource type for a player. */
  getResource(playerId: string, type: ResourceType): number {
    const resources = this.playerResources.get(playerId);
    if (!resources) return 0;
    return resources[type];
  }

  /**
   * Check whether a player can afford a set of costs.
   *
   * @param playerId - The player to check.
   * @param costs    - A record mapping each resource type to its cost.
   * @returns True if the player has enough of every resource.
   */
  canAfford(playerId: string, costs: Record<ResourceType, number>): boolean {
    const resources = this.playerResources.get(playerId);
    if (!resources) return false;

    for (const type of Object.keys(costs) as ResourceType[]) {
      if ((resources[type] ?? 0) < costs[type]) {
        return false;
      }
    }

    return true;
  }

  // ---- Mutations ----

  /**
   * Attempt to spend resources. The operation is atomic: if the player
   * cannot afford the full cost, nothing is deducted.
   *
   * @param playerId - The spending player.
   * @param costs    - A record of resource type to amount required.
   * @returns True if the spend succeeded, false otherwise.
   */
  spend(playerId: string, costs: Record<ResourceType, number>): boolean {
    if (!this.canAfford(playerId, costs)) {
      return false;
    }

    const resources = this.playerResources.get(playerId)!;
    for (const type of Object.keys(costs) as ResourceType[]) {
      resources[type] -= costs[type];
    }

    return true;
  }

  /**
   * Deposit resources into a player's pool (e.g. a worker returning minerals
   * to the base). Emits RESOURCE_DEPOSITED.
   *
   * @param playerId - The receiving player.
   * @param type     - The resource type being deposited.
   * @param amount   - Quantity to add.
   */
  deposit(playerId: string, type: ResourceType, amount: number): void {
    this.ensurePlayer(playerId);
    const resources = this.playerResources.get(playerId)!;
    resources[type] += amount;

    this.eventBus.emit(GameEventType.RESOURCE_DEPOSITED, {
      playerId,
      type,
      amount,
    });
  }

  /**
   * Record a gather event and credit the resources to the player.
   * Emits RESOURCE_GATHERED.
   *
   * @param playerId - The gathering player.
   * @param type     - The resource type being gathered.
   * @param amount   - Quantity gathered.
   */
  gather(playerId: string, type: ResourceType, amount: number): void {
    this.ensurePlayer(playerId);
    const resources = this.playerResources.get(playerId)!;
    resources[type] += amount;

    this.eventBus.emit(GameEventType.RESOURCE_GATHERED, {
      playerId,
      type,
      amount,
    });
  }

  // ---- Helpers ----

  /**
   * Ensure a player entry exists in the map. If not, create one with
   * zeroed resources (this handles the edge case where deposit/gather
   * is called before initPlayer).
   */
  private ensurePlayer(playerId: string): void {
    if (!this.playerResources.has(playerId)) {
      this.playerResources.set(playerId, {
        [ResourceType.MINERALS]: 0,
        [ResourceType.ENERGY]: 0,
      });
    }
  }
}
