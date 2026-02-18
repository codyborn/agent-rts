// ============================================================
// Agent RTS - Viewport Camera
// ============================================================

import { GridPosition, GameConfig } from '../shared/types';

/**
 * Viewport camera for navigating the game world.
 *
 * Manages panning, zooming, and coordinate transformations between
 * screen space, world space, and grid space.
 */
export class Camera {
  /** Top-left corner X in world coordinates (pixels) */
  x: number = 0;

  /** Top-left corner Y in world coordinates (pixels) */
  y: number = 0;

  /** Fixed zoom level (no user zoom) */
  readonly zoom: number = 1.0;

  /** Canvas width in pixels */
  width: number;

  /** Canvas height in pixels */
  height: number;

  /** Camera pan speed in pixels per frame */
  panSpeed: number = 10;

  /** World dimensions in pixels */
  private worldWidth: number;
  private worldHeight: number;

  constructor(
    canvasWidth: number,
    canvasHeight: number,
    worldWidth: number,
    worldHeight: number
  ) {
    this.width = canvasWidth;
    this.height = canvasHeight;
    this.worldWidth = worldWidth;
    this.worldHeight = worldHeight;
  }

  /**
   * Pan the camera by a delta in world pixels.
   * Position is clamped to world bounds.
   */
  pan(dx: number, dy: number): void {
    this.x += dx;
    this.y += dy;
    this.clampPosition();
  }

  /**
   * Convert world coordinates (pixels) to screen coordinates (pixels).
   */
  worldToScreen(worldX: number, worldY: number): { x: number; y: number } {
    return {
      x: (worldX - this.x) * this.zoom,
      y: (worldY - this.y) * this.zoom,
    };
  }

  /**
   * Convert screen coordinates (pixels) to world coordinates (pixels).
   */
  screenToWorld(screenX: number, screenY: number): { x: number; y: number } {
    return {
      x: screenX / this.zoom + this.x,
      y: screenY / this.zoom + this.y,
    };
  }

  /**
   * Convert a grid position to screen coordinates (pixels).
   * Returns the top-left corner of the tile on screen.
   */
  gridToScreen(pos: GridPosition, tileSize: number): { x: number; y: number } {
    const worldX = pos.col * tileSize;
    const worldY = pos.row * tileSize;
    return this.worldToScreen(worldX, worldY);
  }

  /**
   * Convert screen coordinates to a grid position.
   */
  screenToGrid(screenX: number, screenY: number, tileSize: number): GridPosition {
    const world = this.screenToWorld(screenX, screenY);
    return {
      col: Math.floor(world.x / tileSize),
      row: Math.floor(world.y / tileSize),
    };
  }

  /**
   * Check if a grid tile is within the visible viewport (with 1-tile margin).
   */
  isGridVisible(pos: GridPosition, tileSize: number): boolean {
    const screen = this.gridToScreen(pos, tileSize);
    const tileSizeOnScreen = tileSize * this.zoom;
    return (
      screen.x + tileSizeOnScreen >= -tileSizeOnScreen &&
      screen.y + tileSizeOnScreen >= -tileSizeOnScreen &&
      screen.x < this.width + tileSizeOnScreen &&
      screen.y < this.height + tileSizeOnScreen
    );
  }

  /**
   * Calculate which grid tiles are visible on screen.
   * Returns min/max col/row clamped to map bounds.
   */
  getVisibleGridBounds(
    tileSize: number,
    mapWidth: number,
    mapHeight: number
  ): { minCol: number; maxCol: number; minRow: number; maxRow: number } {
    const topLeft = this.screenToWorld(0, 0);
    const bottomRight = this.screenToWorld(this.width, this.height);

    const minCol = Math.max(0, Math.floor(topLeft.x / tileSize) - 1);
    const minRow = Math.max(0, Math.floor(topLeft.y / tileSize) - 1);
    const maxCol = Math.min(mapWidth - 1, Math.ceil(bottomRight.x / tileSize) + 1);
    const maxRow = Math.min(mapHeight - 1, Math.ceil(bottomRight.y / tileSize) + 1);

    return { minCol, maxCol, minRow, maxRow };
  }

  /**
   * Center the camera on a given grid position.
   */
  centerOn(pos: GridPosition, tileSize: number): void {
    const worldX = pos.col * tileSize + tileSize / 2;
    const worldY = pos.row * tileSize + tileSize / 2;

    this.x = worldX - this.width / (2 * this.zoom);
    this.y = worldY - this.height / (2 * this.zoom);

    this.clampPosition();
  }

  /**
   * Update canvas dimensions (call on window resize).
   */
  resize(canvasWidth: number, canvasHeight: number): void {
    this.width = canvasWidth;
    this.height = canvasHeight;
    this.clampPosition();
  }

  /**
   * Get the current viewport rectangle in world coordinates.
   */
  getViewportRect(): { x: number; y: number; width: number; height: number } {
    return {
      x: this.x,
      y: this.y,
      width: this.width / this.zoom,
      height: this.height / this.zoom,
    };
  }

  /**
   * Clamp camera position so it does not scroll past world edges.
   */
  private clampPosition(): void {
    const maxX = Math.max(0, this.worldWidth - this.width / this.zoom);
    const maxY = Math.max(0, this.worldHeight - this.height / this.zoom);
    this.x = Math.max(0, Math.min(this.x, maxX));
    this.y = Math.max(0, Math.min(this.y, maxY));
  }
}
