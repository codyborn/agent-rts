// ============================================================
// Agent RTS - Game Map
// Grid-based map with procedural terrain generation
// ============================================================

import {
  GridPosition,
  MapTile,
  TerrainType,
  ResourceType,
  UnitType,
  TERRAIN_MOVEMENT_COST,
  SCOUT_TERRAIN_BONUS,
} from '../shared/types';
import { hexNeighbors } from '../hex/HexUtils';

// ============ Seeded Pseudo-Random Number Generator ============

/**
 * Simple seeded PRNG using a 32-bit xorshift algorithm.
 * Produces deterministic sequences for reproducible map generation.
 */
class SeededRNG {
  private state: number;

  constructor(seed: number) {
    // Ensure non-zero initial state
    this.state = seed === 0 ? 1 : seed | 0;
  }

  /** Returns a pseudo-random float in [0, 1). */
  next(): number {
    let s = this.state;
    s ^= s << 13;
    s ^= s >> 17;
    s ^= s << 5;
    this.state = s;
    return ((s >>> 0) % 10000) / 10000;
  }

  /** Returns a pseudo-random integer in [min, max] (inclusive). */
  nextInt(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }
}

// ============ Value Noise ============

/**
 * Hash-based value noise for procedural terrain generation.
 * Uses a permutation table seeded by the RNG to produce smooth noise
 * that can be sampled at arbitrary scales.
 */
class ValueNoise {
  private perm: number[];

  constructor(rng: SeededRNG) {
    // Build a 256-entry permutation table
    this.perm = [];
    for (let i = 0; i < 256; i++) {
      this.perm[i] = i;
    }
    // Fisher-Yates shuffle using the seeded RNG
    for (let i = 255; i > 0; i--) {
      const j = rng.nextInt(0, i);
      const tmp = this.perm[i];
      this.perm[i] = this.perm[j];
      this.perm[j] = tmp;
    }
  }

  /**
   * Hash two integer coordinates into a pseudo-random float in [0, 1).
   */
  private hash(ix: number, iy: number): number {
    const idx = (this.perm[(ix & 255)] + iy) & 255;
    return this.perm[idx] / 255;
  }

  /**
   * Hermite smoothstep for interpolation.
   */
  private smoothstep(t: number): number {
    return t * t * (3 - 2 * t);
  }

  /**
   * Sample 2D value noise at the given coordinates.
   * Returns a float in approximately [0, 1].
   */
  sample(x: number, y: number): number {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;

    const sx = this.smoothstep(fx);
    const sy = this.smoothstep(fy);

    const v00 = this.hash(ix, iy);
    const v10 = this.hash(ix + 1, iy);
    const v01 = this.hash(ix, iy + 1);
    const v11 = this.hash(ix + 1, iy + 1);

    const top = v00 + sx * (v10 - v00);
    const bottom = v01 + sx * (v11 - v01);

    return top + sy * (bottom - top);
  }

  /**
   * Layered (octave) noise for richer terrain variation.
   * Combines multiple noise samples at increasing frequencies.
   */
  layered(x: number, y: number, octaves: number, lacunarity: number, persistence: number): number {
    let value = 0;
    let amplitude = 1;
    let frequency = 1;
    let maxValue = 0;

    for (let i = 0; i < octaves; i++) {
      value += this.sample(x * frequency, y * frequency) * amplitude;
      maxValue += amplitude;
      amplitude *= persistence;
      frequency *= lacunarity;
    }

    return value / maxValue;
  }
}

// ============ GameMap Class ============

/**
 * Grid-based game map with procedural terrain generation.
 *
 * The map is stored as a 2D array of MapTile objects indexed as tiles[row][col].
 * Supports terrain queries, resource lookup, and pathfinding-compatible interfaces.
 */
export class GameMap {
  public readonly width: number;
  public readonly height: number;
  public tiles: MapTile[][];

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;

