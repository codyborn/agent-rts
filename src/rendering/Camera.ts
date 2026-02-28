// ============================================================
// Agent RTS - Viewport Camera
// ============================================================

import { GridPosition, GameConfig } from '../shared/types';
import { hexToPixel, pixelToHex, HEX_WIDTH, HEX_HEIGHT, HEX_VERT_SPACING } from '../hex/HexUtils';

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
   * Returns the top-left of the hex bounding box on screen.
   */
  gridToScreen(pos: GridPosition, _tileSize: number): { x: number; y: number } {
    const world = hexToPixel(pos);
    // hexToPixel returns the hex center; offset to top-left of bounding box
    return this.worldToScreen(world.x - HEX_WIDTH / 2, world.y - HEX_HEIGHT / 2);
  }

  /**
   * Convert a grid position to its screen center coordinates.
   */
  gridToScreenCenter(pos: GridPosition): { x: number; y: number } {
    const world = hexToPixel(pos);
    return this.worldToScreen(world.x, world.y);
  }

  /**
   * Convert screen coordinates to a grid position (hex-aware).
   */
  screenToGrid(screenX: number, screenY: number, _tileSize: number): GridPosition {
    const world = this.screenToWorld(screenX, screenY);
    return pixelToHex(world.x, world.y);
  }

  /**
   * Check if a grid tile is within the visible viewport (with margin).
   */
  isGridVisible(pos: GridPosition, _tileSize: number): boolean {
    const screen = this.gridToScreen(pos, 0);
    const w = HEX_WIDTH * this.zoom;
    const h = HEX_HEIGHT * this.zoom;
    return (
      screen.x + w >= -w &&
      screen.y + h >= -h &&
      screen.x < this.width + w &&
      screen.y < this.height + h
    );
  }

  /**
   * Calculate which grid tiles are visible on screen (hex-aware).
   * Returns min/max col/row clamped to map bounds.
   */
  getVisibleGridBounds(
    _tileSize: number,
    mapWidth: number,
    mapHeight: number
  ): { minCol: number; maxCol: number; minRow: number; maxRow: number } {
    const topLeft = this.screenToWorld(0, 0);
    const bottomRight = this.screenToWorld(this.width, this.height);

    const minCol = Math.max(0, Math.floor((topLeft.x - HEX_WIDTH) / HEX_WIDTH) - 1);
    const minRow = Math.max(0, Math.floor((topLeft.y - HEX_HEIGHT) / HEX_VERT_SPACING) - 1);
    const maxCol = Math.min(mapWidth - 1, Math.ceil(bottomRight.x / HEX_WIDTH) + 1);
    const maxRow = Math.min(mapHeight - 1, Math.ceil(bottomRight.y / HEX_VERT_SPACING) + 1);

    return { minCol, maxCol, minRow, maxRow };
  }

  /**
   * Center the camera on a given grid position (hex-aware).
   */
  centerOn(pos: GridPosition, _tileSize: number): void {
    const world = hexToPixel(pos);

    this.x = world.x - this.width / (2 * this.zoom);
    this.y = world.y - this.height / (2 * this.zoom);

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
