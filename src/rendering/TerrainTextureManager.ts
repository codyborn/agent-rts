// ============================================================
// Agent RTS - Procedural Hex Terrain Textures
// ============================================================
// Generates textured hex tile canvases at init time. Each terrain
// type gets 4 visual variants; water adds 3 animation frames per
// variant. Textures are hex-clipped OffscreenCanvases drawn with
// a seeded RNG for deterministic but varied output.
// ============================================================

import { TerrainType } from '../shared/types';
import { hexCorners, HEX_SIZE } from '../hex/HexUtils';

// ---- Dimensions (must accommodate a hex of HEX_SIZE) ----
export const TEX_W = Math.ceil(Math.sqrt(3) * HEX_SIZE);  // ~32
export const TEX_H = 2 * HEX_SIZE;                         // 36

const VARIANTS = 4;
const WATER_FRAMES = 3;

// ============================================================
// Simple seeded RNG (same approach as SpriteManager)
// ============================================================

class SimpleRNG {
  private state: number;

  constructor(seed: number) {
    this.state = seed | 0 || 1;
  }

  /** Returns a float in [0, 1). */
  next(): number {
    this.state = (this.state * 1664525 + 1013904223) | 0;
    return (this.state >>> 0) / 4294967296;
  }

  /** Returns an int in [min, max). */
  int(min: number, max: number): number {
    return Math.floor(this.next() * (max - min)) + min;
  }

  /** Returns a float in [min, max). */
  float(min: number, max: number): number {
    return this.next() * (max - min) + min;
  }
}

// ============================================================
// TerrainTextureManager
// ============================================================

export class TerrainTextureManager {
  /** Key: `${terrain}-${variant}` or `${terrain}-${variant}-${frame}` for water */
  private textures: Map<string, OffscreenCanvas> = new Map();

  init(): void {
    const terrains = Object.values(TerrainType);
    for (const terrain of terrains) {
      for (let v = 0; v < VARIANTS; v++) {
        if (terrain === TerrainType.WATER) {
          for (let f = 0; f < WATER_FRAMES; f++) {
            const canvas = this.createHexCanvas();
            const ctx = canvas.getContext('2d')!;
            this.clipHex(ctx);
            this.drawWater(ctx, v, f);
            this.textures.set(`${terrain}-${v}-${f}`, canvas);
          }
        } else {
          const canvas = this.createHexCanvas();
          const ctx = canvas.getContext('2d')!;
          this.clipHex(ctx);
          this.drawTerrain(ctx, terrain, v);
          this.textures.set(`${terrain}-${v}`, canvas);
        }
      }
    }
  }

  /**
   * Get the pre-rendered texture for a tile.
   * @param terrain  Terrain type
   * @param col      Grid column (used for variant hash)
   * @param row      Grid row (used for variant hash)
   * @param animFrame  Water animation frame (0-2), ignored for other terrains
   */
  getTexture(
    terrain: TerrainType,
    col: number,
    row: number,
    animFrame: number,
  ): OffscreenCanvas {
    const variant = this.hashPosition(col, row);
    if (terrain === TerrainType.WATER) {
      const key = `${terrain}-${variant}-${animFrame}`;
      return this.textures.get(key)!;
    }
    const key = `${terrain}-${variant}`;
    return this.textures.get(key)!;
  }

  // ----------------------------------------------------------
  // Internals
  // ----------------------------------------------------------

  private hashPosition(col: number, row: number): number {
    // Simple hash to pick a variant 0-3 deterministically per tile
    return ((col * 7 + row * 13 + col * row * 3) & 0x7fffffff) % VARIANTS;
  }

  private createHexCanvas(): OffscreenCanvas {
    return new OffscreenCanvas(TEX_W, TEX_H);
  }

  /**
   * Clip the context to a hex shape centered in the canvas.
   * Uses hexCorners() from HexUtils with a local path trace to avoid
   * CanvasRenderingContext2D / OffscreenCanvasRenderingContext2D type issues.
   */
  private clipHex(ctx: OffscreenCanvasRenderingContext2D): void {
    const cx = TEX_W / 2;
    const cy = TEX_H / 2;
    const corners = hexCorners(cx, cy, HEX_SIZE);
    ctx.beginPath();
    ctx.moveTo(corners[0].x, corners[0].y);
    for (let i = 1; i < 6; i++) {
      ctx.lineTo(corners[i].x, corners[i].y);
    }
    ctx.closePath();
    ctx.clip();
  }

  private drawTerrain(
    ctx: OffscreenCanvasRenderingContext2D,
    terrain: TerrainType,
    variant: number,
  ): void {
    switch (terrain) {
      case TerrainType.PLAINS:
        this.drawPlains(ctx, variant);
        break;
      case TerrainType.FOREST:
        this.drawForest(ctx, variant);
        break;
      case TerrainType.MOUNTAIN:
        this.drawMountain(ctx, variant);
        break;
      case TerrainType.SWAMP:
        this.drawSwamp(ctx, variant);
        break;
    }
  }