    // Initialize with default plains tiles
    this.tiles = [];
    for (let row = 0; row < height; row++) {
      this.tiles[row] = [];
      for (let col = 0; col < width; col++) {
        this.tiles[row][col] = {
          terrain: TerrainType.PLAINS,
          resource: null,
          resourceAmount: 0,
          walkable: true,
          movementCost: TERRAIN_MOVEMENT_COST[TerrainType.PLAINS],
        };
      }
    }
  }

  // ============ Map Generation ============

  /**
   * Procedurally generates terrain, placing water, mountains, forests, swamps,
   * and resource deposits. Uses layered value noise driven by a seeded PRNG.
   *
   * @param seed - Optional integer seed for deterministic generation. Defaults to 42.
   */
  generate(seed: number = 42): void {
    const rng = new SeededRNG(seed);
    const baseNoise = new ValueNoise(rng);
    const elevationNoise = new ValueNoise(rng);
    const moistureNoise = new ValueNoise(rng);

    // Noise sampling scales
    const BASE_SCALE = 0.08;
    const ELEVATION_SCALE = 0.1;
    const MOISTURE_SCALE = 0.12;

    // Thresholds -- tuned so roughly 30% of the map is water
    const WATER_THRESHOLD = 0.35;
    const MOUNTAIN_THRESHOLD = 0.72;
    const FOREST_THRESHOLD = 0.55;
    const SWAMP_THRESHOLD = 0.45;
    const MID_ELEVATION = 0.5;

    // Step 1: Assign terrain based on layered noise
    for (let row = 0; row < this.height; row++) {
      for (let col = 0; col < this.width; col++) {
        const baseVal = baseNoise.layered(col * BASE_SCALE, row * BASE_SCALE, 3, 2.0, 0.5);
        const elevation = elevationNoise.layered(
          col * ELEVATION_SCALE + 100, row * ELEVATION_SCALE + 100, 3, 2.0, 0.5,
        );
        const moisture = moistureNoise.layered(
          col * MOISTURE_SCALE + 200, row * MOISTURE_SCALE + 200, 3, 2.0, 0.5,
        );

        let terrain: TerrainType;

        if (baseVal < WATER_THRESHOLD) {
          terrain = TerrainType.WATER;
        } else if (elevation > MOUNTAIN_THRESHOLD) {
          terrain = TerrainType.MOUNTAIN;
        } else if (moisture > FOREST_THRESHOLD) {
          terrain = TerrainType.FOREST;
        } else if (moisture > SWAMP_THRESHOLD && elevation < MID_ELEVATION) {
          terrain = TerrainType.SWAMP;
        } else {
          terrain = TerrainType.PLAINS;
        }

        this.tiles[row][col] = {
          terrain,
          resource: null,
          resourceAmount: 0,
          walkable: terrain !== TerrainType.WATER,
          movementCost: TERRAIN_MOVEMENT_COST[terrain],
        };
      }
    }

    // Step 2: Clear corners for base placement (5x5 PLAINS areas)
    this.clearCorner(0, 0, 5);                                  // top-left
    this.clearCorner(0, this.width - 5, 5);                     // top-right
    this.clearCorner(this.height - 5, 0, 5);                    // bottom-left
    this.clearCorner(this.height - 5, this.width - 5, 5);       // bottom-right

    // Step 3: Ensure walkable connectivity between corners
    this.ensureCornerConnectivity();

    // Step 4: Place starter resource patches near each base corner
    this.placeStarterResources();

    // Step 5: Place resource deposits
    this.placeResources(rng);
  }

  /**
   * Clears a rectangular area to walkable PLAINS. Used to guarantee
   * base-placement zones in the map corners.
   */
  private clearCorner(startRow: number, startCol: number, size: number): void {
    for (let r = startRow; r < startRow + size && r < this.height; r++) {
      for (let c = startCol; c < startCol + size && c < this.width; c++) {
        if (r >= 0 && c >= 0) {
          this.tiles[r][c] = {
            terrain: TerrainType.PLAINS,
            resource: null,
            resourceAmount: 0,
            walkable: true,
            movementCost: TERRAIN_MOVEMENT_COST[TerrainType.PLAINS],
          };
        }
      }
    }
  }

  /**
   * Places small mineral and energy patches adjacent to each base corner
   * so players have resources to kick-start their economy without long walks.
   * Minerals are placed 5-7 tiles from the corner, energy 6-8 tiles.
   */
  private placeStarterResources(): void {
    const corners = [
      { row: 0, col: 0 },                                          // top-left
      { row: this.height - 5, col: this.width - 5 },               // bottom-right
    ];

    for (const corner of corners) {
      // Mineral patch: 3 tiles in an L just outside the 5x5 cleared zone
      const mineralPositions = [
        { col: corner.col + 5, row: corner.row + 2 },
        { col: corner.col + 5, row: corner.row + 3 },
        { col: corner.col + 6, row: corner.row + 3 },
      ];
      for (const pos of mineralPositions) {
        if (!this.isInBounds(pos)) continue;
        this.tiles[pos.row][pos.col] = {
          terrain: TerrainType.PLAINS,
          resource: ResourceType.MINERALS,
          resourceAmount: 1000,
          walkable: true,
          movementCost: TERRAIN_MOVEMENT_COST[TerrainType.PLAINS],
        };
      }

      // Energy patch: 2 tiles offset from minerals
      const energyPositions = [
        { col: corner.col + 3, row: corner.row + 5 },
        { col: corner.col + 4, row: corner.row + 5 },
      ];
      for (const pos of energyPositions) {
        if (!this.isInBounds(pos)) continue;
        this.tiles[pos.row][pos.col] = {
          terrain: TerrainType.PLAINS,
          resource: ResourceType.ENERGY,
          resourceAmount: 800,
          walkable: true,
          movementCost: TERRAIN_MOVEMENT_COST[TerrainType.PLAINS],
        };
      }
    }
  }

  /**
   * Ensures that the top-left and bottom-right corners are connected
   * by a walkable path. If BFS from (2,2) cannot reach (height-3, width-3),
   * carves a walkable corridor between them.
   */
  private ensureCornerConnectivity(): void {
    const start: GridPosition = { col: 2, row: 2 };
    const end: GridPosition = { col: this.width - 3, row: this.height - 3 };

    // BFS from start to see if end is reachable
    const visited = new Set<string>();
    const queue: GridPosition[] = [start];
    visited.add(`${start.col},${start.row}`);

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current.col === end.col && current.row === end.row) {
        return; // Already connected
      }
      for (const neighbor of hexNeighbors(current)) {
        const key = `${neighbor.col},${neighbor.row}`;
        if (!visited.has(key) && this.isInBounds(neighbor) && this.tiles[neighbor.row][neighbor.col].walkable) {
          visited.add(key);
          queue.push(neighbor);
        }
      }
    }

    // Not connected — carve a walkable L-shaped corridor
    // Go right from start to end.col, then down to end.row
    for (let col = start.col; col <= end.col; col++) {
      this.carveTile(start.row, col);
    }
    for (let row = start.row; row <= end.row; row++) {
      this.carveTile(row, end.col);
    }
  }

  /**
   * Converts a tile to walkable PLAINS if it is currently impassable.
   */
  private carveTile(row: number, col: number): void {
    if (!this.isInBounds({ col, row })) return;
    const tile = this.tiles[row][col];
    if (!tile.walkable) {
      this.tiles[row][col] = {
        terrain: TerrainType.PLAINS,
        resource: null,
        resourceAmount: 0,
        walkable: true,
        movementCost: TERRAIN_MOVEMENT_COST[TerrainType.PLAINS],
      };
    }
  }

  /**
   * Places MINERAL and ENERGY resource clusters on the map.
   *
   * - MINERALS: ~8 clusters of 3-5 tiles, preferring proximity to mountains.
   * - ENERGY: ~6 clusters of 2-4 tiles, preferring proximity to water edges.
   */
  private placeResources(rng: SeededRNG): void {
    // Collect candidate positions for each resource type
    const mountainAdjacent: GridPosition[] = [];
    const waterEdge: GridPosition[] = [];

    for (let row = 0; row < this.height; row++) {
      for (let col = 0; col < this.width; col++) {
        const tile = this.tiles[row][col];
        if (!tile.walkable) continue;

        const neighbors = this.getNeighbors({ col, row });
        const hasAdjacentMountain = neighbors.some(
          (n) => this.tiles[n.row][n.col].terrain === TerrainType.MOUNTAIN,
        );
        const hasAdjacentWater = neighbors.some(
          (n) => this.tiles[n.row][n.col].terrain === TerrainType.WATER,
        );

        if (hasAdjacentMountain) {
          mountainAdjacent.push({ col, row });
        }
        if (hasAdjacentWater) {
          waterEdge.push({ col, row });
        }
      }
    }

    // Place MINERAL clusters (~8 clusters, 3-5 tiles each)
    this.placeClusters(rng, ResourceType.MINERALS, mountainAdjacent, 8, 3, 5);

    // Place ENERGY clusters (~6 clusters, 2-4 tiles each)
    this.placeClusters(rng, ResourceType.ENERGY, waterEdge, 6, 2, 4);
  }

  /**
   * Places a number of resource clusters on the map. Picks a random
   * seed position from the candidates, then spreads outward to fill
   * the cluster size using walkable neighbors.
   */
  private placeClusters(
    rng: SeededRNG,
    resourceType: ResourceType,
    candidates: GridPosition[],
    clusterCount: number,
    minSize: number,
    maxSize: number,
  ): void {
    if (candidates.length === 0) {
      // Fallback: use any walkable tile that is not in a corner zone
      for (let row = 5; row < this.height - 5; row++) {
        for (let col = 5; col < this.width - 5; col++) {
          if (this.tiles[row][col].walkable && this.tiles[row][col].resource === null) {
            candidates.push({ col, row });
          }
        }
      }
    }

    const usedPositions = new Set<string>();

    for (let c = 0; c < clusterCount && candidates.length > 0; c++) {
      const seedIdx = rng.nextInt(0, candidates.length - 1);
      const seedPos = candidates[seedIdx];
      const posKey = `${seedPos.col},${seedPos.row}`;

      if (usedPositions.has(posKey)) continue;

      const clusterSize = rng.nextInt(minSize, maxSize);
      const clusterTiles: GridPosition[] = [seedPos];
      usedPositions.add(posKey);

      // BFS expansion to fill cluster
      let frontier = [seedPos];
      while (clusterTiles.length < clusterSize && frontier.length > 0) {
        const nextFrontier: GridPosition[] = [];
        for (const pos of frontier) {
          if (clusterTiles.length >= clusterSize) break;
          const neighbors = this.getNeighbors(pos).filter((n) => {
            const key = `${n.col},${n.row}`;
            return (
              this.tiles[n.row][n.col].walkable &&
              this.tiles[n.row][n.col].resource === null &&
              !usedPositions.has(key) &&
              !this.isInCornerZone(n)
            );
          });
          // Shuffle neighbors for variety
          for (let i = neighbors.length - 1; i > 0; i--) {
            const j = rng.nextInt(0, i);
            const tmp = neighbors[i];
            neighbors[i] = neighbors[j];
            neighbors[j] = tmp;
          }
          for (const neighbor of neighbors) {
            if (clusterTiles.length >= clusterSize) break;
            const nKey = `${neighbor.col},${neighbor.row}`;
            if (!usedPositions.has(nKey)) {
              clusterTiles.push(neighbor);
              usedPositions.add(nKey);
              nextFrontier.push(neighbor);
            }
          }
        }
        frontier = nextFrontier;
      }

      // Assign resource to all tiles in the cluster
      for (const pos of clusterTiles) {
        const amount = rng.nextInt(500, 1500);
        this.tiles[pos.row][pos.col].resource = resourceType;
        this.tiles[pos.row][pos.col].resourceAmount = amount;
      }
    }
  }

  /**
   * Checks whether a position falls within one of the 5x5 corner zones
   * reserved for base placement.
   */
  private isInCornerZone(pos: GridPosition): boolean {
    const inTopLeft = pos.row < 5 && pos.col < 5;
    const inTopRight = pos.row < 5 && pos.col >= this.width - 5;
    const inBottomLeft = pos.row >= this.height - 5 && pos.col < 5;
    const inBottomRight = pos.row >= this.height - 5 && pos.col >= this.width - 5;
    return inTopLeft || inTopRight || inBottomLeft || inBottomRight;
  }

  // ============ Tile Queries ============

  /**
   * Returns the tile at the given position, or undefined if out of bounds.
   */
  getTile(pos: GridPosition): MapTile | undefined {
    if (!this.isInBounds(pos)) return undefined;
    return this.tiles[pos.row][pos.col];
  }

  /**
   * Sets the tile at the given position. No-op if out of bounds.
   */
  setTile(pos: GridPosition, tile: MapTile): void {
    if (!this.isInBounds(pos)) return;
    this.tiles[pos.row][pos.col] = tile;
  }

  /**
   * Checks whether a position is within the map boundaries.
   */
  isInBounds(pos: GridPosition): boolean {
    return pos.col >= 0 && pos.col < this.width && pos.row >= 0 && pos.row < this.height;
  }

  /**
   * Checks whether a position is walkable (in bounds and tile is walkable).
   */
  isWalkable(pos: GridPosition): boolean {
    if (!this.isInBounds(pos)) return false;
    return this.tiles[pos.row][pos.col].walkable;
  }

  /**
   * Returns the effective movement cost for a tile, accounting for
   * unit-type bonuses (e.g., scouts move faster through rough terrain).
   *
   * @param pos - Grid position to query
   * @param unitType - Optional unit type for terrain bonus calculation
   * @returns Movement cost multiplier. Returns Infinity for impassable tiles.
   */
  getMovementCost(pos: GridPosition, unitType?: UnitType): number {
    const tile = this.getTile(pos);
    if (!tile) return Infinity;

    let cost = tile.movementCost;

    if (unitType === UnitType.SCOUT) {
      const bonus = SCOUT_TERRAIN_BONUS[tile.terrain];
      if (bonus !== undefined) {
        cost *= bonus;
      }
    }

    return cost;
  }

  /**
   * Returns all in-bounds hex neighbors of a position (6 directions).
   */
  getNeighbors(pos: GridPosition): GridPosition[] {
    return hexNeighbors(pos).filter((n) => this.isInBounds(n));
  }

  // ============ Resource & Position Search ============

  /**
   * Finds the nearest tile containing the specified resource type,
   * searching outward from the given position using BFS.
   *
   * @param pos - Starting position for the search
   * @param type - Resource type to search for
   * @param maxRange - Maximum search radius in tiles (default 20)
   * @returns The position of the nearest matching resource, or null if none found
   */
  /**
   * Finds the nearest tile containing any resource type, using a
   * Manhattan-distance scan outward from the given position.
   *
   * @param pos - Starting position for the search
   * @param maxRange - Maximum search radius in tiles (default 10)
   * @returns The position of the nearest resource, or null if none found
   */
  findNearestAnyResource(pos: GridPosition, maxRange: number = 10): GridPosition | null {
    let closest: GridPosition | null = null;
    let closestDist = Infinity;

    for (let dr = -maxRange; dr <= maxRange; dr++) {
      for (let dc = -maxRange; dc <= maxRange; dc++) {
        const dist = Math.abs(dc) + Math.abs(dr);
        if (dist > maxRange) continue;
        const target = { col: pos.col + dc, row: pos.row + dr };
        const tile = this.getTile(target);
        if (tile?.resource && tile.resourceAmount > 0 && dist < closestDist) {
          closest = target;
          closestDist = dist;
        }
      }
    }

    return closest;
  }

  findNearestResource(pos: GridPosition, type: ResourceType, maxRange: number = 20): GridPosition | null {
    const visited = new Set<string>();
    const queue: Array<{ position: GridPosition; distance: number }> = [];

    const startKey = `${pos.col},${pos.row}`;
    visited.add(startKey);
    queue.push({ position: pos, distance: 0 });

    let head = 0;
    while (head < queue.length) {
      const current = queue[head++];

      if (current.distance > maxRange) continue;

      const tile = this.getTile(current.position);
      if (tile && tile.resource === type && tile.resourceAmount > 0) {
        return current.position;
      }

      // Expand to neighbors
      const neighbors = this.getNeighbors(current.position);
      for (const neighbor of neighbors) {
        const key = `${neighbor.col},${neighbor.row}`;
        if (!visited.has(key)) {
          visited.add(key);
          queue.push({ position: neighbor, distance: current.distance + 1 });
        }
      }
    }

    return null;
  }

  /**
   * Finds an open (walkable, non-water, non-mountain) position near
   * the given coordinates, spiraling outward.
   *
   * @param near - Center position to search from
   * @param radius - Maximum search radius (default 10)
   * @returns A suitable open position, or null if none found
   */
  findOpenPosition(near: GridPosition, radius: number = 10): GridPosition | null {
    // Check the center position first
    if (this.isInBounds(near)) {
      const centerTile = this.tiles[near.row][near.col];
      if (centerTile.walkable && centerTile.terrain !== TerrainType.MOUNTAIN) {
        return near;
      }
    }

    // Spiral outward
    for (let dist = 1; dist <= radius; dist++) {
      for (let dr = -dist; dr <= dist; dr++) {
        for (let dc = -dist; dc <= dist; dc++) {
          // Only check tiles at the current ring distance
          if (Math.abs(dr) !== dist && Math.abs(dc) !== dist) continue;

          const candidate: GridPosition = {
            col: near.col + dc,
            row: near.row + dr,
          };

          if (!this.isInBounds(candidate)) continue;

          const tile = this.tiles[candidate.row][candidate.col];
          if (tile.walkable && tile.terrain !== TerrainType.MOUNTAIN) {
            return candidate;
          }
        }
      }
    }

    return null;
  }
}
