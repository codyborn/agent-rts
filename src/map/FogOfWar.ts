// ============================================================
// Agent RTS - Fog of War
// Per-player visibility tracking system
// ============================================================

import { GridPosition, FogState } from '../shared/types';

/**
 * Manages per-player fog of war across the game map.
 *
 * Each player has an independent fog grid that tracks three visibility states:
 * - UNEXPLORED: never seen
 * - EXPLORED: previously seen but no longer within any unit's vision
 * - VISIBLE: currently within at least one unit's vision range
 *
 * Vision is recalculated each tick by calling updateVision with the current
 * set of vision-providing entities (units, buildings, watchtowers, etc.).
 */
export class FogOfWar {
  public readonly width: number;
  public readonly height: number;
  private fogGrids: Map<string, FogState[][]>;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.fogGrids = new Map();
  }

  /**
   * Initializes a fog grid for a new player. All tiles start as UNEXPLORED.
   *
   * @param playerId - Unique identifier for the player
   */
  initPlayer(playerId: string): void {
    const grid: FogState[][] = [];
    for (let row = 0; row < this.height; row++) {
      grid[row] = [];
      for (let col = 0; col < this.width; col++) {
        grid[row][col] = FogState.UNEXPLORED;
      }
    }
    this.fogGrids.set(playerId, grid);
  }

  /**
   * Recalculates a player's vision based on their current vision sources.
   *
   * This is a two-step process:
   * 1. All currently VISIBLE tiles are downgraded to EXPLORED (fog returns).
   * 2. For each vision source, tiles within its circular range are set to VISIBLE.
   *
   * Uses squared-distance comparison to avoid expensive sqrt operations.
   *
   * @param playerId - Player whose vision to update
   * @param visionSources - Array of entities providing vision, each with a position and range
   */
  updateVision(
    playerId: string,
    visionSources: Array<{ position: GridPosition; range: number }>,
  ): void {
    const grid = this.fogGrids.get(playerId);
    if (!grid) return;

    // Step 1: Downgrade all VISIBLE tiles to EXPLORED
    for (let row = 0; row < this.height; row++) {
      for (let col = 0; col < this.width; col++) {
        if (grid[row][col] === FogState.VISIBLE) {
          grid[row][col] = FogState.EXPLORED;
        }
      }
    }

    // Step 2: Apply vision from each source
    for (const source of visionSources) {
      const { position, range } = source;
      const rangeSquared = range * range;

      // Clamp the bounding box to the map boundaries
      const minRow = Math.max(0, position.row - range);
      const maxRow = Math.min(this.height - 1, position.row + range);
      const minCol = Math.max(0, position.col - range);
      const maxCol = Math.min(this.width - 1, position.col + range);

      for (let row = minRow; row <= maxRow; row++) {
        for (let col = minCol; col <= maxCol; col++) {
          const dr = row - position.row;
          const dc = col - position.col;
          const distSquared = dr * dr + dc * dc;

          if (distSquared <= rangeSquared) {
            grid[row][col] = FogState.VISIBLE;
          }
        }
      }
    }
  }

  /**
   * Returns the fog state for a specific tile and player.
   * Defaults to UNEXPLORED if the player has no fog grid or the position is out of bounds.
   *
   * @param playerId - Player to query
   * @param pos - Grid position to check
   * @returns The current FogState for that tile
   */
  getState(playerId: string, pos: GridPosition): FogState {
    const grid = this.fogGrids.get(playerId);
    if (!grid) return FogState.UNEXPLORED;
    if (pos.row < 0 || pos.row >= this.height || pos.col < 0 || pos.col >= this.width) {
      return FogState.UNEXPLORED;
    }
    return grid[pos.row][pos.col];
  }

  /**
   * Checks whether a tile is currently visible to a player.
   */
  isVisible(playerId: string, pos: GridPosition): boolean {
    return this.getState(playerId, pos) === FogState.VISIBLE;
  }

  /**
   * Checks whether a tile has been explored (previously seen or currently visible).
   */
  isExplored(playerId: string, pos: GridPosition): boolean {
    const state = this.getState(playerId, pos);
    return state === FogState.EXPLORED || state === FogState.VISIBLE;
  }

  /**
   * Returns the raw fog grid for a player, or undefined if the player
   * has not been initialized.
   *
   * @param playerId - Player to query
   * @returns The 2D FogState array, or undefined
   */
  getFogGrid(playerId: string): FogState[][] | undefined {
    return this.fogGrids.get(playerId);
  }

  /**
   * Permanently reveals a circular area for a player. Useful for debug
   * tools, map reveals, or special abilities. Sets all tiles within the
   * range to VISIBLE. These tiles will not be downgraded during the next
   * updateVision call's Step 1 unless updateVision is called (they become
   * EXPLORED then). For truly permanent reveal, call this after updateVision.
   *
   * @param playerId - Player to reveal for
   * @param center - Center of the reveal area
   * @param range - Radius of the reveal in tiles
   */
  revealArea(playerId: string, center: GridPosition, range: number): void {
    const grid = this.fogGrids.get(playerId);
    if (!grid) return;

    const rangeSquared = range * range;
    const minRow = Math.max(0, center.row - range);
    const maxRow = Math.min(this.height - 1, center.row + range);
    const minCol = Math.max(0, center.col - range);
    const maxCol = Math.min(this.width - 1, center.col + range);

    for (let row = minRow; row <= maxRow; row++) {
      for (let col = minCol; col <= maxCol; col++) {
        const dr = row - center.row;
        const dc = col - center.col;
        if (dr * dr + dc * dc <= rangeSquared) {
          grid[row][col] = FogState.VISIBLE;
        }
      }
    }
  }
}
