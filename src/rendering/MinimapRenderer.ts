// ============================================================
// Agent RTS - Minimap Renderer
// ============================================================

import {
  MapTile,
  UnitState,
  BuildingState,
  FogState,
  GameConfig,
  TERRAIN_COLORS,
  PLAYER_COLORS,
  GridPosition,
} from '../shared/types';

/**
 * State snapshot consumed by the minimap renderer each frame.
 */
export interface MinimapState {
  tiles: MapTile[][];
  units: Map<string, UnitState>;
  buildings: Map<string, BuildingState>;
  fog: FogState[][];
  config: GameConfig;
  cameraViewport: { x: number; y: number; width: number; height: number };
  localPlayerId: string;
  heatMapData: Map<string, number> | null;
  currentTick: number;
}

/**
 * Renders a minimap on the sidebar canvas.
 *
 * Shows a scaled-down view of the entire game world including terrain,
 * fog of war, buildings, units, and the current camera viewport outline.
 */
export class MinimapRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;

  /** Pixels per tile on the minimap (horizontal) */
  private scaleX: number = 1;

  /** Pixels per tile on the minimap (vertical) */
  private scaleY: number = 1;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Failed to obtain 2D rendering context from minimap canvas');
    }
    this.ctx = ctx;

    // Ensure canvas internal size matches its CSS display size
    this.canvas.width = this.canvas.clientWidth;
    this.canvas.height = this.canvas.clientHeight;
  }

  // ----------------------------------------------------------
  // Public API
  // ----------------------------------------------------------

  /**
   * Render the complete minimap from the given state.
   */
  render(state: MinimapState): void {
    const { ctx, canvas } = this;
    const { config } = state;

    // Recalculate scale each frame in case of resize
    canvas.width = canvas.clientWidth;
    canvas.height = canvas.clientHeight;
    this.scaleX = canvas.width / config.mapWidth;
    this.scaleY = canvas.height / config.mapHeight;

    // Clear
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Render layers
    this.renderTerrain(state);
    this.renderFog(state);
    this.renderHeatMap(state);
    this.renderBuildings(state);
    this.renderUnits(state);
    this.renderViewport(state);
  }

  /**
   * Convert a click position on the minimap canvas to a grid position.
   * The caller is responsible for centering the camera on the result.
   *
   * @param screenX - X coordinate relative to the minimap canvas
   * @param screenY - Y coordinate relative to the minimap canvas
   * @param config  - Game configuration for map dimensions
   * @returns The grid position corresponding to the click
   */
  handleClick(screenX: number, screenY: number, config: GameConfig): GridPosition {
    const col = Math.floor(screenX / this.scaleX);
    const row = Math.floor(screenY / this.scaleY);
    return {
      col: Math.max(0, Math.min(config.mapWidth - 1, col)),
      row: Math.max(0, Math.min(config.mapHeight - 1, row)),
    };
  }

  // ----------------------------------------------------------
  // Private render passes
  // ----------------------------------------------------------

  /**
   * Draw each map tile as a small rectangle using terrain colors.
   */
  private renderTerrain(state: MinimapState): void {
    const { ctx } = this;
    const { tiles, config } = state;

    for (let row = 0; row < config.mapHeight; row++) {
      for (let col = 0; col < config.mapWidth; col++) {
        const tile = tiles[row]?.[col];
        if (!tile) continue;

        ctx.fillStyle = TERRAIN_COLORS[tile.terrain];
        ctx.fillRect(
          col * this.scaleX,
          row * this.scaleY,
          Math.ceil(this.scaleX),
          Math.ceil(this.scaleY)
        );
      }
    }
  }

  /**
   * Draw fog overlay on the minimap.
   * UNEXPLORED = solid black, EXPLORED = semi-transparent black.
   */
  private renderFog(state: MinimapState): void {
    const { ctx } = this;
    const { fog, config } = state;

    if (!fog || fog.length === 0) return;

    for (let row = 0; row < config.mapHeight; row++) {
      for (let col = 0; col < config.mapWidth; col++) {
        const fogTile = fog[row]?.[col];
        if (!fogTile || fogTile === FogState.VISIBLE) continue;

        if (fogTile === FogState.UNEXPLORED) {
          ctx.fillStyle = '#000000';
        } else if (fogTile === FogState.EXPLORED) {
          ctx.fillStyle = 'rgba(0,0,0,0.6)';
        }

        ctx.fillRect(
          col * this.scaleX,
          row * this.scaleY,
          Math.ceil(this.scaleX),
          Math.ceil(this.scaleY)
        );
      }
    }
  }

  /**
   * Draw per-unit vision heat map overlay on the minimap.
   * Shows automatically when units are selected — green for recently seen,
   * fading to dark for old/never-seen tiles.
   */
  private renderHeatMap(state: MinimapState): void {
    if (!state.heatMapData) return;

    const { ctx } = this;
    const { config, currentTick } = state;
    const w = Math.ceil(this.scaleX);
    const h = Math.ceil(this.scaleY);

    for (let row = 0; row < config.mapHeight; row++) {
      for (let col = 0; col < config.mapWidth; col++) {
        const key = `${col},${row}`;
        const lastSeen = state.heatMapData.get(key);
        const px = col * this.scaleX;
        const py = row * this.scaleY;

        if (lastSeen === undefined) {
          // Never seen by selected unit(s) — dark overlay
          ctx.fillStyle = 'rgba(0,0,0,0.7)';
          ctx.fillRect(px, py, w, h);
        } else {
          const age = currentTick - lastSeen;
          if (age <= 1) {
            // Currently visible — bright green
            ctx.fillStyle = 'rgba(0,255,100,0.4)';
          } else if (age <= 100) {
            // Recent — fading green
            const alpha = 0.35 * (1 - age / 100);
            ctx.fillStyle = `rgba(0,255,100,${alpha.toFixed(3)})`;
          } else if (age <= 600) {
            // Old — very dim green
            const alpha = 0.15 * (1 - (age - 100) / 500);
            ctx.fillStyle = `rgba(0,200,80,${Math.max(0, alpha).toFixed(3)})`;
          } else {
            // Very old — dark
            ctx.fillStyle = 'rgba(0,0,0,0.5)';
          }
          ctx.fillRect(px, py, w, h);
        }
      }
    }
  }

  /**
   * Draw buildings as slightly larger colored dots on the minimap.
   */
  private renderBuildings(state: MinimapState): void {
    const { ctx } = this;
    const { buildings } = state;

    for (const building of buildings.values()) {
      const playerIndex = this.getPlayerIndex(building.playerId);
      const color = PLAYER_COLORS[playerIndex] || PLAYER_COLORS[0];

      const bx = building.position.col * this.scaleX;
      const by = building.position.row * this.scaleY;

      // Buildings are drawn slightly larger than a single tile
      const dotSize = Math.max(3, Math.ceil(this.scaleX * 2));

      ctx.fillStyle = color;
      ctx.fillRect(bx, by, dotSize, dotSize);
    }
  }

  /**
   * Draw units as small colored dots on the minimap.
   */
  private renderUnits(state: MinimapState): void {
    const { ctx } = this;
    const { units, fog, localPlayerId } = state;

    for (const unit of units.values()) {
      // Hide enemy units not in currently visible tiles
      if (unit.playerId !== localPlayerId) {
        const fogRow = fog[unit.position.row];
        if (!fogRow || fogRow[unit.position.col] !== FogState.VISIBLE) continue;
      }

      const playerIndex = this.getPlayerIndex(unit.playerId);
      const color = PLAYER_COLORS[playerIndex] || PLAYER_COLORS[0];

      const ux = unit.position.col * this.scaleX;
      const uy = unit.position.row * this.scaleY;

      // Units are small dots (2x2 pixels, scaled)
      const dotSize = Math.max(2, Math.ceil(this.scaleX));

      ctx.fillStyle = color;
      ctx.fillRect(ux, uy, dotSize, dotSize);
    }
  }

  /**
   * Draw the camera viewport as a white outline rectangle.
   */
  private renderViewport(state: MinimapState): void {
    const { ctx } = this;
    const { cameraViewport, config } = state;
    const { tileSize } = config;

    // Convert world-pixel viewport to minimap coordinates
    const vx = (cameraViewport.x / tileSize) * this.scaleX;
    const vy = (cameraViewport.y / tileSize) * this.scaleY;
    const vw = (cameraViewport.width / tileSize) * this.scaleX;
    const vh = (cameraViewport.height / tileSize) * this.scaleY;

    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1;
    ctx.strokeRect(vx, vy, vw, vh);
  }

  // ----------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------

  /**
   * Extract a 0-based player index from a player ID string.
   */
  private getPlayerIndex(playerId: string): number {
    const match = playerId.match(/(\d+)/);
    return match ? parseInt(match[1], 10) % PLAYER_COLORS.length : 0;
  }
}
