// ============================================================
// Agent RTS - Main Canvas Renderer
// ============================================================

import {
  MapTile,
  UnitState,
  BuildingState,
  BuildingType,
  FogState,
  GameConfig,
  GridPosition,
  UnitType,
  ResourceType,
  UnitBehaviorState,
  UNIT_STATS,
  PLAYER_COLORS,
  positionToLabel,
  colToLabel,
} from '../shared/types';
import { Camera } from './Camera';
import { SpriteManager, behaviorToAnimState } from './SpriteManager';
import { TerrainTextureManager, TEX_W, TEX_H } from './TerrainTextureManager';
import { hexToPixel, traceHexPath, HEX_SIZE, HEX_WIDTH, HEX_HEIGHT } from '../hex/HexUtils';

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
  currentTick: number;
  buildPlacementMode: { buildingType: BuildingType; mouseGridPos: GridPosition } | null;
  heatMapData: Map<string, number> | null;
  /** Unit IDs currently sharing vision history via idle proximity. */
  sharingUnitIds: Set<string>;
  /** Currently hovered hex tile for hover highlight. */
  hoveredHex: GridPosition | null;
}

/**
 * Main canvas renderer for the game map, units, buildings, fog, and overlays.
 */
export class Renderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private camera: Camera;
  private spriteManager: SpriteManager;
  private terrainTextures: TerrainTextureManager;

  constructor(canvas: HTMLCanvasElement, camera: Camera, spriteManager: SpriteManager, terrainTextures: TerrainTextureManager) {
    this.canvas = canvas;
    this.camera = camera;
    this.spriteManager = spriteManager;
    this.terrainTextures = terrainTextures;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Failed to obtain 2D rendering context from canvas');
    }
    this.ctx = ctx;
  }

  // ----------------------------------------------------------
  // Public API
  // ----------------------------------------------------------

  render(state: RenderState): void {
    const { ctx, canvas } = this;

    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    this.renderTerrain(state);
    this.renderGrid(state);
    this.renderHoverHighlight(state);
    this.renderBuildings(state);
    this.renderFog(state);
    this.renderHeatMap(state);
    this.renderUnits(state);
    this.renderBuildPlacement(state);
    this.renderSelectionBox(state);
  }

  handleResize(): void {
    this.canvas.width = this.canvas.clientWidth;
    this.canvas.height = this.canvas.clientHeight;
    this.camera.resize(this.canvas.width, this.canvas.height);
  }

  // ----------------------------------------------------------
  // Private render passes
  // ----------------------------------------------------------

  private renderTerrain(state: RenderState): void {
    const { ctx, camera, terrainTextures } = this;
    const { config, tiles } = state;
    const { tileSize } = config;

    const bounds = camera.getVisibleGridBounds(tileSize, config.mapWidth, config.mapHeight);
    const scaledSize = HEX_SIZE * camera.zoom;
    const drawW = TEX_W * camera.zoom;
    const drawH = TEX_H * camera.zoom;

    // Compute water animation frame once (cycles every 500ms)
    const waterAnimFrame = Math.floor(performance.now() / 500) % 3;

    for (let row = bounds.minRow; row <= bounds.maxRow; row++) {
      for (let col = bounds.minCol; col <= bounds.maxCol; col++) {
        const tile = tiles[row]?.[col];
        if (!tile) continue;

        const center = camera.gridToScreenCenter({ col, row });
        const tex = terrainTextures.getTexture(tile.terrain, col, row, waterAnimFrame);

        ctx.drawImage(
          tex as any,
          0, 0, TEX_W, TEX_H,
          center.x - drawW / 2, center.y - drawH / 2, drawW, drawH,
        );

        if (tile.resource && tile.resourceAmount > 0) {
          const indicatorSize = scaledSize * 0.25;

          if (tile.resource === ResourceType.MINERALS) {
            ctx.fillStyle = '#5ac8fa';
            ctx.beginPath();
            ctx.moveTo(center.x, center.y - indicatorSize);
            ctx.lineTo(center.x + indicatorSize, center.y);
            ctx.lineTo(center.x, center.y + indicatorSize);
            ctx.lineTo(center.x - indicatorSize, center.y);
            ctx.closePath();
            ctx.fill();
          } else if (tile.resource === ResourceType.ENERGY) {
            ctx.fillStyle = '#ffcc02';
            ctx.beginPath();
            ctx.arc(center.x, center.y, indicatorSize, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
    }
  }

  private renderGrid(state: RenderState): void {
    const { ctx, camera } = this;
    const { config } = state;
    const { tileSize } = config;

    const bounds = camera.getVisibleGridBounds(tileSize, config.mapWidth, config.mapHeight);
    const scaledSize = HEX_SIZE * camera.zoom;

    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;

    for (let row = bounds.minRow; row <= bounds.maxRow; row++) {
      for (let col = bounds.minCol; col <= bounds.maxCol; col++) {
        const center = camera.gridToScreenCenter({ col, row });
        traceHexPath(ctx, center.x, center.y, scaledSize);
        ctx.stroke();
      }
    }

    // Column labels along the top
    const labelFontSize = Math.max(8, Math.min(12, scaledSize * 0.6));
    ctx.font = `${labelFontSize}px 'Courier New', monospace`;
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';

    for (let col = bounds.minCol; col <= bounds.maxCol; col++) {
      const center = camera.gridToScreenCenter({ col, row: 0 });
      ctx.fillText(colToLabel(col), center.x, Math.max(2, center.y - scaledSize + 2));
    }

    // Row labels along the left
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    for (let row = bounds.minRow; row <= bounds.maxRow; row++) {
      const center = camera.gridToScreenCenter({ col: 0, row });
      ctx.fillText(String(row + 1), Math.max(2, center.x - scaledSize + 2), center.y);
    }
  }

  /**
   * Draw buildings using pixel sprites from SpriteManager.
   * Buildings are 1-hex footprint, drawn at hex center.
   */
  private renderBuildings(state: RenderState): void {
    const { ctx, camera } = this;
    const { config, buildings } = state;
    const { tileSize } = config;
    const scaledW = HEX_WIDTH * camera.zoom;
    const scaledH = HEX_HEIGHT * camera.zoom;

    for (const building of buildings.values()) {
      const pos = building.position;
      if (!camera.isGridVisible(pos, tileSize)) continue;

      const center = camera.gridToScreenCenter(pos);
      const bWidth = scaledW;
      const bHeight = scaledH;
      const screen = { x: center.x - bWidth / 2, y: center.y - bHeight / 2 };

      const playerIndex = this.getPlayerIndex(building.playerId);

      if (building.isConstructing) {
        this.renderConstructingBuilding(building, screen, bWidth, bHeight, playerIndex);
      } else {
        const sprite = this.spriteManager.getBuildingSprite(building.type, playerIndex, false);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(
          sprite.canvas as any,
          sprite.sx, sprite.sy, sprite.sw, sprite.sh,
          screen.x, screen.y, bWidth, bHeight,
        );
        ctx.imageSmoothingEnabled = true;
      }
    }
  }

  /**
   * Draw a building under construction as a partial structure rising from
   * a foundation, with scaffold lines and a labelled progress bar.
   */
  private renderConstructingBuilding(
    building: BuildingState,
    screen: { x: number; y: number },
    bWidth: number,
    bHeight: number,
    playerIndex: number,
  ): void {
    const { ctx, camera } = this;
    const progress = building.constructionProgress; // 0.0 – 1.0

    // ---- Foundation outline (always visible) ----
    ctx.strokeStyle = 'rgba(139, 90, 43, 0.7)';
    ctx.lineWidth = 1.5 * camera.zoom;
    ctx.setLineDash([4 * camera.zoom, 3 * camera.zoom]);
    ctx.strokeRect(screen.x + 1, screen.y + 1, bWidth - 2, bHeight - 2);
    ctx.setLineDash([]);

    // ---- Foundation fill ----
    ctx.fillStyle = 'rgba(90, 60, 30, 0.25)';
    ctx.fillRect(screen.x, screen.y, bWidth, bHeight);

    // ---- Partial building sprite (clip from bottom up) ----
    const sprite = this.spriteManager.getBuildingSprite(building.type, playerIndex, true);
    const revealFraction = progress;
    const revealPixels = Math.ceil(bHeight * revealFraction);

    if (revealPixels > 0) {
      // Compute the bottom portion of the source sprite to draw
      const srcReveal = Math.ceil(sprite.sh * revealFraction);
      const srcY = sprite.sy + sprite.sh - srcReveal;
      const dstY = screen.y + bHeight - revealPixels;

      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(
        sprite.canvas as any,
        sprite.sx, srcY, sprite.sw, srcReveal,
        screen.x, dstY, bWidth, revealPixels,
      );
      ctx.imageSmoothingEnabled = true;

      // ---- Construction edge line (top of revealed portion) ----
      ctx.strokeStyle = 'rgba(255, 204, 2, 0.6)';
      ctx.lineWidth = 1 * camera.zoom;
      ctx.beginPath();
      ctx.moveTo(screen.x, dstY);
      ctx.lineTo(screen.x + bWidth, dstY);
      ctx.stroke();
    }

    // ---- Scaffold lines (cross-braces over unrevealed area) ----
    const unrevealedHeight = bHeight - revealPixels;
    if (unrevealedHeight > 4 * camera.zoom) {
      ctx.strokeStyle = 'rgba(139, 90, 43, 0.35)';
      ctx.lineWidth = 1 * camera.zoom;
      // Vertical scaffold poles
      const poleX1 = screen.x + bWidth * 0.25;
      const poleX2 = screen.x + bWidth * 0.75;
      ctx.beginPath();
      ctx.moveTo(poleX1, screen.y);
      ctx.lineTo(poleX1, screen.y + unrevealedHeight);
      ctx.moveTo(poleX2, screen.y);
      ctx.lineTo(poleX2, screen.y + unrevealedHeight);
      ctx.stroke();
      // Horizontal braces
      const braceSpacing = 8 * camera.zoom;
      for (let y = screen.y + braceSpacing; y < screen.y + unrevealedHeight; y += braceSpacing) {
        ctx.beginPath();
        ctx.moveTo(poleX1, y);
        ctx.lineTo(poleX2, y);
        ctx.stroke();
      }
      // Cross diagonals
      ctx.strokeStyle = 'rgba(139, 90, 43, 0.2)';
      ctx.beginPath();
      ctx.moveTo(poleX1, screen.y);
      ctx.lineTo(poleX2, screen.y + unrevealedHeight);
      ctx.moveTo(poleX2, screen.y);
      ctx.lineTo(poleX1, screen.y + unrevealedHeight);
      ctx.stroke();
    }

    // ---- Progress bar ----
    const barWidth = bWidth * 0.85;
    const barHeight = 5 * camera.zoom;
    const barX = screen.x + (bWidth - barWidth) / 2;
    const barY = screen.y + bHeight + 3 * camera.zoom;

    // Background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(barX - 1, barY - 1, barWidth + 2, barHeight + 2);
    // Track
    ctx.fillStyle = 'rgba(80, 80, 80, 0.6)';
    ctx.fillRect(barX, barY, barWidth, barHeight);
    // Fill
    ctx.fillStyle = '#ffcc02';
    ctx.fillRect(barX, barY, barWidth * progress, barHeight);

    // Percentage label
    const pct = Math.round(progress * 100);
    const fontSize = Math.max(8, Math.round(9 * camera.zoom));
    ctx.font = `bold ${fontSize}px 'Courier New', monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(`${pct}%`, screen.x + bWidth / 2, barY + barHeight + 2 * camera.zoom);
  }

  private renderFog(state: RenderState): void {
    const { ctx, camera } = this;
    const { config, fog } = state;
    const { tileSize } = config;

    if (!fog || fog.length === 0) return;

    const bounds = camera.getVisibleGridBounds(tileSize, config.mapWidth, config.mapHeight);
    const scaledSize = HEX_SIZE * camera.zoom;

    for (let row = bounds.minRow; row <= bounds.maxRow; row++) {
      for (let col = bounds.minCol; col <= bounds.maxCol; col++) {
        const fogTile = fog[row]?.[col];
        if (!fogTile || fogTile === FogState.VISIBLE) continue;

        const center = camera.gridToScreenCenter({ col, row });

        if (fogTile === FogState.UNEXPLORED) {
          ctx.fillStyle = '#000000';
        } else if (fogTile === FogState.EXPLORED) {
          ctx.fillStyle = 'rgba(0,0,0,0.6)';
        }
        traceHexPath(ctx, center.x, center.y, scaledSize);
        ctx.fill();
      }
    }
  }

  /**
   * Render per-unit vision heat map overlay.
   */
  private renderHeatMap(state: RenderState): void {
    if (!state.heatMapData) return;

    const { ctx, camera } = this;
    const { config } = state;
    const { tileSize } = config;
    const currentTick = state.currentTick;
    const scaledSize = HEX_SIZE * camera.zoom;

    const bounds = camera.getVisibleGridBounds(tileSize, config.mapWidth, config.mapHeight);

    for (let row = bounds.minRow; row <= bounds.maxRow; row++) {
      for (let col = bounds.minCol; col <= bounds.maxCol; col++) {
        const center = camera.gridToScreenCenter({ col, row });
        const key = `${col},${row}`;
        const lastSeen = state.heatMapData.get(key);

        if (lastSeen === undefined) {
          ctx.fillStyle = 'rgba(0,0,0,0.7)';
        } else {
          const age = currentTick - lastSeen;
          if (age <= 1) {
            ctx.fillStyle = 'rgba(0,255,100,0.25)';
          } else if (age <= 100) {
            const alpha = 0.2 * (1 - age / 100);
            ctx.fillStyle = `rgba(0,255,100,${alpha.toFixed(3)})`;
          } else if (age <= 600) {
            const alpha = 0.15 * (1 - (age - 100) / 500);
            ctx.fillStyle = `rgba(0,200,80,${Math.max(0, alpha).toFixed(3)})`;
          } else {
            ctx.fillStyle = 'rgba(0,0,0,0.5)';
          }
        }
        traceHexPath(ctx, center.x, center.y, scaledSize);
        ctx.fill();
      }
    }

    // Label
    ctx.fillStyle = 'rgba(0,255,100,0.8)';
    ctx.font = "bold 14px 'Courier New', monospace";
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('HEAT MAP [H to toggle]', 10, 40);
  }

  /**
   * Draw all visible units using pixel sprites with smooth movement interpolation.
   */
  private renderUnits(state: RenderState): void {
    const { ctx, camera } = this;
    const { config, units, selectedUnitIds, fog, localPlayerId, currentTick } = state;
    const { tileSize } = config;
    const now = performance.now();
    const MOVE_DURATION_MS = 200;

    for (const unit of units.values()) {
      const pos = unit.position;
      if (!camera.isGridVisible(pos, tileSize)) continue;

      if (unit.playerId !== localPlayerId) {
        const fogRow = fog[pos.row];
        if (!fogRow || fogRow[pos.col] !== FogState.VISIBLE) continue;
      }

      // Smooth movement interpolation
      let worldX: number, worldY: number;
      if (unit.previousPosition && unit.moveStartTime > 0) {
        const t = Math.min(1, (now - unit.moveStartTime) / MOVE_DURATION_MS);
        const prevWorld = hexToPixel(unit.previousPosition);
        const currWorld = hexToPixel(unit.position);
        worldX = prevWorld.x + (currWorld.x - prevWorld.x) * t;
        worldY = prevWorld.y + (currWorld.y - prevWorld.y) * t;
      } else {
        const currWorld = hexToPixel(unit.position);
        worldX = currWorld.x;
        worldY = currWorld.y;
      }

      const screenCenter = camera.worldToScreen(worldX, worldY);
      const cx = screenCenter.x;
      const cy = screenCenter.y;
      const size = HEX_HEIGHT * camera.zoom;
      const radius = size * 0.35;
      const drawX = cx - size / 2;
      const drawY = cy - size / 2;

      const playerIndex = this.getPlayerIndex(unit.playerId);

      // Draw path if unit has one
      if (unit.path && unit.path.length > 0) {
        this.renderUnitPath(unit, cx, cy, tileSize, size);
      }

      // Selection ring
      if (selectedUnitIds.has(unit.id)) {
        ctx.strokeStyle = '#53d769';
        ctx.lineWidth = 2 * camera.zoom;
        ctx.beginPath();
        ctx.arc(cx, cy, radius + 2 * camera.zoom, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Draw unit sprite
      const animState = behaviorToAnimState(unit.behaviorState);
      const frame = this.spriteManager.getUnitFrame(unit.type, playerIndex, animState, currentTick);

      ctx.save();
      ctx.imageSmoothingEnabled = false;

      if (unit.facingDirection === 'left') {
        ctx.translate(drawX + size, drawY);
        ctx.scale(-1, 1);
        ctx.drawImage(
          frame.canvas as any,
          frame.sx, frame.sy, frame.sw, frame.sh,
          0, 0, size, size,
        );
      } else {
        ctx.drawImage(
          frame.canvas as any,
          frame.sx, frame.sy, frame.sw, frame.sh,
          drawX, drawY, size, size,
        );
      }

      ctx.imageSmoothingEnabled = true;
      ctx.restore();

      // Health bar above the unit
      this.renderHealthBar(unit, cx, cy, radius, size);

      // Speech bubble icon when sharing vision with a nearby idle unit
      if (state.sharingUnitIds.has(unit.id)) {
        this.renderSharingIcon(cx, cy, radius, camera.zoom);
      }
    }
  }

  private renderUnitPath(
    unit: UnitState,
    startCx: number,
    startCy: number,
    _tileSize: number,
    _size: number
  ): void {
    const { ctx, camera } = this;

    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4 * camera.zoom, 4 * camera.zoom]);

    ctx.beginPath();
    ctx.moveTo(startCx, startCy);

    for (const waypoint of unit.path!) {
      const wpCenter = camera.gridToScreenCenter(waypoint);
      ctx.lineTo(wpCenter.x, wpCenter.y);
    }

    ctx.stroke();
    ctx.setLineDash([]);
  }

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

    ctx.fillStyle = 'rgba(255,0,0,0.6)';
    ctx.fillRect(barX, barY, barWidth, barHeight);

    const healthColor =
      healthPercent > 0.5 ? '#53d769' : healthPercent > 0.25 ? '#ffcc02' : '#ff3b30';
    ctx.fillStyle = healthColor;
    ctx.fillRect(barX, barY, barWidth * healthPercent, barHeight);
  }

  /**
   * Draw a small speech-bubble icon above a unit that is sharing vision.
   */
  private renderSharingIcon(cx: number, cy: number, radius: number, zoom: number): void {
    const { ctx } = this;
    const iconSize = 8 * zoom;
    const ix = cx;
    const iy = cy - radius - 12 * zoom;

    ctx.save();

    // Bubble body
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.beginPath();
    ctx.roundRect(
      ix - iconSize / 2, iy - iconSize / 2,
      iconSize, iconSize * 0.75,
      2 * zoom,
    );
    ctx.fill();

    // Bubble tail
    ctx.beginPath();
    ctx.moveTo(ix - 1.5 * zoom, iy + iconSize * 0.25);
    ctx.lineTo(ix - 3 * zoom, iy + iconSize * 0.5);
    ctx.lineTo(ix + 0.5 * zoom, iy + iconSize * 0.25);
    ctx.fill();

    // "..." dots inside the bubble
    ctx.fillStyle = '#5ac8fa';
    const dotR = 0.7 * zoom;
    const dotY = iy - iconSize * 0.05;
    for (let d = -1; d <= 1; d++) {
      ctx.beginPath();
      ctx.arc(ix + d * 2.2 * zoom, dotY, dotR, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  /**
   * Draw build placement ghost at cursor position (hex polygon).
   */
  private renderBuildPlacement(state: RenderState): void {
    if (!state.buildPlacementMode) return;

    const { ctx, camera } = this;
    const { tiles } = state;
    const { buildingType, mouseGridPos } = state.buildPlacementMode;
    const scaledSize = HEX_SIZE * camera.zoom;
    const scaledW = HEX_WIDTH * camera.zoom;
    const scaledH = HEX_HEIGHT * camera.zoom;

    const center = camera.gridToScreenCenter(mouseGridPos);

    // Check validity — buildings are 1-hex footprint
    let valid = true;
    const tile = tiles[mouseGridPos.row]?.[mouseGridPos.col];
    if (!tile || !tile.walkable) valid = false;

    // Check overlap with existing buildings
    if (valid) {
      for (const building of state.buildings.values()) {
        if (
          mouseGridPos.row === building.position.row &&
          mouseGridPos.col === building.position.col
        ) {
          valid = false;
          break;
        }
      }
    }

    // Draw semi-transparent ghost with color tint
    const playerIndex = this.getPlayerIndex(state.localPlayerId);
    const sprite = this.spriteManager.getBuildingSprite(buildingType, playerIndex, false);

    ctx.save();
    ctx.globalAlpha = 0.6;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(
      sprite.canvas as any,
      sprite.sx, sprite.sy, sprite.sw, sprite.sh,
      center.x - scaledW / 2, center.y - scaledH / 2, scaledW, scaledH,
    );
    ctx.imageSmoothingEnabled = true;

    // Green or red tint hex overlay
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = valid ? '#00ff00' : '#ff0000';
    traceHexPath(ctx, center.x, center.y, scaledSize);
    ctx.fill();
    ctx.globalAlpha = 1.0;

    // Hex border
    ctx.strokeStyle = valid ? '#00ff00' : '#ff0000';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    traceHexPath(ctx, center.x, center.y, scaledSize);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.restore();
  }

  /**
   * Draw a bright outline on the hovered hex tile.
   */
  private renderHoverHighlight(state: RenderState): void {
    if (!state.hoveredHex) return;
    const { col, row } = state.hoveredHex;
    if (col < 0 || row < 0 || col >= state.config.mapWidth || row >= state.config.mapHeight) return;

    const { ctx, camera } = this;
    const center = camera.gridToScreenCenter(state.hoveredHex);
    const scaledSize = HEX_SIZE * camera.zoom;

    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.lineWidth = 2 * camera.zoom;
    traceHexPath(ctx, center.x, center.y, scaledSize);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
    traceHexPath(ctx, center.x, center.y, scaledSize);
    ctx.fill();
    ctx.restore();
  }

  private renderSelectionBox(state: RenderState): void {
    if (!state.selectionRect) return;

    const { ctx } = this;
    const { x, y, width, height } = state.selectionRect;

    ctx.strokeStyle = '#53d769';
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 3]);
    ctx.strokeRect(x, y, width, height);
    ctx.setLineDash([]);

    ctx.fillStyle = 'rgba(83, 215, 105, 0.1)';
    ctx.fillRect(x, y, width, height);
  }

  // ----------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------

  private getPlayerIndex(playerId: string): number {
    const match = playerId.match(/(\d+)/);
    return match ? parseInt(match[1], 10) % PLAYER_COLORS.length : 0;
  }
}
