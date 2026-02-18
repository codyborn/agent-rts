import {
  GridPosition,
  UnitState,
  BuildingState,
  MapTile,
  Player,
  FogState,
  gridDistance,
  TerrainType,
} from '../shared/types';

// ============================================================
// GameState - Central state container for the Agent RTS engine
// ============================================================
// Holds all mutable game state: units, buildings, map grid,
// players, and per-player fog of war. Designed as a plain data
// store with query helpers -- all mutation logic lives in the
// engine systems that operate on this state each tick.
// ============================================================

export class GameState {
  private units: Map<string, UnitState> = new Map();
  private buildings: Map<string, BuildingState> = new Map();
  private mapTiles: MapTile[][] = [];
  private players: Map<string, Player> = new Map();
  private fog: Map<string, FogState[][]> = new Map();

  // ---- Units ------------------------------------------------

  /** Register a new unit in the game world. */
  addUnit(unit: UnitState): void {
    this.units.set(unit.id, unit);
  }

  /** Remove a unit by id. No-op if the unit does not exist. */
  removeUnit(id: string): void {
    this.units.delete(id);
  }

  /** Look up a single unit by id. */
  getUnit(id: string): UnitState | undefined {
    return this.units.get(id);
  }

  /** Return all units within Euclidean `range` of `pos`. */
  getUnitsInRange(pos: GridPosition, range: number): UnitState[] {
    const results: UnitState[] = [];
    for (const unit of this.units.values()) {
      if (gridDistance(pos, unit.position) <= range) {
        results.push(unit);
      }
    }
    return results;
  }

  /** Return all units belonging to a given player. */
  getUnitsForPlayer(playerId: string): UnitState[] {
    const results: UnitState[] = [];
    for (const unit of this.units.values()) {
      if (unit.playerId === playerId) {
        results.push(unit);
      }
    }
    return results;
  }

  /** Return every unit currently in the game. */
  getAllUnits(): UnitState[] {
    return Array.from(this.units.values());
  }

  // ---- Buildings --------------------------------------------

  /** Register a new building in the game world. */
  addBuilding(building: BuildingState): void {
    this.buildings.set(building.id, building);
  }

  /** Remove a building by id. No-op if the building does not exist. */
  removeBuilding(id: string): void {
    this.buildings.delete(id);
  }

  /** Look up a single building by id. */
  getBuilding(id: string): BuildingState | undefined {
    return this.buildings.get(id);
  }

  /** Return all buildings belonging to a given player. */
  getBuildingsForPlayer(playerId: string): BuildingState[] {
    const results: BuildingState[] = [];
    for (const building of this.buildings.values()) {
      if (building.playerId === playerId) {
        results.push(building);
      }
    }
    return results;
  }

  /** Return every building currently in the game. */
  getAllBuildings(): BuildingState[] {
    return Array.from(this.buildings.values());
  }

  // ---- Map --------------------------------------------------

  /**
   * Initialize the map grid with default PLAINS tiles.
   * Any existing tiles are replaced.
   */
  initMap(width: number, height: number): void {
    this.mapTiles = [];
    for (let row = 0; row < height; row++) {
      const rowTiles: MapTile[] = [];
      for (let col = 0; col < width; col++) {
        rowTiles.push({
          terrain: TerrainType.PLAINS,
          resource: null,
          resourceAmount: 0,
          walkable: true,
          movementCost: 1.0,
        });
      }
      this.mapTiles.push(rowTiles);
    }
  }

  /** Overwrite the entire map grid at once. */
  setMapTiles(tiles: MapTile[][]): void {
    this.mapTiles = tiles;
  }

  /** Return the full map grid. */
  getMapTiles(): MapTile[][] {
    return this.mapTiles;
  }

  /** Get a single tile by grid position. Returns undefined for out-of-bounds. */
  getTile(pos: GridPosition): MapTile | undefined {
    if (!this.isInBounds(pos)) {
      return undefined;
    }
    return this.mapTiles[pos.row][pos.col];
  }

  /** Set a single tile. No-op if out of bounds. */
  setTile(pos: GridPosition, tile: MapTile): void {
    if (!this.isInBounds(pos)) {
      return;
    }
    this.mapTiles[pos.row][pos.col] = tile;
  }

  /** Check whether a grid position falls within the current map bounds. */
  isInBounds(pos: GridPosition): boolean {
    if (this.mapTiles.length === 0) {
      return false;
    }
    return (
      pos.row >= 0 &&
      pos.row < this.mapTiles.length &&
      pos.col >= 0 &&
      pos.col < this.mapTiles[0].length
    );
  }

  /** Current map width in tiles, or 0 if no map is initialized. */
  get mapWidth(): number {
    return this.mapTiles.length > 0 ? this.mapTiles[0].length : 0;
  }

  /** Current map height in tiles, or 0 if no map is initialized. */
  get mapHeight(): number {
    return this.mapTiles.length;
  }

  // ---- Players ----------------------------------------------

  /** Register a player. */
  addPlayer(player: Player): void {
    this.players.set(player.id, player);
  }

  /** Look up a player by id. */
  getPlayer(id: string): Player | undefined {
    return this.players.get(id);
  }

  /** Return every registered player. */
  getAllPlayers(): Player[] {
    return Array.from(this.players.values());
  }

  // ---- Fog of War -------------------------------------------

  /**
   * Initialize a per-player fog grid. Every cell starts as UNEXPLORED.
   */
  initFog(playerId: string, width: number, height: number): void {
    const grid: FogState[][] = [];
    for (let row = 0; row < height; row++) {
      const rowFog: FogState[] = [];
      for (let col = 0; col < width; col++) {
        rowFog.push(FogState.UNEXPLORED);
      }
      grid.push(rowFog);
    }
    this.fog.set(playerId, grid);
  }

  /** Retrieve the fog grid for a given player. */
  getFog(playerId: string): FogState[][] | undefined {
    return this.fog.get(playerId);
  }

  /** Overwrite the fog grid for a given player. */
  setFog(playerId: string, fog: FogState[][]): void {
    this.fog.set(playerId, fog);
  }
}
