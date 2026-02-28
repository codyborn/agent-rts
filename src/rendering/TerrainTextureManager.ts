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
import { PALETTE } from './ColorPalette';

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

// ---- Helper to parse hex color ----
function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [
    parseInt(h.substring(0, 2), 16),
    parseInt(h.substring(2, 4), 16),
    parseInt(h.substring(4, 6), 16),
  ];
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
  // Plains: dithered noise + grass clusters + flower/pebble dots
  // ----------------------------------------------------------

  private drawPlains(ctx: OffscreenCanvasRenderingContext2D, variant: number): void {
    const rng = new SimpleRNG(100 + variant);
    const [br, bg, bb] = hexToRgb(PALETTE.terrain.plains.base);

    // Base fill
    ctx.fillStyle = PALETTE.terrain.plains.base;
    ctx.fillRect(0, 0, TEX_W, TEX_H);

    // Dithered pixel noise layer (+/-8 on green channel, every other pixel)
    for (let py = 0; py < TEX_H; py += 2) {
      for (let px = (py % 4 === 0 ? 0 : 1); px < TEX_W; px += 2) {
        const noise = rng.float(-8, 8);
        ctx.fillStyle = `rgb(${br + Math.round(noise * 0.3)},${bg + Math.round(noise)},${bb + Math.round(noise * 0.5)})`;
        ctx.fillRect(px, py, 1, 1);
      }
    }

    // Subtle colour variation patches
    for (let i = 0; i < 4; i++) {
      const px = rng.float(2, TEX_W - 6);
      const py = rng.float(2, TEX_H - 6);
      const r = rng.float(3, 6);
      const lightness = rng.float(-12, 12);
      ctx.fillStyle = `rgb(${br + Math.round(lightness * 0.3)},${bg + Math.round(lightness)},${bb + Math.round(lightness * 0.5)})`;
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fill();
    }

    // Grass clusters (2-3 blades each) with lighter tips / darker bases
    const [, lg] = hexToRgb(PALETTE.terrain.plains.light);
    const [, dg] = hexToRgb(PALETTE.terrain.plains.dark);
    for (let i = 0; i < 8; i++) {
      const cx = rng.float(4, TEX_W - 4);
      const cy = rng.float(8, TEX_H - 4);
      const blades = rng.int(2, 4);
      for (let b = 0; b < blades; b++) {
        const bx = cx + rng.float(-2, 2);
        const h = rng.float(3, 6);
        const lean = rng.float(-1.5, 1.5);
        // Dark base
        ctx.strokeStyle = `rgba(${59},${dg},${69}, 0.6)`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(bx, cy);
        ctx.lineTo(bx + lean * 0.5, cy - h * 0.5);
        ctx.stroke();
        // Light tip
        ctx.strokeStyle = `rgba(${95},${lg},${104}, 0.7)`;
        ctx.beginPath();
        ctx.moveTo(bx + lean * 0.5, cy - h * 0.5);
        ctx.lineTo(bx + lean, cy - h);
        ctx.stroke();
      }
    }

    // Tiny flower/pebble dots (1-2 per variant)
    const dotCount = rng.int(1, 3);
    for (let i = 0; i < dotCount; i++) {
      const dx = rng.float(4, TEX_W - 4);
      const dy = rng.float(4, TEX_H - 4);
      if (rng.next() > 0.5) {
        // Flower dot
        ctx.fillStyle = rng.next() > 0.5 ? 'rgba(255,220,100,0.6)' : 'rgba(220,140,180,0.5)';
      } else {
        // Pebble dot
        ctx.fillStyle = 'rgba(150,140,120,0.4)';
      }
      ctx.fillRect(dx, dy, 1, 1);
    }
  }

  // ----------------------------------------------------------
  // Forest: darker ground + canopy shadow + highlight/shadow + fallen leaves
  // ----------------------------------------------------------

  private drawForest(ctx: OffscreenCanvasRenderingContext2D, variant: number): void {
    const rng = new SimpleRNG(200 + variant);

    // Ground base (use dark shade for canopy shadow feel)
    ctx.fillStyle = PALETTE.terrain.forest.dark;
    ctx.fillRect(0, 0, TEX_W, TEX_H);

    // Darker ground patches
    for (let i = 0; i < 3; i++) {
      const px = rng.float(2, TEX_W - 4);
      const py = rng.float(2, TEX_H - 4);
      ctx.fillStyle = `rgba(20, 48, 16, ${rng.float(0.3, 0.6).toFixed(2)})`;
      ctx.beginPath();
      ctx.arc(px, py, rng.float(3, 6), 0, Math.PI * 2);
      ctx.fill();
    }

    // Fallen leaf rectangles (warm brown)
    for (let i = 0; i < rng.int(2, 4); i++) {
      const lx = rng.float(3, TEX_W - 5);
      const ly = rng.float(TEX_H * 0.5, TEX_H - 3);
      ctx.fillStyle = `rgba(${rng.int(100, 140)}, ${rng.int(60, 90)}, ${rng.int(20, 40)}, 0.4)`;
      ctx.fillRect(lx, ly, rng.float(1, 3), 1);
    }

    // Trees: 2-4 canopies
    const treeCount = rng.int(2, 5);
    for (let t = 0; t < treeCount; t++) {
      const tx = rng.float(6, TEX_W - 6);
      const ty = rng.float(8, TEX_H - 6);

      // Trunk
      ctx.fillStyle = '#4a2a10';
      ctx.fillRect(tx - 1, ty, 2, rng.float(4, 7));

      // Canopy: 2-3 overlapping circles with shadow + highlight
      const circles = rng.int(2, 4);
      for (let c = 0; c < circles; c++) {
        const ccx = tx + rng.float(-4, 4);
        const ccy = ty - rng.float(1, 5);
        const cr = rng.float(3, 6);
        const [fr, fg, fb] = hexToRgb(PALETTE.terrain.forest.base);
        const greenVal = fg + rng.int(-20, 20);
        ctx.fillStyle = `rgb(${fr + rng.int(-10, 10)},${greenVal},${fb + rng.int(-10, 10)})`;
        ctx.beginPath();
        ctx.arc(ccx, ccy, cr, 0, Math.PI * 2);
        ctx.fill();

        // 1px shadow arc on bottom
        ctx.strokeStyle = 'rgba(10, 20, 8, 0.4)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(ccx, ccy, cr, Math.PI * 0.2, Math.PI * 0.8);
        ctx.stroke();

        // Highlight pixels top-left
        ctx.fillStyle = `rgba(${80}, ${greenVal + 30}, ${50}, 0.5)`;
        ctx.fillRect(ccx - cr * 0.4, ccy - cr * 0.5, 1, 1);
      }
    }
  }

  // ----------------------------------------------------------
  // Mountain: stone dither + snow on all variants + paired ridges
  // ----------------------------------------------------------

  private drawMountain(ctx: OffscreenCanvasRenderingContext2D, variant: number): void {
    const rng = new SimpleRNG(300 + variant);
    const [mr, mg, mb] = hexToRgb(PALETTE.terrain.mountain.base);

    // Base stone fill
    ctx.fillStyle = PALETTE.terrain.mountain.base;
    ctx.fillRect(0, 0, TEX_W, TEX_H);

    // Fine dither pattern for grainy stone texture
    for (let py = 0; py < TEX_H; py += 2) {
      for (let px = (py % 4 === 0 ? 0 : 1); px < TEX_W; px += 2) {
        const noise = rng.float(-12, 12);
        ctx.fillStyle = `rgb(${mr + Math.round(noise)},${mg + Math.round(noise * 0.8)},${mb + Math.round(noise * 0.6)})`;
        ctx.fillRect(px, py, 1, 1);
      }
    }

    // Angular rock facets (overlapping triangles)
    for (let i = 0; i < 4; i++) {
      const ax = rng.float(2, TEX_W - 2);
      const ay = rng.float(4, TEX_H - 2);
      const bx = ax + rng.float(-8, 8);
      const by = ay + rng.float(-8, 0);
      const ccx = ax + rng.float(-6, 6);
      const ccy = ay + rng.float(-10, -2);
      const shade = rng.float(-25, 25);
      ctx.fillStyle = `rgb(${Math.round(mr + shade)},${Math.round(mg + shade * 0.8)},${Math.round(mb + shade * 0.6)})`;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.lineTo(ccx, ccy);
      ctx.closePath();
      ctx.fill();
    }

    // Paired highlight + shadow ridge lines
    const [lr, lrg, lb] = hexToRgb(PALETTE.terrain.mountain.light);
    ctx.lineWidth = 1;
    for (let i = 0; i < 3; i++) {
      const x1 = rng.float(4, TEX_W - 4);
      const y1 = rng.float(4, TEX_H / 2);
      const x2 = x1 + rng.float(-6, 6);
      const y2 = y1 + rng.float(4, 10);
      // Highlight line
      ctx.strokeStyle = `rgba(${lr}, ${lrg}, ${lb}, 0.45)`;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      // Shadow line (offset by 1px)
      ctx.strokeStyle = 'rgba(50, 35, 20, 0.35)';
      ctx.beginPath();
      ctx.moveTo(x1 + 1, y1 + 1);
      ctx.lineTo(x2 + 1, y2 + 1);
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

    // Snow cap on top portion (all variants get some, stronger opacity)
    const snowAlpha = variant % 2 === 0 ? 0.5 : 0.3;
    const snowWidth = variant % 2 === 0 ? 8 : 5;
    ctx.fillStyle = `rgba(240, 240, 255, ${snowAlpha})`;
    ctx.beginPath();
    ctx.moveTo(TEX_W / 2, 2);
    ctx.lineTo(TEX_W / 2 + snowWidth, 10);
    ctx.lineTo(TEX_W / 2 - snowWidth, 10);
    ctx.closePath();
    ctx.fill();
  }

  // ----------------------------------------------------------
  // Water: 3-stop gradient + calmer 700ms cycle + more specular dots
  // ----------------------------------------------------------

  private drawWater(
    ctx: OffscreenCanvasRenderingContext2D,
    variant: number,
    animFrame: number,
  ): void {
    const rng = new SimpleRNG(400 + variant);
    const cx = TEX_W / 2;
    const cy = TEX_H / 2;

    // 3-stop gradient (shore-light -> mid -> deep)
    const grad = ctx.createRadialGradient(cx, cy, 2, cx, cy, TEX_W * 0.65);
    grad.addColorStop(0, PALETTE.terrain.water.light);
    grad.addColorStop(0.5, PALETTE.terrain.water.base);
    grad.addColorStop(1, PALETTE.terrain.water.dark);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, TEX_W, TEX_H);

    // Wave arcs (offset by animation frame)
    ctx.strokeStyle = 'rgba(100, 180, 230, 0.3)';
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
    ctx.strokeStyle = 'rgba(140, 210, 240, 0.2)';
    ctx.lineWidth = 0.5;
    for (let i = 0; i < 3; i++) {
      const wy = rng.float(4, TEX_H - 4) + frameOffset * 0.7;
      const wx = rng.float(3, TEX_W - 3);
      const wr = rng.float(3, 7);
      ctx.beginPath();
      ctx.arc(wx, (wy % TEX_H), wr, Math.PI * 0.2, Math.PI * 0.8);
      ctx.stroke();
    }

    // Specular dots (5 with size variation)
    for (let i = 0; i < 5; i++) {
      const sx = rng.float(4, TEX_W - 4);
      const sy = rng.float(4, TEX_H - 4) + frameOffset * 0.5;
      const dotSize = rng.float(0.4, 1.8);
      ctx.fillStyle = `rgba(255, 255, 255, ${rng.float(0.12, 0.4).toFixed(2)})`;
      ctx.beginPath();
      ctx.arc(sx, (sy % TEX_H), dotSize, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // ----------------------------------------------------------
  // Swamp: shimmer patches + two-tone reeds + lily pads + varied bubbles
  // ----------------------------------------------------------

  private drawSwamp(ctx: OffscreenCanvasRenderingContext2D, variant: number): void {
    const rng = new SimpleRNG(500 + variant);

    // Base fill
    ctx.fillStyle = PALETTE.terrain.swamp.base;
    ctx.fillRect(0, 0, TEX_W, TEX_H);

    // Murky water patches with shimmer
    for (let i = 0; i < 3; i++) {
      const px = rng.float(3, TEX_W - 5);
      const py = rng.float(3, TEX_H - 5);
      const pr = rng.float(3, 7);
      ctx.fillStyle = `rgba(35, 65, 45, ${rng.float(0.4, 0.65).toFixed(2)})`;
      ctx.beginPath();
      ctx.arc(px, py, pr, 0, Math.PI * 2);
      ctx.fill();

      // Shimmer highlight
      ctx.fillStyle = `rgba(100, 140, 100, ${rng.float(0.08, 0.18).toFixed(2)})`;
      ctx.beginPath();
      ctx.arc(px - 1, py - 1, pr * 0.4, 0, Math.PI * 2);
      ctx.fill();
    }

    // Two-tone reeds (green stems, dried yellow-brown tips)
    ctx.lineWidth = 1;
    const reedCount = rng.int(3, 6);
    for (let i = 0; i < reedCount; i++) {
      const rx = rng.float(4, TEX_W - 4);
      const ry = rng.float(TEX_H * 0.4, TEX_H - 3);
      const rh = rng.float(6, 12);
      const lean = rng.float(-1.5, 1.5);

      // Green stem (lower portion)
      ctx.strokeStyle = `rgba(${55 + rng.int(-10, 10)}, ${85 + rng.int(-10, 10)}, 35, 0.7)`;
      ctx.beginPath();
      ctx.moveTo(rx, ry);
      ctx.lineTo(rx + lean * 0.6, ry - rh * 0.6);
      ctx.stroke();

      // Dried yellow-brown tip (upper portion)
      ctx.strokeStyle = `rgba(${140 + rng.int(-20, 20)}, ${110 + rng.int(-15, 15)}, 50, 0.6)`;
      ctx.beginPath();
      ctx.moveTo(rx + lean * 0.6, ry - rh * 0.6);
      ctx.lineTo(rx + lean, ry - rh);
      ctx.stroke();

      // Cattail bulb at top
      ctx.fillStyle = '#5a4020';
      ctx.beginPath();
      ctx.ellipse(rx + lean, ry - rh - 1.5, 1.2, 2.5, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // Lily pad circles (1-2)
    const lilyCount = rng.int(1, 3);
    for (let i = 0; i < lilyCount; i++) {
      const lx = rng.float(5, TEX_W - 5);
      const ly = rng.float(5, TEX_H - 5);
      const lr = rng.float(2, 3.5);
      ctx.fillStyle = `rgba(50, 90, 40, ${rng.float(0.35, 0.55).toFixed(2)})`;
      ctx.beginPath();
      ctx.arc(lx, ly, lr, 0, Math.PI * 2);
      ctx.fill();
      // V-notch in lily pad
      ctx.strokeStyle = PALETTE.terrain.swamp.dark;
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(lx, ly);
      ctx.lineTo(lx + lr, ly - lr * 0.3);
      ctx.stroke();
    }

    // Bubble dots (larger, varied sizes)
    for (let i = 0; i < 4; i++) {
      const bx = rng.float(5, TEX_W - 5);
      const by = rng.float(5, TEX_H - 5);
      const br = rng.float(0.8, 2.5);
      ctx.strokeStyle = `rgba(140, 170, 130, ${rng.float(0.25, 0.45).toFixed(2)})`;
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.arc(bx, by, br, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}
