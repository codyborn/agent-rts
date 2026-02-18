// ============================================================
// Agent RTS - Main Canvas Renderer
// ============================================================

import {
  MapTile,
  UnitState,
  BuildingState,
  FogState,
  GameConfig,
  GridPosition,
  TerrainType,
  UnitType,
  ResourceType,
  TERRAIN_COLORS,
  UNIT_ICONS,
  UNIT_STATS,
  PLAYER_COLORS,
  positionToLabel,
  colToLabel,
} from '../shared/types';
import { Camera } from './Camera';

/**
 * State snapshot consumed by the renderer each frame.
 */
export interface RenderState {
  tiles: MapTile[][];
  units: Map<string, UnitState>;
  buildings: Map<string, BuildingState>;
  fog: FogState[][];
  config: GameConfig;
  selectedUnitIds: Set<string>;
  localPlayerId: string;
  selectionRect: { x: number; y: number; width: number; height: number } | null;
}

/**
 * Main canvas renderer for the game map, units, buildings, fog, and overlays.
 *
 * Draws the top-down game world each frame using the HTML5 Canvas 2D API.
 * All world-to-screen transformations are delegated to the Camera.
 */
export class Renderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private camera: Camera;

  constructor(canvas: HTMLCanvasElement, camera: Camera) {
    this.canvas = canvas;
    this.camera = camera;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Failed to obtain 2D rendering context from canvas');
    }
    this.ctx = ctx;
  }

  // ----------------------------------------------------------
  // Public API
  // ----------------------------------------------------------

  /**
   * Render a complete frame from the given state snapshot.
   */
  render(state: RenderState): void {
    const { ctx, canvas } = this;

    // 1. Clear canvas
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // 2. Render layers in order
    this.renderTerrain(state);
    this.renderGrid(state);
    this.renderBuildings(state);
    this.renderFog(state);
    this.renderUnits(state);
    this.renderSelectionBox(state);
  }

  /**
   * Resize the canvas to fill its container and update the camera dimensions.
   */
  handleResize(): void {
    // Account for the sidebar: the canvas is flex:1 inside game-container
    this.canvas.width = this.canvas.clientWidth;
    this.canvas.height = this.canvas.clientHeight;

    this.camera.resize(this.canvas.width, this.canvas.height);
  }

  // ----------------------------------------------------------
  // Private render passes
  // ----------------------------------------------------------

  /**
   * Draw terrain tiles using TERRAIN_COLORS. Resource deposits get
   * a small indicator shape on top.
   */
  private renderTerrain(state: RenderState): void {
    const { ctx, camera } = this;
    const { config, tiles } = state;
    const { tileSize } = config;

    const bounds = camera.getVisibleGridBounds(tileSize, config.mapWidth, config.mapHeight);

    for (let row = bounds.minRow; row <= bounds.maxRow; row++) {
      for (let col = bounds.minCol; col <= bounds.maxCol; col++) {
        const tile = tiles[row]?.[col];
        if (!tile) continue;

        const screen = camera.gridToScreen({ col, row }, tileSize);
        const size = tileSize * camera.zoom;

        // Fill terrain color
        ctx.fillStyle = TERRAIN_COLORS[tile.terrain];
        ctx.fillRect(screen.x, screen.y, size, size);

        // Resource indicator
        if (tile.resource && tile.resourceAmount > 0) {
          const cx = screen.x + size / 2;
          const cy = screen.y + size / 2;
          const indicatorSize = size * 0.25;

          if (tile.resource === ResourceType.MINERALS) {
            // Diamond shape for minerals (cyan)
            ctx.fillStyle = '#5ac8fa';
            ctx.beginPath();
            ctx.moveTo(cx, cy - indicatorSize);
            ctx.lineTo(cx + indicatorSize, cy);
            ctx.lineTo(cx, cy + indicatorSize);
            ctx.lineTo(cx - indicatorSize, cy);
            ctx.closePath();
            ctx.fill();
          } else if (tile.resource === ResourceType.ENERGY) {
            // Circle for energy (yellow)
            ctx.fillStyle = '#ffcc02';
            ctx.beginPath();
            ctx.arc(cx, cy, indicatorSize, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
    }
  }

  /**
   * Draw subtle grid lines and axis labels (column letters, row numbers).
   */
  private renderGrid(state: RenderState): void {
    const { ctx, camera } = this;
    const { config } = state;
    const { tileSize } = config;

    const bounds = camera.getVisibleGridBounds(tileSize, config.mapWidth, config.mapHeight);
    const size = tileSize * camera.zoom;

    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;

    // Vertical lines
    for (let col = bounds.minCol; col <= bounds.maxCol + 1; col++) {
      const screen = camera.worldToScreen(col * tileSize, 0);
      ctx.beginPath();
      ctx.moveTo(Math.round(screen.x), 0);
      ctx.lineTo(Math.round(screen.x), this.canvas.height);
      ctx.stroke();
    }

    // Horizontal lines
    for (let row = bounds.minRow; row <= bounds.maxRow + 1; row++) {
      const screen = camera.worldToScreen(0, row * tileSize);
      ctx.beginPath();
      ctx.moveTo(0, Math.round(screen.y));
      ctx.lineTo(this.canvas.width, Math.round(screen.y));
      ctx.stroke();
    }

    // Axis labels
    const labelFontSize = Math.max(8, Math.min(12, size * 0.35));
    ctx.font = `${labelFontSize}px 'Courier New', monospace`;
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';

    // Column labels along the top
    for (let col = bounds.minCol; col <= bounds.maxCol; col++) {
      const screen = camera.gridToScreen({ col, row: 0 }, tileSize);
      const labelX = screen.x + size / 2;
      const labelY = Math.max(2, screen.y + 2);
      ctx.fillText(colToLabel(col), labelX, labelY);
    }

    // Row labels along the left
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    for (let row = bounds.minRow; row <= bounds.maxRow; row++) {
      const screen = camera.gridToScreen({ col: 0, row }, tileSize);
      const labelX = Math.max(2, screen.x + 2);
      const labelY = screen.y + size / 2;
      ctx.fillText(String(row + 1), labelX, labelY);
    }
  }

  /**
   * Draw buildings as colored rectangles with type abbreviation.
   * Shows a construction progress bar if still being built.
   */
  private renderBuildings(state: RenderState): void {
    const { ctx, camera } = this;
    const { config, buildings } = state;
    const { tileSize } = config;

    const abbreviations: Record<string, string> = {
      base: 'B',
      barracks: 'R',
      factory: 'F',
      watchtower: 'W',
    };

    for (const building of buildings.values()) {
      const pos = building.position;
      if (!camera.isGridVisible(pos, tileSize)) continue;

      const screen = camera.gridToScreen(pos, tileSize);
      const size = tileSize * camera.zoom;

      // Watchtower is 1x1, all others are 2x2
      const bWidth = building.type === 'watchtower' ? size : size * 2;
      const bHeight = building.type === 'watchtower' ? size : size * 2;

      // Player color
      const playerIndex = this.getPlayerIndex(building.playerId);
      const color = PLAYER_COLORS[playerIndex] || PLAYER_COLORS[0];

      // Fill
      ctx.fillStyle = color;
      ctx.globalAlpha = building.isConstructing ? 0.5 : 0.8;
      ctx.fillRect(screen.x, screen.y, bWidth, bHeight);
      ctx.globalAlpha = 1.0;

      // Border
      ctx.strokeStyle = 'rgba(255,255,255,0.4)';
      ctx.lineWidth = 1;
      ctx.strokeRect(screen.x, screen.y, bWidth, bHeight);

      // Abbreviation text
      const abbr = abbreviations[building.type] || '?';
      const fontSize = Math.max(10, bWidth * 0.35);
      ctx.font = `bold ${fontSize}px 'Courier New', monospace`;
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(abbr, screen.x + bWidth / 2, screen.y + bHeight / 2);

      // Construction progress bar
      if (building.isConstructing) {
        const barWidth = bWidth * 0.8;
        const barHeight = 4 * camera.zoom;
        const barX = screen.x + (bWidth - barWidth) / 2;
        const barY = screen.y + bHeight + 2;

        // Background
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(barX, barY, barWidth, barHeight);

        // Progress fill
        ctx.fillStyle = '#ffcc02';
        ctx.fillRect(barX, barY, barWidth * building.constructionProgress, barHeight);
      }
    }
  }

  /**
   * Draw fog of war overlay per tile.
   * UNEXPLORED = solid black, EXPLORED = semi-transparent, VISIBLE = no overlay.
   */
  private renderFog(state: RenderState): void {
    const { ctx, camera } = this;
    const { config, fog } = state;
    const { tileSize } = config;

    if (!fog || fog.length === 0) return;

    const bounds = camera.getVisibleGridBounds(tileSize, config.mapWidth, config.mapHeight);

    for (let row = bounds.minRow; row <= bounds.maxRow; row++) {
      for (let col = bounds.minCol; col <= bounds.maxCol; col++) {
        const fogTile = fog[row]?.[col];
        if (!fogTile || fogTile === FogState.VISIBLE) continue;

        const screen = camera.gridToScreen({ col, row }, tileSize);
        const size = tileSize * camera.zoom;

        if (fogTile === FogState.UNEXPLORED) {
          ctx.fillStyle = '#000000';
          ctx.fillRect(screen.x, screen.y, size, size);
        } else if (fogTile === FogState.EXPLORED) {
          ctx.fillStyle = 'rgba(0,0,0,0.6)';
          ctx.fillRect(screen.x, screen.y, size, size);
        }
      }
    }
  }

  /**
   * Draw all visible units as colored circles with icon letters.
   * Selected units get a green ring, all units show a health bar.
   * Units with a path show a dotted line to their target.
   */
  private renderUnits(state: RenderState): void {
    const { ctx, camera } = this;
    const { config, units, selectedUnitIds, fog, localPlayerId } = state;
    const { tileSize } = config;

    for (const unit of units.values()) {
      const pos = unit.position;
      if (!camera.isGridVisible(pos, tileSize)) continue;

      // Hide enemy units that aren't in currently visible tiles
      if (unit.playerId !== localPlayerId) {
        const fogRow = fog[pos.row];
        if (!fogRow || fogRow[pos.col] !== FogState.VISIBLE) continue;
      }

      const screen = camera.gridToScreen(pos, tileSize);
      const size = tileSize * camera.zoom;
      const cx = screen.x + size / 2;
      const cy = screen.y + size / 2;
      const radius = size * 0.35;

      // Player color
      const playerIndex = this.getPlayerIndex(unit.playerId);
      const color = PLAYER_COLORS[playerIndex] || PLAYER_COLORS[0];

      // Draw path if unit has one
      if (unit.path && unit.path.length > 0) {
        this.renderUnitPath(unit, cx, cy, tileSize, size);
      }

      // Selection ring (draw behind the unit circle)
      if (selectedUnitIds.has(unit.id)) {
        ctx.strokeStyle = '#53d769';
        ctx.lineWidth = 2 * camera.zoom;
        ctx.beginPath();
        ctx.arc(cx, cy, radius + 2 * camera.zoom, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Unit circle
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fill();

      // Unit icon letter
      const icon = UNIT_ICONS[unit.type] || '?';
      const fontSize = Math.max(8, radius * 1.2);
      ctx.font = `bold ${fontSize}px 'Courier New', monospace`;
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(icon, cx, cy);

      // Health bar above the unit
      this.renderHealthBar(unit, cx, cy, radius, size);
    }
  }

  /**
   * Draw a dotted line from unit center to each waypoint along its path.
   */
  private renderUnitPath(
    unit: UnitState,
    startCx: number,
    startCy: number,
    tileSize: number,
    size: number
  ): void {
    const { ctx, camera } = this;

    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4 * camera.zoom, 4 * camera.zoom]);

    ctx.beginPath();
    ctx.moveTo(startCx, startCy);

    for (const waypoint of unit.path!) {
      const wpScreen = camera.gridToScreen(waypoint, tileSize);
      const wpCx = wpScreen.x + size / 2;
      const wpCy = wpScreen.y + size / 2;
      ctx.lineTo(wpCx, wpCy);
    }

    ctx.stroke();
    ctx.setLineDash([]);
  }

  /**
   * Draw a small health bar above a unit.
   * Color transitions: green > 50%, yellow > 25%, red <= 25%.
   */
  private renderHealthBar(
    unit: UnitState,
    cx: number,
    cy: number,
    radius: number,
    size: number
  ): void {
    const { ctx, camera } = this;

    const stats = UNIT_STATS[unit.type];
    if (!stats) return;

    const barWidth = size * 0.6;
    const barHeight = 3 * camera.zoom;
    const barX = cx - barWidth / 2;
    const barY = cy - radius - 4 * camera.zoom - barHeight;
    const healthPercent = Math.max(0, Math.min(1, unit.health / stats.maxHealth));

    // Background
    ctx.fillStyle = 'rgba(255,0,0,0.6)';
    ctx.fillRect(barX, barY, barWidth, barHeight);

    // Health fill
    const healthColor =
      healthPercent > 0.5 ? '#53d769' : healthPercent > 0.25 ? '#ffcc02' : '#ff3b30';
    ctx.fillStyle = healthColor;
    ctx.fillRect(barX, barY, barWidth * healthPercent, barHeight);
  }

  /**
   * Draw a dashed selection rectangle when the user is drag-selecting.
   */
  private renderSelectionBox(state: RenderState): void {
    if (!state.selectionRect) return;

    const { ctx } = this;
    const { x, y, width, height } = state.selectionRect;

    ctx.strokeStyle = '#53d769';
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 3]);
    ctx.strokeRect(x, y, width, height);
    ctx.setLineDash([]);

    // Semi-transparent fill
    ctx.fillStyle = 'rgba(83, 215, 105, 0.1)';
    ctx.fillRect(x, y, width, height);
  }

  // ----------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------

  /**
   * Extract a 0-based player index from a player ID string.
   * Expects formats like "player-0", "player-1", or just "0", "1".
   */
  private getPlayerIndex(playerId: string): number {
    const match = playerId.match(/(\d+)/);
    return match ? parseInt(match[1], 10) % PLAYER_COLORS.length : 0;
  }
}
