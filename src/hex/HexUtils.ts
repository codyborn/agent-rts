// ============================================================
// Agent RTS - Hex Grid Utilities
// Pointy-top hexagons with odd-r offset coordinates
// ============================================================

import { GridPosition } from '../shared/types';

// ============ Constants ============

export const HEX_SIZE = 18;
export const HEX_WIDTH = Math.sqrt(3) * HEX_SIZE;   // ~31.18
export const HEX_HEIGHT = 2 * HEX_SIZE;              // 36
export const HEX_VERT_SPACING = HEX_HEIGHT * 0.75;   // 27

// ============ Neighbor Offsets (odd-r offset) ============

// For even rows (row % 2 === 0)
const EVEN_ROW_NEIGHBORS: ReadonlyArray<{ dc: number; dr: number }> = [
  { dc: +1, dr:  0 },  // E
  { dc:  0, dr: -1 },  // NE
  { dc: -1, dr: -1 },  // NW
  { dc: -1, dr:  0 },  // W
  { dc: -1, dr: +1 },  // SW
  { dc:  0, dr: +1 },  // SE
];

// For odd rows (row % 2 === 1)
const ODD_ROW_NEIGHBORS: ReadonlyArray<{ dc: number; dr: number }> = [
  { dc: +1, dr:  0 },  // E
  { dc: +1, dr: -1 },  // NE
  { dc:  0, dr: -1 },  // NW
  { dc: -1, dr:  0 },  // W
  { dc:  0, dr: +1 },  // SW
  { dc: +1, dr: +1 },  // SE
];

// ============ Coordinate Conversion ============

// Pixel offsets so hex (0,0) center doesn't sit at the very top-left corner.
// This avoids overlap with the 30px resource bar at the top of the screen.
const HEX_ORIGIN_X = HEX_WIDTH / 2;
const HEX_ORIGIN_Y = HEX_VERT_SPACING;

/**
 * Convert offset (row, col) to pixel center using pointy-top hex layout.
 */
export function hexToPixel(pos: GridPosition): { x: number; y: number } {
  const x = pos.col * HEX_WIDTH + (pos.row & 1 ? HEX_WIDTH / 2 : 0) + HEX_ORIGIN_X;
  const y = pos.row * HEX_VERT_SPACING + HEX_ORIGIN_Y;
  return { x, y };
}

/**
 * Convert pixel coordinates to the nearest offset (row, col).
 * Uses the cube-round algorithm for accuracy.
 */
export function pixelToHex(px: number, py: number): GridPosition {
  // Remove origin offset before computing grid position
  const adjPx = px - HEX_ORIGIN_X;
  const adjPy = py - HEX_ORIGIN_Y;

  // Approximate row/col
  const approxRow = adjPy / HEX_VERT_SPACING;
  const row = Math.round(approxRow);
  const offset = row & 1 ? HEX_WIDTH / 2 : 0;
  const approxCol = (adjPx - offset) / HEX_WIDTH;
  const col = Math.round(approxCol);

  // Check the candidate and its neighbors for the closest center
  let bestRow = row;
  let bestCol = col;
  let bestDist = Infinity;

  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      const r = row + dr;
      const c = col + dc;
      const center = hexToPixel({ row: r, col: c });
      const dx = px - center.x;
      const dy = py - center.y;
      const dist = dx * dx + dy * dy;
      if (dist < bestDist) {
        bestDist = dist;
        bestRow = r;
        bestCol = c;
      }
    }
  }

  return { row: bestRow, col: bestCol };
}

// ============ Neighbors ============

/**
 * Returns the 6 hex neighbors for odd-r offset coordinates.
 */
export function hexNeighbors(pos: GridPosition): GridPosition[] {
  const offsets = pos.row & 1 ? ODD_ROW_NEIGHBORS : EVEN_ROW_NEIGHBORS;
  return offsets.map((o) => ({
    col: pos.col + o.dc,
    row: pos.row + o.dr,
  }));
}

// ============ Distance ============

/**
 * Convert odd-r offset coordinates to cube coordinates.
 */
function offsetToCube(pos: GridPosition): { q: number; r: number; s: number } {
  const q = pos.col - (pos.row - (pos.row & 1)) / 2;
  const r = pos.row;
  const s = -q - r;
  return { q, r, s };
}

/**
 * Hex distance using cube coordinate conversion.
 * Returns the number of hex steps between two positions.
 */
export function hexDistance(a: GridPosition, b: GridPosition): number {
  const ac = offsetToCube(a);
  const bc = offsetToCube(b);
  return Math.max(
    Math.abs(ac.q - bc.q),
    Math.abs(ac.r - bc.r),
    Math.abs(ac.s - bc.s),
  );
}

// ============ Rendering ============

/**
 * Returns 6 vertex points for drawing a pointy-top hex at pixel center (cx, cy).
 */
export function hexCorners(
  cx: number,
  cy: number,
  size: number,
): Array<{ x: number; y: number }> {
  const corners: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < 6; i++) {
    const angleDeg = 60 * i - 30; // pointy-top: starts at -30 degrees
    const angleRad = (Math.PI / 180) * angleDeg;
    corners.push({
      x: cx + size * Math.cos(angleRad),
      y: cy + size * Math.sin(angleRad),
    });
  }
  return corners;
}

/**
 * Draw a hex polygon path on a canvas context.
 * Call ctx.fill() or ctx.stroke() after this.
 */
export function traceHexPath(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
): void {
  const corners = hexCorners(cx, cy, size);
  ctx.beginPath();
  ctx.moveTo(corners[0].x, corners[0].y);
  for (let i = 1; i < 6; i++) {
    ctx.lineTo(corners[i].x, corners[i].y);
  }
  ctx.closePath();
}