  // ----------------------------------------------------------
  // Plains: green variation patches + grass blade strokes
  // ----------------------------------------------------------

  private drawPlains(ctx: OffscreenCanvasRenderingContext2D, variant: number): void {
    const rng = new SimpleRNG(100 + variant);

    // Base fill
    ctx.fillStyle = '#4a7c59';
    ctx.fillRect(0, 0, TEX_W, TEX_H);

    // Subtle colour variation patches
    for (let i = 0; i < 5; i++) {
      const px = rng.float(2, TEX_W - 6);
      const py = rng.float(2, TEX_H - 6);
      const r = rng.float(3, 7);
      const lightness = rng.float(-15, 15);
      const g = Math.round(124 + lightness);
      ctx.fillStyle = `rgb(${74 + Math.round(lightness * 0.3)},${g},${89 + Math.round(lightness * 0.5)})`;
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fill();
    }

    // Short grass blade strokes
    ctx.strokeStyle = 'rgba(90, 160, 90, 0.5)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 12; i++) {
      const bx = rng.float(3, TEX_W - 3);
      const by = rng.float(6, TEX_H - 3);
      const h = rng.float(3, 6);
      const lean = rng.float(-2, 2);
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.lineTo(bx + lean, by - h);
      ctx.stroke();
    }
  }

  // ----------------------------------------------------------
  // Forest: tree canopies (trunk + circle clusters) + ground
  // ----------------------------------------------------------

  private drawForest(ctx: OffscreenCanvasRenderingContext2D, variant: number): void {
    const rng = new SimpleRNG(200 + variant);

    // Ground base
    ctx.fillStyle = '#2d5a27';
    ctx.fillRect(0, 0, TEX_W, TEX_H);

    // Darker ground patches
    for (let i = 0; i < 3; i++) {
      const px = rng.float(2, TEX_W - 4);
      const py = rng.float(2, TEX_H - 4);
      ctx.fillStyle = `rgba(25, 60, 20, ${rng.float(0.3, 0.6).toFixed(2)})`;
      ctx.beginPath();
      ctx.arc(px, py, rng.float(3, 6), 0, Math.PI * 2);
      ctx.fill();
    }

    // Trees: 2-4 canopies
    const treeCount = rng.int(2, 5);
    for (let t = 0; t < treeCount; t++) {
      const tx = rng.float(6, TEX_W - 6);
      const ty = rng.float(8, TEX_H - 6);

      // Trunk
      ctx.fillStyle = '#5a3a1a';
      ctx.fillRect(tx - 1, ty, 2, rng.float(4, 7));

      // Canopy: 2-3 overlapping circles
      const circles = rng.int(2, 4);
      for (let c = 0; c < circles; c++) {
        const cx = tx + rng.float(-4, 4);
        const cy = ty - rng.float(1, 5);
        const cr = rng.float(3, 6);
        const greenVal = rng.int(70, 120);
        ctx.fillStyle = `rgb(${rng.int(20, 50)},${greenVal},${rng.int(15, 40)})`;
        ctx.beginPath();
        ctx.arc(cx, cy, cr, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // ----------------------------------------------------------
  // Mountain: angular rock facets + ridges + shadow crevices
  // ----------------------------------------------------------

  private drawMountain(ctx: OffscreenCanvasRenderingContext2D, variant: number): void {
    const rng = new SimpleRNG(300 + variant);

    // Base stone fill
    ctx.fillStyle = '#8b7355';
    ctx.fillRect(0, 0, TEX_W, TEX_H);

    // Angular rock facets (overlapping triangles)
    for (let i = 0; i < 4; i++) {
      const ax = rng.float(2, TEX_W - 2);
      const ay = rng.float(4, TEX_H - 2);
      const bx = ax + rng.float(-8, 8);
      const by = ay + rng.float(-8, 0);
      const ccx = ax + rng.float(-6, 6);
      const ccy = ay + rng.float(-10, -2);
      const shade = rng.float(-30, 30);
      ctx.fillStyle = `rgb(${Math.round(139 + shade)},${Math.round(115 + shade * 0.8)},${Math.round(85 + shade * 0.6)})`;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.lineTo(ccx, ccy);
      ctx.closePath();
      ctx.fill();
    }

    // Ridge highlight lines
    ctx.strokeStyle = 'rgba(200, 190, 170, 0.4)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 3; i++) {
      const x1 = rng.float(4, TEX_W - 4);
      const y1 = rng.float(4, TEX_H / 2);
      const x2 = x1 + rng.float(-6, 6);
      const y2 = y1 + rng.float(4, 10);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }

    // Shadow crevices
    ctx.strokeStyle = 'rgba(50, 35, 20, 0.4)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 2; i++) {
      const x1 = rng.float(6, TEX_W - 6);
      const y1 = rng.float(TEX_H * 0.3, TEX_H * 0.7);
      const x2 = x1 + rng.float(-4, 4);
      const y2 = y1 + rng.float(3, 8);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }

    // Optional snow cap on top portion (variant 0 and 2)
    if (variant % 2 === 0) {
      ctx.fillStyle = 'rgba(240, 240, 255, 0.35)';
      ctx.beginPath();
      ctx.moveTo(TEX_W / 2, 2);
      ctx.lineTo(TEX_W / 2 + 8, 10);
      ctx.lineTo(TEX_W / 2 - 8, 10);
      ctx.closePath();
      ctx.fill();
    }
  }

  // ----------------------------------------------------------
  // Water: radial gradient + wave arcs + specular dots
  // ----------------------------------------------------------

  private drawWater(
    ctx: OffscreenCanvasRenderingContext2D,
    variant: number,
    animFrame: number,
  ): void {
    const rng = new SimpleRNG(400 + variant);
    const cx = TEX_W / 2;
    const cy = TEX_H / 2;

    // Radial depth gradient
    const grad = ctx.createRadialGradient(cx, cy, 2, cx, cy, TEX_W * 0.6);
    grad.addColorStop(0, '#2a6a9e');
    grad.addColorStop(1, '#1a5276');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, TEX_W, TEX_H);

    // Wave arcs (offset by animation frame)
    ctx.strokeStyle = 'rgba(100, 180, 230, 0.35)';
    ctx.lineWidth = 1;
    const frameOffset = animFrame * 3;
    for (let i = 0; i < 4; i++) {
      const wy = rng.float(6, TEX_H - 6) + frameOffset;
      const wx = rng.float(4, TEX_W - 4);
      const wr = rng.float(4, 10);
      ctx.beginPath();
      ctx.arc(wx, (wy % TEX_H), wr, Math.PI * 0.1, Math.PI * 0.9);
      ctx.stroke();
    }

    // Secondary thinner wave set
    ctx.strokeStyle = 'rgba(140, 210, 240, 0.25)';
    ctx.lineWidth = 0.5;
    for (let i = 0; i < 3; i++) {
      const wy = rng.float(4, TEX_H - 4) + frameOffset * 0.7;
      const wx = rng.float(3, TEX_W - 3);
      const wr = rng.float(3, 7);
      ctx.beginPath();
      ctx.arc(wx, (wy % TEX_H), wr, Math.PI * 0.2, Math.PI * 0.8);
      ctx.stroke();
    }

    // Specular dots (small white highlights)
    for (let i = 0; i < 3; i++) {
      const sx = rng.float(4, TEX_W - 4);
      const sy = rng.float(4, TEX_H - 4) + frameOffset * 0.5;
      ctx.fillStyle = `rgba(255, 255, 255, ${rng.float(0.15, 0.4).toFixed(2)})`;
      ctx.beginPath();
      ctx.arc(sx, (sy % TEX_H), rng.float(0.5, 1.5), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // ----------------------------------------------------------
  // Swamp: murky water patches + reeds + bubbles
  // ----------------------------------------------------------

  private drawSwamp(ctx: OffscreenCanvasRenderingContext2D, variant: number): void {
    const rng = new SimpleRNG(500 + variant);

    // Base fill
    ctx.fillStyle = '#4a6741';
    ctx.fillRect(0, 0, TEX_W, TEX_H);

    // Murky water patches
    for (let i = 0; i < 3; i++) {
      const px = rng.float(3, TEX_W - 5);
      const py = rng.float(3, TEX_H - 5);
      const pr = rng.float(3, 7);
      ctx.fillStyle = `rgba(40, 70, 50, ${rng.float(0.4, 0.7).toFixed(2)})`;
      ctx.beginPath();
      ctx.arc(px, py, pr, 0, Math.PI * 2);
      ctx.fill();
    }

    // Reed/cattail lines
    ctx.lineWidth = 1;
    const reedCount = rng.int(3, 6);
    for (let i = 0; i < reedCount; i++) {
      const rx = rng.float(4, TEX_W - 4);
      const ry = rng.float(TEX_H * 0.4, TEX_H - 3);
      const rh = rng.float(6, 12);
      const lean = rng.float(-1.5, 1.5);

      // Stem
      ctx.strokeStyle = 'rgba(60, 90, 40, 0.7)';
      ctx.beginPath();
      ctx.moveTo(rx, ry);
      ctx.lineTo(rx + lean, ry - rh);
      ctx.stroke();

      // Cattail bulb at top
      ctx.fillStyle = '#5a4020';
      ctx.beginPath();
      ctx.ellipse(rx + lean, ry - rh - 1.5, 1.2, 2.5, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // Bubble dots
    for (let i = 0; i < 3; i++) {
      const bx = rng.float(5, TEX_W - 5);
      const by = rng.float(5, TEX_H - 5);
      const br = rng.float(0.8, 2);
      ctx.strokeStyle = 'rgba(140, 170, 130, 0.4)';
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.arc(bx, by, br, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}
