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
  TerrainType,
  UnitType,
  ResourceType,
  UnitBehaviorState,
  TERRAIN_COLORS,
  UNIT_ICONS,
  UNIT_STATS,
  PLAYER_COLORS,
  positionToLabel,
  colToLabel,
} from '../shared/types';
import { Camera } from './Camera';
import { SpriteManager, behaviorToAnimState } from './SpriteManager';

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
}

/**
 * Main canvas renderer for the game map, units, buildings, fog, and overlays.
 */
export class Renderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private camera: Camera;
  private spriteManager: SpriteManager;

  constructor(canvas: HTMLCanvasElement, camera: Camera, spriteManager: SpriteManager) {
    this.canvas = canvas;
    this.camera = camera;
    this.spriteManager = spriteManager;

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

        ctx.fillStyle = TERRAIN_COLORS[tile.terrain];
        ctx.fillRect(screen.x, screen.y, size, size);

        if (tile.resource && tile.resourceAmount > 0) {
          const cx = screen.x + size / 2;
          const cy = screen.y + size / 2;
          const indicatorSize = size * 0.25;

          if (tile.resource === ResourceType.MINERALS) {
            ctx.fillStyle = '#5ac8fa';
            ctx.beginPath();
            ctx.moveTo(cx, cy - indicatorSize);
            ctx.lineTo(cx + indicatorSize, cy);
            ctx.lineTo(cx, cy + indicatorSize);
            ctx.lineTo(cx - indicatorSize, cy);
            ctx.closePath();
            ctx.fill();
          } else if (tile.resource === ResourceType.ENERGY) {
            ctx.fillStyle = '#ffcc02';
            ctx.beginPath();
            ctx.arc(cx, cy, indicatorSize, 0, Math.PI * 2);
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
    const size = tileSize * camera.zoom;

    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;

    for (let col = bounds.minCol; col <= bounds.maxCol + 1; col++) {
      const screen = camera.worldToScreen(col * tileSize, 0);
      ctx.beginPath();
      ctx.moveTo(Math.round(screen.x), 0);
      ctx.lineTo(Math.round(screen.x), this.canvas.height);
      ctx.stroke();
    }

    for (let row = bounds.minRow; row <= bounds.maxRow + 1; row++) {
      const screen = camera.worldToScreen(0, row * tileSize);
      ctx.beginPath();
      ctx.moveTo(0, Math.round(screen.y));
      ctx.lineTo(this.canvas.width, Math.round(screen.y));
      ctx.stroke();
    }

    const labelFontSize = Math.max(8, Math.min(12, size * 0.35));
    ctx.font = `${labelFontSize}px 'Courier New', monospace`;
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';

    for (let col = bounds.minCol; col <= bounds.maxCol; col++) {
      const screen = camera.gridToScreen({ col, row: 0 }, tileSize);
      const labelX = screen.x + size / 2;
      const labelY = Math.max(2, screen.y + 2);
      ctx.fillText(colToLabel(col), labelX, labelY);
    }

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
   * Draw buildings using pixel sprites from SpriteManager.
   */
  private renderBuildings(state: RenderState): void {
    const { ctx, camera } = this;
    const { config, buildings } = state;
    const { tileSize } = config;

    for (const building of buildings.values()) {
      const pos = building.position;
      if (!camera.isGridVisible(pos, tileSize)) continue;

      const screen = camera.gridToScreen(pos, tileSize);
      const size = tileSize * camera.zoom;
      const isSmall = building.type === BuildingType.WATCHTOWER;
      const bWidth = isSmall ? size : size * 2;
      const bHeight = isSmall ? size : size * 2;

      const playerIndex = this.getPlayerIndex(building.playerId);

      // Draw sprite
      const sprite = this.spriteManager.getBuildingSprite(
        building.type,
        playerIndex,
        building.isConstructing,
      );

      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(
        sprite.canvas as any,
        sprite.sx, sprite.sy, sprite.sw, sprite.sh,
        screen.x, screen.y, bWidth, bHeight,
      );
      ctx.imageSmoothingEnabled = true;

      // Construction progress bar
      if (building.isConstructing) {
        const barWidth = bWidth * 0.8;
        const barHeight = 4 * camera.zoom;
        const barX = screen.x + (bWidth - barWidth) / 2;
        const barY = screen.y + bHeight + 2;

        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(barX, barY, barWidth, barHeight);
        ctx.fillStyle = '#ffcc02';
        ctx.fillRect(barX, barY, barWidth * building.constructionProgress, barHeight);
      }
    }
  }

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
   * Render per-unit vision heat map overlay.
   */
  private renderHeatMap(state: RenderState): void {
    if (!state.heatMapData) return;

    const { ctx, camera } = this;
    const { config } = state;
    const { tileSize } = config;
    const currentTick = state.currentTick;

    const bounds = camera.getVisibleGridBounds(tileSize, config.mapWidth, config.mapHeight);

    for (let row = bounds.minRow; row <= bounds.maxRow; row++) {
      for (let col = bounds.minCol; col <= bounds.maxCol; col++) {
        const screen = camera.gridToScreen({ col, row }, tileSize);
        const size = tileSize * camera.zoom;
        const key = `${col},${row}`;
        const lastSeen = state.heatMapData.get(key);

        if (lastSeen === undefined) {
          // Never seen by selected unit(s)
          ctx.fillStyle = 'rgba(0,0,0,0.7)';
          ctx.fillRect(screen.x, screen.y, size, size);
        } else {
          const age = currentTick - lastSeen;
          if (age <= 1) {
            // Currently visible
            ctx.fillStyle = 'rgba(0,255,100,0.25)';
          } else if (age <= 100) {
            // Recent (fading green)
            const alpha = 0.2 * (1 - age / 100);
            ctx.fillStyle = `rgba(0,255,100,${alpha.toFixed(3)})`;
          } else if (age <= 600) {
            // Old (very dim)
            const alpha = 0.15 * (1 - (age - 100) / 500);
            ctx.fillStyle = `rgba(0,200,80,${Math.max(0, alpha).toFixed(3)})`;
          } else {
            // Very old
            ctx.fillStyle = 'rgba(0,0,0,0.5)';
          }
          ctx.fillRect(screen.x, screen.y, size, size);
        }
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
   * Draw all visible units using pixel sprites.
   */
  private renderUnits(state: RenderState): void {
    const { ctx, camera } = this;
    const { config, units, selectedUnitIds, fog, localPlayerId, currentTick } = state;
    const { tileSize } = config;

    for (const unit of units.values()) {
      const pos = unit.position;
      if (!camera.isGridVisible(pos, tileSize)) continue;

      if (unit.playerId !== localPlayerId) {
        const fogRow = fog[pos.row];
        if (!fogRow || fogRow[pos.col] !== FogState.VISIBLE) continue;
      }

      const screen = camera.gridToScreen(pos, tileSize);
      const size = tileSize * camera.zoom;
      const cx = screen.x + size / 2;
      const cy = screen.y + size / 2;
      const radius = size * 0.35;

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
        // Flip horizontally
        ctx.translate(screen.x + size, screen.y);
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
          screen.x, screen.y, size, size,
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
   * Draw build placement ghost at cursor position.
   */
  private renderBuildPlacement(state: RenderState): void {
    if (!state.buildPlacementMode) return;

    const { ctx, camera } = this;
    const { config, tiles } = state;
    const { tileSize } = config;
    const { buildingType, mouseGridPos } = state.buildPlacementMode;
    const isSmall = buildingType === BuildingType.WATCHTOWER;
    const footprintSize = isSmall ? 1 : 2;

    const size = tileSize * camera.zoom;
    const screen = camera.gridToScreen(mouseGridPos, tileSize);
    const bWidth = footprintSize * size;
    const bHeight = footprintSize * size;

    // Check validity of all footprint tiles
    let valid = true;
    for (let dr = 0; dr < footprintSize; dr++) {
      for (let dc = 0; dc < footprintSize; dc++) {
        const r = mouseGridPos.row + dr;
        const c = mouseGridPos.col + dc;
        const tile = tiles[r]?.[c];
        if (!tile || !tile.walkable) {
          valid = false;
          break;
        }
      }
      if (!valid) break;
    }

    // Check overlap with existing buildings
    if (valid) {
      for (const building of state.buildings.values()) {
        const bFootprint = building.type === BuildingType.WATCHTOWER ? 1 : 2;
        for (let dr = 0; dr < footprintSize; dr++) {
          for (let dc = 0; dc < footprintSize; dc++) {
            for (let br = 0; br < bFootprint; br++) {
              for (let bc = 0; bc < bFootprint; bc++) {
                if (
                  mouseGridPos.row + dr === building.position.row + br &&
                  mouseGridPos.col + dc === building.position.col + bc
                ) {
                  valid = false;
                }
              }
            }
          }
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
      screen.x, screen.y, bWidth, bHeight,
    );
    ctx.imageSmoothingEnabled = true;

    // Green or red tint overlay
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = valid ? '#00ff00' : '#ff0000';
    ctx.fillRect(screen.x, screen.y, bWidth, bHeight);
    ctx.globalAlpha = 1.0;

    // Border
    ctx.strokeStyle = valid ? '#00ff00' : '#ff0000';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(screen.x, screen.y, bWidth, bHeight);
    ctx.setLineDash([]);

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
