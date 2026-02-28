// ============================================================
// Agent RTS - Procedural Pixel Sprite Generator
// ============================================================
// Generates all unit and building pixel-art sprites on offscreen
// canvases at init time. No external image assets required.
// ============================================================

import { UnitType, BuildingType, PLAYER_COLORS, UnitBehaviorState } from '../shared/types';
import { PALETTE } from './ColorPalette';

// ---- Animation types ----

export type AnimState = 'idle' | 'moving' | 'attacking';

interface SpriteFrame {
  canvas: OffscreenCanvas;
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

interface UnitSpriteSet {
  idle: SpriteFrame[];
  moving: SpriteFrame[];
  attacking: SpriteFrame[];
}

interface BuildingSpriteSet {
  normal: SpriteFrame;
  constructing: SpriteFrame;
}

// ---- Constants ----

const UNIT_SIZE = 32;
const BUILDING_SIZE_LARGE = 64; // 2x2 buildings
const BUILDING_SIZE_SMALL = 32; // watchtower

const IDLE_FRAMES = 2;
const MOVING_FRAMES = 4;
const ATTACKING_FRAMES = 3;
const TICKS_PER_FRAME = 3;

// Outline color for the auto-outline pass
const OUTLINE: RGB = { r: 20, g: 20, b: 30 };

// ============================================================
// SpriteManager
// ============================================================

export class SpriteManager {
  private unitSprites: Map<string, UnitSpriteSet> = new Map();
  private buildingSprites: Map<string, BuildingSpriteSet> = new Map();

  init(): void {
    const unitTypes = Object.values(UnitType);
    const buildingTypes = Object.values(BuildingType);

    for (let playerIdx = 0; playerIdx < PLAYER_COLORS.length; playerIdx++) {
      for (const unitType of unitTypes) {
        const key = `${unitType}-${playerIdx}`;
        this.unitSprites.set(key, this.generateUnitSprites(unitType, playerIdx));
      }
      for (const buildingType of buildingTypes) {
        const key = `${buildingType}-${playerIdx}`;
        this.buildingSprites.set(key, this.generateBuildingSprites(buildingType, playerIdx));
      }
    }
  }

  /**
   * Get the current animation frame for a unit.
   */
  getUnitFrame(
    type: UnitType,
    playerIdx: number,
    animState: AnimState,
    tick: number,
  ): SpriteFrame {
    const key = `${type}-${playerIdx}`;
    const spriteSet = this.unitSprites.get(key);
    if (!spriteSet) {
      return this.fallbackFrame(UNIT_SIZE);
    }

    const frames = spriteSet[animState];
    const frameIndex = Math.floor(tick / TICKS_PER_FRAME) % frames.length;
    return frames[frameIndex];
  }

  /**
   * Get the sprite for a building.
   */
  getBuildingSprite(
    type: BuildingType,
    playerIdx: number,
    constructing: boolean,
  ): SpriteFrame {
    const key = `${type}-${playerIdx}`;
    const spriteSet = this.buildingSprites.get(key);
    if (!spriteSet) {
      const size = type === BuildingType.WATCHTOWER ? BUILDING_SIZE_SMALL : BUILDING_SIZE_LARGE;
      return this.fallbackFrame(size);
    }
    return constructing ? spriteSet.constructing : spriteSet.normal;
  }

  // ----------------------------------------------------------
  // Unit sprite generation
  // ----------------------------------------------------------

  private generateUnitSprites(type: UnitType, playerIdx: number): UnitSpriteSet {
    const color = PLAYER_COLORS[playerIdx];
    const { r, g, b } = this.hexToRgb(color);
    const dark = this.darken(r, g, b, 0.5);
    const light = this.lighten(r, g, b, 0.4);

    const drawFn = this.getUnitDrawFn(type);

    const idle = this.generateFrameStrip(IDLE_FRAMES, UNIT_SIZE, (ctx, frame) => {
      const bob = frame === 1 ? -1 : 0;
      this.drawGroundShadow(ctx, UNIT_SIZE);
      drawFn(ctx, { r, g, b }, dark, light, bob, 'idle', frame);
    });

    const moving = this.generateFrameStrip(MOVING_FRAMES, UNIT_SIZE, (ctx, frame) => {
      this.drawGroundShadow(ctx, UNIT_SIZE);
      drawFn(ctx, { r, g, b }, dark, light, 0, 'moving', frame);
    });

    const attacking = this.generateFrameStrip(ATTACKING_FRAMES, UNIT_SIZE, (ctx, frame) => {
      this.drawGroundShadow(ctx, UNIT_SIZE);
      drawFn(ctx, { r, g, b }, dark, light, 0, 'attacking', frame);
    });

    return { idle, moving, attacking };
  }

  private getUnitDrawFn(type: UnitType): DrawUnitFn {
    switch (type) {
      case UnitType.ENGINEER: return drawEngineer;
      case UnitType.SCOUT: return drawScout;
      case UnitType.SOLDIER: return drawSoldier;
      case UnitType.CAPTAIN: return drawCaptain;
      case UnitType.MESSENGER: return drawMessenger;
      case UnitType.SPY: return drawSpy;
      case UnitType.SIEGE: return drawSiege;
      default: return drawSoldier;
    }
  }

  // ----------------------------------------------------------
  // Building sprite generation
  // ----------------------------------------------------------

  private generateBuildingSprites(type: BuildingType, playerIdx: number): BuildingSpriteSet {
    const color = PLAYER_COLORS[playerIdx];
    const { r, g, b } = this.hexToRgb(color);
    const dark = this.darken(r, g, b, 0.5);
    const light = this.lighten(r, g, b, 0.4);
    const isSmall = type === BuildingType.WATCHTOWER;
    const size = isSmall ? BUILDING_SIZE_SMALL : BUILDING_SIZE_LARGE;

    const drawFn = this.getBuildingDrawFn(type);

    // Normal
    const normalCanvas = new OffscreenCanvas(size, size);
    const normalCtx = normalCanvas.getContext('2d')!;
    drawFn(normalCtx, { r, g, b }, dark, light, size, false);

    // Constructing (semi-transparent with scaffold lines)
    const constrCanvas = new OffscreenCanvas(size, size);
    const constrCtx = constrCanvas.getContext('2d')!;
    constrCtx.globalAlpha = 0.5;
    drawFn(constrCtx, { r, g, b }, dark, light, size, true);
    constrCtx.globalAlpha = 1.0;

    return {
      normal: { canvas: normalCanvas, sx: 0, sy: 0, sw: size, sh: size },
      constructing: { canvas: constrCanvas, sx: 0, sy: 0, sw: size, sh: size },
    };
  }

  private getBuildingDrawFn(type: BuildingType): DrawBuildingFn {
    switch (type) {
      case BuildingType.BASE: return drawBase;
      case BuildingType.BARRACKS: return drawBarracks;
      case BuildingType.FACTORY: return drawFactory;
      case BuildingType.WATCHTOWER: return drawWatchtower;
      default: return drawBase;
    }
  }

  // ----------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------

  /**
   * Draw a small dark semi-transparent ellipse at the bottom of each sprite frame.
   */
  private drawGroundShadow(ctx: OffscreenCanvasRenderingContext2D, size: number): void {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
    ctx.beginPath();
    ctx.ellipse(size / 2, size - 3, 5, 1.5, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  private generateFrameStrip(
    frameCount: number,
    size: number,
    drawFrame: (ctx: OffscreenCanvasRenderingContext2D, frameIndex: number) => void,
  ): SpriteFrame[] {
    const canvas = new OffscreenCanvas(size * frameCount, size);
    const ctx = canvas.getContext('2d')!;
    const frames: SpriteFrame[] = [];

    for (let i = 0; i < frameCount; i++) {
      ctx.save();
      ctx.translate(i * size, 0);
      drawFrame(ctx, i);
      ctx.restore();
    }

    // Auto-outline pass: scan all filled pixels, outline transparent neighbors
    this.applyOutline(canvas, size, frameCount);

    for (let i = 0; i < frameCount; i++) {
      frames.push({ canvas, sx: i * size, sy: 0, sw: size, sh: size });
    }

    return frames;
  }

  /**
   * Auto-outline pass: for any filled pixel with a transparent neighbor,
   * fill that neighbor with the dark outline color. Makes units pop off terrain.
   */
  private applyOutline(canvas: OffscreenCanvas, frameSize: number, frameCount: number): void {
    const w = frameSize * frameCount;
    const h = frameSize;
    const ctx = canvas.getContext('2d')!;
    const imageData = ctx.getImageData(0, 0, w, h);
    const { data } = imageData;

    // Collect outline pixels to write (don't modify during scan)
    const outlinePixels: number[] = [];

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = (y * w + x) * 4;
        // Skip transparent pixels
        if (data[idx + 3] < 10) continue;

        // Check 4 neighbors
        const neighbors = [
          [x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1],
        ];
        for (const [nx, ny] of neighbors) {
          if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
          const nIdx = (ny * w + nx) * 4;
          if (data[nIdx + 3] < 10) {
            outlinePixels.push(nIdx);
          }
        }
      }
    }

    // Write outline pixels
    for (const idx of outlinePixels) {
      data[idx] = OUTLINE.r;
      data[idx + 1] = OUTLINE.g;
      data[idx + 2] = OUTLINE.b;
      data[idx + 3] = 200;
    }

    ctx.putImageData(imageData, 0, 0);
  }

  private fallbackFrame(size: number): SpriteFrame {
    const canvas = new OffscreenCanvas(size, size);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ff00ff';
    ctx.fillRect(0, 0, size, size);
    return { canvas, sx: 0, sy: 0, sw: size, sh: size };
  }

  private hexToRgb(hex: string): { r: number; g: number; b: number } {
    const h = hex.replace('#', '');
    return {
      r: parseInt(h.substring(0, 2), 16),
      g: parseInt(h.substring(2, 4), 16),
      b: parseInt(h.substring(4, 6), 16),
    };
  }

  private darken(r: number, g: number, b: number, factor: number): RGB {
    return {
      r: Math.round(r * (1 - factor)),
      g: Math.round(g * (1 - factor)),
      b: Math.round(b * (1 - factor)),
    };
  }

  private lighten(r: number, g: number, b: number, factor: number): RGB {
    return {
      r: Math.min(255, Math.round(r + (255 - r) * factor)),
      g: Math.min(255, Math.round(g + (255 - g) * factor)),
      b: Math.min(255, Math.round(b + (255 - b) * factor)),
    };
  }
}

// ============================================================
// Pixel drawing utilities
// ============================================================

type RGB = { r: number; g: number; b: number };

function rgb(c: RGB): string {
  return `rgb(${c.r},${c.g},${c.b})`;
}

function fillPixel(ctx: OffscreenCanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: RGB): void {
  ctx.fillStyle = rgb(color);
  ctx.fillRect(x, y, w, h);
}

// Pixel scale: each "pixel" is 2x2 real pixels in our 32x32 sprite
const PX = 2;

type DrawUnitFn = (
  ctx: OffscreenCanvasRenderingContext2D,
  body: RGB,
  dark: RGB,
  light: RGB,
  yOffset: number,
  anim: 'idle' | 'moving' | 'attacking',
  frame: number,
) => void;

type DrawBuildingFn = (
  ctx: OffscreenCanvasRenderingContext2D,
  body: RGB,
  dark: RGB,
  light: RGB,
  size: number,
  constructing: boolean,
) => void;

// ============================================================
// Unit draw functions
// ============================================================

function drawEngineer(ctx: OffscreenCanvasRenderingContext2D, body: RGB, dark: RGB, light: RGB, yOff: number, anim: string, frame: number): void {
  const y = yOff;
  // Hard hat (wider brim)
  const hat: RGB = PALETTE.equipment.gold;
  fillPixel(ctx, 10, 4 + y, 12, PX, hat);
  fillPixel(ctx, 8, 6 + y, 16, PX, hat);
  // Head
  fillPixel(ctx, 12, 8 + y, 8, 6, body);
  fillPixel(ctx, 12, 8 + y, 8, PX, dark); // outline top
  // Body (stocky)
  fillPixel(ctx, 10, 14 + y, 12, 8, body);
  fillPixel(ctx, 8, 14 + y, PX, 8, dark); // left outline
  fillPixel(ctx, 22, 14 + y, PX, 8, dark); // right outline
  // Tool belt row at waist
  fillPixel(ctx, 10, 21 + y, 12, PX, PALETTE.equipment.leather);
  // Wrench in right hand (two-tone: brown handle, steel head)
  const wrenchOff = anim === 'attacking' ? (frame === 1 ? -2 : 0) : 0;
  fillPixel(ctx, 24, 18 + y + wrenchOff, PX, 4, PALETTE.equipment.wood);
  fillPixel(ctx, 24, 14 + y + wrenchOff, PX, 4, PALETTE.equipment.steel);
  fillPixel(ctx, 22, 14 + y + wrenchOff, PX, PX, PALETTE.equipment.steel);
  // Legs
  const legSpread = anim === 'moving' ? (frame % 2 === 0 ? 2 : -2) : 0;
  fillPixel(ctx, 12, 22 + y, PX, 8, dark);
  fillPixel(ctx, 18 + legSpread, 22 + y, PX, 8, dark);
  // Highlight
  fillPixel(ctx, 14, 16 + y, PX, PX, light);
}

function drawScout(ctx: OffscreenCanvasRenderingContext2D, body: RGB, dark: RGB, light: RGB, yOff: number, anim: string, frame: number): void {
  const y = yOff;
  // Goggles with green-tinted lenses
  fillPixel(ctx, 12, 6 + y, 8, PX, { r: 200, g: 100, b: 50 });
  fillPixel(ctx, 10, 6 + y, PX, PX, { r: 80, g: 180, b: 80 }); // green lens
  fillPixel(ctx, 20, 6 + y, PX, PX, { r: 80, g: 180, b: 80 }); // green lens
  // Head
  fillPixel(ctx, 12, 4 + y, 8, 6, body);
  // Scarf detail at neck
  fillPixel(ctx, 10, 9 + y, 12, PX, { r: 160, g: 80, b: 60 });
  // Lean body
  const lean = anim === 'moving' ? (frame % 2 === 0 ? 1 : -1) : 0;
  fillPixel(ctx, 12 + lean, 10 + y, 8, 10, body);
  fillPixel(ctx, 10 + lean, 10 + y, PX, 10, dark);
  fillPixel(ctx, 20 + lean, 10 + y, PX, 10, dark);
  // Arm swing on movement
  if (anim === 'moving') {
    const armOff = frame % 2 === 0 ? -2 : 2;
    fillPixel(ctx, 8, 12 + y + armOff, PX, 4, body);
    fillPixel(ctx, 22, 12 + y - armOff, PX, 4, body);
  }
  // Legs (running pose)
  const legAnim = anim === 'moving' ? frame : 0;
  const lOff = legAnim % 2 === 0 ? 3 : -1;
  const rOff = legAnim % 2 === 0 ? -1 : 3;
  fillPixel(ctx, 12, 20 + y, PX, 8 + lOff, dark);
  fillPixel(ctx, 18, 20 + y, PX, 8 + rOff, dark);
  // Highlight
  fillPixel(ctx, 14, 12 + y, PX, PX, light);
}

function drawSoldier(ctx: OffscreenCanvasRenderingContext2D, body: RGB, dark: RGB, light: RGB, yOff: number, anim: string, frame: number): void {
  const y = yOff;
  // Helmet with visor strip
  fillPixel(ctx, 10, 2 + y, 12, PX, dark);
  fillPixel(ctx, 10, 4 + y, 12, PX, body);
  fillPixel(ctx, 10, 5 + y, 12, 1, { r: 60, g: 60, b: 70 }); // visor strip
  // Head
  fillPixel(ctx, 12, 6 + y, 8, 6, body);
  // Broad body
  fillPixel(ctx, 8, 12 + y, 16, 10, body);
  fillPixel(ctx, 6, 12 + y, PX, 10, dark);
  fillPixel(ctx, 24, 12 + y, PX, 10, dark);
  // Shield (left) with cross emblem
  fillPixel(ctx, 2, 12 + y, 6, 8, dark);
  fillPixel(ctx, 4, 14 + y, PX, 4, light);
  fillPixel(ctx, 3, 15 + y, 4, PX, light); // cross horizontal
  fillPixel(ctx, 4, 14 + y, PX, 4, light); // cross vertical
  // Sword (right) with guard/pommel
  const swordExt = anim === 'attacking' ? (frame === 0 ? 0 : frame === 1 ? -4 : -1) : 0;
  fillPixel(ctx, 26, 10 + y + swordExt, PX, 12, PALETTE.equipment.steel);
  fillPixel(ctx, 24, 14 + y, 6, PX, PALETTE.equipment.leather); // guard
  fillPixel(ctx, 26, 22 + y + swordExt, PX, PX, PALETTE.equipment.gold); // pommel
  // Legs
  const legMod = anim === 'moving' ? (frame % 2 === 0 ? 2 : -2) : 0;
  fillPixel(ctx, 10, 22 + y, PX, 8, dark);
  fillPixel(ctx, 20 + legMod, 22 + y, PX, 8, dark);
  // Chest highlight
  fillPixel(ctx, 14, 14 + y, 4, PX, light);
}

function drawCaptain(ctx: OffscreenCanvasRenderingContext2D, body: RGB, dark: RGB, light: RGB, yOff: number, anim: string, frame: number): void {
  const y = yOff;
  // Richer red cape with hem detail
  const capeFlutter = anim === 'moving' ? (frame % 2) * 2 : 0;
  fillPixel(ctx, 6, 10 + y, PX, 14 + capeFlutter, { r: 180, g: 40, b: 40 });
  fillPixel(ctx, 8, 12 + y, PX, 12 + capeFlutter, { r: 180, g: 40, b: 40 });
  // Cape hem detail (darker edge)
  fillPixel(ctx, 6, 23 + y + capeFlutter, PX, PX, { r: 120, g: 25, b: 25 });
  fillPixel(ctx, 8, 23 + y + capeFlutter, PX, PX, { r: 120, g: 25, b: 25 });
  // Head
  fillPixel(ctx, 12, 4 + y, 8, 6, body);
  // Shoulder pauldrons
  fillPixel(ctx, 8, 10 + y, 4, 3, dark);
  fillPixel(ctx, 20, 10 + y, 4, 3, dark);
  fillPixel(ctx, 9, 10 + y, 2, 1, light); // pauldron highlight
  fillPixel(ctx, 21, 10 + y, 2, 1, light);
  // Proper 5-pixel star badge
  fillPixel(ctx, 15, 13 + y, 2, PX, PALETTE.equipment.gold); // center
  fillPixel(ctx, 13, 14 + y, PX, PX, PALETTE.equipment.gold); // left
  fillPixel(ctx, 18, 14 + y, PX, PX, PALETTE.equipment.gold); // right
  fillPixel(ctx, 15, 16 + y, PX, PX, PALETTE.equipment.gold); // bottom
  // Body
  fillPixel(ctx, 10, 10 + y, 12, 12, body);
  fillPixel(ctx, 8, 10 + y, PX, 12, dark);
  fillPixel(ctx, 22, 10 + y, PX, 12, dark);
  // Arms
  const armSwing = anim === 'attacking' ? (frame === 1 ? -3 : 0) : 0;
  fillPixel(ctx, 24, 12 + y + armSwing, PX, 8, body);
  // Legs
  const legMod = anim === 'moving' ? (frame % 2 === 0 ? 2 : -2) : 0;
  fillPixel(ctx, 12, 22 + y, PX, 8, dark);
  fillPixel(ctx, 18 + legMod, 22 + y, PX, 8, dark);
  // Highlight
  fillPixel(ctx, 16, 12 + y, PX, PX, light);
}

function drawMessenger(ctx: OffscreenCanvasRenderingContext2D, body: RGB, dark: RGB, light: RGB, yOff: number, anim: string, frame: number): void {
  const y = yOff;
  // Head
  fillPixel(ctx, 13, 4 + y, 6, 6, body);
  // Slim body
  fillPixel(ctx, 12, 10 + y, 8, 10, body);
  fillPixel(ctx, 10, 10 + y, PX, 10, dark);
  fillPixel(ctx, 20, 10 + y, PX, 10, dark);
  // More visible satchel (larger, with strap detail)
  fillPixel(ctx, 22, 11 + y, 5, 7, PALETTE.equipment.leather);
  fillPixel(ctx, 20, 11 + y, PX, PX, PALETTE.equipment.leather); // strap
  fillPixel(ctx, 23, 13 + y, 3, 1, PALETTE.equipment.gold); // buckle
  // Wing boots with better flap animation
  const wingFlap = anim === 'moving' ? (frame % 2 === 0 ? -2 : 1) : 0;
  fillPixel(ctx, 7, 26 + y + wingFlap, 5, PX, light);
  fillPixel(ctx, 6, 25 + y + wingFlap, PX, PX, light); // wing tip
  fillPixel(ctx, 20, 26 + y - wingFlap, 5, PX, light);
  fillPixel(ctx, 26, 25 + y - wingFlap, PX, PX, light); // wing tip
  // Legs
  const legMod = anim === 'moving' ? (frame % 2 === 0 ? 3 : -1) : 0;
  fillPixel(ctx, 13, 20 + y, PX, 8 + legMod, dark);
  fillPixel(ctx, 17, 20 + y, PX, 8 - legMod, dark);
  // Highlight
  fillPixel(ctx, 14, 12 + y, PX, PX, light);
}

function drawSpy(ctx: OffscreenCanvasRenderingContext2D, body: RGB, dark: RGB, light: RGB, yOff: number, anim: string, frame: number): void {
  const y = yOff;
  // Hood
  fillPixel(ctx, 10, 2 + y, 12, 4, dark);
  fillPixel(ctx, 8, 4 + y, PX, 4, dark);
  fillPixel(ctx, 22, 4 + y, PX, 4, dark);
  // Face (barely visible)
  fillPixel(ctx, 12, 6 + y, 8, 4, body);
  // Red-tinted pulsing eyes (brighter on frame 1)
  const eyeBright = frame === 1 ? 255 : 180;
  fillPixel(ctx, 13, 7 + y, PX, PX, { r: eyeBright, g: 60, b: 60 });
  fillPixel(ctx, 17, 7 + y, PX, PX, { r: eyeBright, g: 60, b: 60 });
  // Cloak body with diagonal texture
  const cloakWave = anim === 'moving' ? (frame % 2) : 0;
  fillPixel(ctx, 8, 10 + y, 16, 14 + cloakWave, dark);
  fillPixel(ctx, 6, 12 + y, PX, 10 + cloakWave, dark);
  fillPixel(ctx, 24, 12 + y, PX, 10 + cloakWave, dark);
  // Diagonal cloak texture lines
  for (let i = 0; i < 3; i++) {
    const tx = 10 + i * 4;
    const ty = 12 + y + i * 3;
    ctx.fillStyle = `rgba(${dark.r + 15}, ${dark.g + 15}, ${dark.b + 15}, 0.4)`;
    ctx.fillRect(tx, ty, 3, 1);
  }
  // Always-visible dagger (shown at side when not attacking)
  if (anim === 'attacking') {
    const daggerOff = frame === 1 ? -4 : 0;
    fillPixel(ctx, 26, 14 + y + daggerOff, PX, 6, PALETTE.equipment.steel);
  } else {
    fillPixel(ctx, 22, 18 + y, PX, 4, PALETTE.equipment.steel);
  }
  // Legs (barely visible under cloak)
  fillPixel(ctx, 12, 24 + y + cloakWave, PX, 6, dark);
  fillPixel(ctx, 18, 24 + y + cloakWave, PX, 6, dark);
  // Subtle highlight on cloak edge
  fillPixel(ctx, 10, 14 + y, PX, PX, light);
}

function drawSiege(ctx: OffscreenCanvasRenderingContext2D, body: RGB, dark: RGB, light: RGB, yOff: number, anim: string, frame: number): void {
  const y = yOff;
  // Wheels with spokes
  fillPixel(ctx, 4, 24 + y, 6, 6, dark);
  fillPixel(ctx, 22, 24 + y, 6, 6, dark);
  fillPixel(ctx, 6, 26 + y, PX, PX, light); // axle
  fillPixel(ctx, 24, 26 + y, PX, PX, light); // axle
  // Wheel spokes
  fillPixel(ctx, 5, 25 + y, 1, 4, { r: 80, g: 80, b: 80 });
  fillPixel(ctx, 8, 25 + y, 1, 4, { r: 80, g: 80, b: 80 });
  fillPixel(ctx, 23, 25 + y, 1, 4, { r: 80, g: 80, b: 80 });
  fillPixel(ctx, 26, 25 + y, 1, 4, { r: 80, g: 80, b: 80 });
  // Body/frame
  fillPixel(ctx, 4, 16 + y, 24, 8, body);
  fillPixel(ctx, 2, 16 + y, PX, 8, dark);
  fillPixel(ctx, 28, 16 + y, PX, 8, dark);
  // Barrel bands
  fillPixel(ctx, 20, 13 + y, 1, 4, PALETTE.equipment.steel);
  fillPixel(ctx, 25, 13 + y, 1, 4, PALETTE.equipment.steel);
  // Cannon barrel
  const recoil = anim === 'attacking' ? (frame === 1 ? -3 : frame === 2 ? 1 : 0) : 0;
  fillPixel(ctx, 20 + recoil, 12 + y, 10, 4, dark);
  fillPixel(ctx, 28 + recoil, 10 + y, 4, 8, { r: 100, g: 100, b: 100 });
  // Improved 3-stage muzzle flash
  if (anim === 'attacking') {
    if (frame === 0) {
      // Spark
      fillPixel(ctx, 30, 13 + y, 1, 2, PALETTE.equipment.gold);
    } else if (frame === 1) {
      // Full flash
      fillPixel(ctx, 30, 11 + y, 2, 6, { r: 255, g: 200, b: 50 });
      fillPixel(ctx, 29, 12 + y, 1, 4, { r: 255, g: 150, b: 30 });
    } else {
      // Smoke
      fillPixel(ctx, 30, 12 + y, 2, 4, { r: 150, g: 150, b: 150 });
    }
  }
  // Highlight
  fillPixel(ctx, 12, 18 + y, 4, PX, light);
}

// ============================================================
// Building draw functions
// ============================================================

function drawBase(ctx: OffscreenCanvasRenderingContext2D, body: RGB, dark: RGB, light: RGB, size: number, constructing: boolean): void {
  // Castle walls with stone row texture
  fillPixel(ctx, 4, 16, size - 8, size - 20, body);
  // Stone row texture (horizontal lines)
  for (let ry = 20; ry < size - 6; ry += 6) {
    ctx.fillStyle = `rgba(${dark.r},${dark.g},${dark.b},0.25)`;
    ctx.fillRect(4, ry, size - 8, 1);
  }
  // Outline
  ctx.strokeStyle = rgb(dark);
  ctx.lineWidth = 2;
  ctx.strokeRect(4, 16, size - 8, size - 20);
  // Battlements
  for (let x = 4; x < size - 4; x += 8) {
    fillPixel(ctx, x, 12, 4, 6, body);
    fillPixel(ctx, x, 10, 4, PX, dark);
  }
  // Flanking torch pixels
  ctx.fillStyle = `rgb(${PALETTE.equipment.gold.r},${PALETTE.equipment.gold.g},${PALETTE.equipment.gold.b})`;
  ctx.fillRect(6, 18, 2, 2);
  ctx.fillRect(size - 8, 18, 2, 2);
  ctx.fillStyle = 'rgba(255, 150, 50, 0.6)';
  ctx.fillRect(6, 16, 2, 2); // flame
  ctx.fillRect(size - 8, 16, 2, 2); // flame
  // Gate
  fillPixel(ctx, size / 2 - 6, size - 16, 12, 12, dark);
  fillPixel(ctx, size / 2 - 4, size - 14, 8, 10, { r: 60, g: 40, b: 20 });
  // Flag
  fillPixel(ctx, size / 2, 2, PX, 12, PALETTE.equipment.wood); // pole
  fillPixel(ctx, size / 2 + 2, 2, 8, 6, body);
  fillPixel(ctx, size / 2 + 4, 4, 4, PX, light); // flag detail
  // Mullioned windows (2x2 with cross)
  fillPixel(ctx, 12, 24, 4, 4, light);
  ctx.fillStyle = rgb(dark);
  ctx.fillRect(13, 24, 1, 4); // vertical mullion
  ctx.fillRect(12, 25, 4, 1); // horizontal mullion
  fillPixel(ctx, size - 16, 24, 4, 4, light);
  ctx.fillStyle = rgb(dark);
  ctx.fillRect(size - 15, 24, 1, 4);
  ctx.fillRect(size - 16, 25, 4, 1);
  // Scaffold for constructing
  if (constructing) {
    ctx.strokeStyle = PALETTE.building.scaffold;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.strokeRect(2, 10, size - 4, size - 14);
    ctx.setLineDash([]);
  }
}

function drawBarracks(ctx: OffscreenCanvasRenderingContext2D, body: RGB, dark: RGB, light: RGB, size: number, constructing: boolean): void {
  // Main building
  fillPixel(ctx, 6, 20, size - 12, size - 24, body);
  ctx.strokeStyle = rgb(dark);
  ctx.lineWidth = 2;
  ctx.strokeRect(6, 20, size - 12, size - 24);
  // Roof with ridge highlight
  ctx.fillStyle = rgb(dark);
  ctx.beginPath();
  ctx.moveTo(size / 2, 8);
  ctx.lineTo(6, 22);
  ctx.lineTo(size - 6, 22);
  ctx.closePath();
  ctx.fill();
  // Roof ridge highlight
  ctx.strokeStyle = `rgba(${light.r},${light.g},${light.b},0.5)`;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(size / 2, 8);
  ctx.lineTo(size / 2, 10);
  ctx.stroke();
  // Door
  fillPixel(ctx, size / 2 - 4, size - 12, 8, 8, { r: 60, g: 40, b: 20 });
  // Pixel-art crossed swords
  ctx.strokeStyle = rgb(light);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(12, 26);
  ctx.lineTo(20, 38);
  ctx.moveTo(20, 26);
  ctx.lineTo(12, 38);
  ctx.stroke();
  // Sword hilts
  ctx.fillStyle = rgb(PALETTE.equipment.gold);
  ctx.fillRect(11, 25, 3, 2);
  ctx.fillRect(19, 25, 3, 2);
  // Training dummy detail
  fillPixel(ctx, size - 18, 30, 2, 8, PALETTE.equipment.wood);
  fillPixel(ctx, size - 20, 32, 6, 2, PALETTE.equipment.wood);
  // Shield emblem
  fillPixel(ctx, size - 22, 28, 6, 8, light);
  if (constructing) {
    ctx.strokeStyle = PALETTE.building.scaffold;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.strokeRect(4, 8, size - 8, size - 12);
    ctx.setLineDash([]);
  }
}

function drawFactory(ctx: OffscreenCanvasRenderingContext2D, body: RGB, dark: RGB, light: RGB, size: number, constructing: boolean): void {
  // Main building
  fillPixel(ctx, 6, 24, size - 12, size - 28, body);
  ctx.strokeStyle = rgb(dark);
  ctx.lineWidth = 2;
  ctx.strokeRect(6, 24, size - 12, size - 28);
  // Chimney
  fillPixel(ctx, 12, 8, 6, 18, dark);
  fillPixel(ctx, 10, 6, 10, 4, dark);
  // Varied smoke positions per variant (use body color seed)
  const smokeOff = (body.r + body.g) % 4;
  fillPixel(ctx, 10 + smokeOff, 2, 4, 4, { r: 150, g: 150, b: 150 });
  fillPixel(ctx, 14 + smokeOff, 0, 4, 4, { r: 180, g: 180, b: 180 });
  fillPixel(ctx, 8 + smokeOff, 0, 3, 3, { r: 160, g: 160, b: 160 });
  // Pixel-gear emblem
  const gx = size - 22;
  const gy = 32;
  ctx.strokeStyle = rgb(light);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(gx + 4, gy + 4, 6, 0, Math.PI * 2);
  ctx.stroke();
  fillPixel(ctx, gx + 2, gy + 2, 4, 4, light);
  // Gear teeth
  const gr = 6;
  for (let i = 0; i < 4; i++) {
    const angle = (i * Math.PI) / 2;
    const tx = gx + 4 + Math.cos(angle) * (gr + 1);
    const ty = gy + 4 + Math.sin(angle) * (gr + 1);
    ctx.fillStyle = rgb(light);
    ctx.fillRect(tx - 1, ty - 1, 2, 2);
  }
  // Conveyor belt strip at base
  ctx.fillStyle = `rgba(${dark.r},${dark.g},${dark.b},0.6)`;
  ctx.fillRect(8, size - 6, size - 16, 2);
  for (let cx = 10; cx < size - 10; cx += 4) {
    ctx.fillStyle = `rgba(${light.r},${light.g},${light.b},0.4)`;
    ctx.fillRect(cx, size - 6, 2, 2);
  }
  // Door
  fillPixel(ctx, size / 2 - 5, size - 10, 10, 6, { r: 60, g: 40, b: 20 });
  // Window
  fillPixel(ctx, 16, 30, 4, 4, light);
  if (constructing) {
    ctx.strokeStyle = PALETTE.building.scaffold;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.strokeRect(4, 6, size - 8, size - 10);
    ctx.setLineDash([]);
  }
}

function drawWatchtower(ctx: OffscreenCanvasRenderingContext2D, body: RGB, dark: RGB, light: RGB, size: number, constructing: boolean): void {
  // Tower body (tall narrow)
  fillPixel(ctx, 10, 8, 12, 22, body);
  ctx.strokeStyle = rgb(dark);
  ctx.lineWidth = 2;
  ctx.strokeRect(10, 8, 12, 22);
  // Platform top (wider)
  fillPixel(ctx, 6, 4, 20, 6, body);
  ctx.strokeStyle = rgb(dark);
  ctx.strokeRect(6, 4, 20, 6);
  // Railing line
  ctx.strokeStyle = `rgba(${dark.r},${dark.g},${dark.b},0.6)`;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(6, 4);
  ctx.lineTo(26, 4);
  ctx.stroke();
  // Battlements on top
  fillPixel(ctx, 6, 2, 4, 4, dark);
  fillPixel(ctx, 14, 2, 4, 4, dark);
  fillPixel(ctx, 22, 2, 4, 4, dark);
  // Beacon flame at top
  ctx.fillStyle = 'rgba(255, 150, 50, 0.8)';
  ctx.fillRect(15, 0, 2, 2);
  ctx.fillStyle = 'rgba(255, 200, 80, 0.6)';
  ctx.fillRect(14, 1, 4, 1);
  // Narrower arrow-slit window
  fillPixel(ctx, 15, 14, 2, 6, light);
  // Door at bottom
  fillPixel(ctx, 13, 26, 6, 4, { r: 60, g: 40, b: 20 });
  if (constructing) {
    ctx.strokeStyle = PALETTE.building.scaffold;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.strokeRect(4, 2, 24, 28);
    ctx.setLineDash([]);
  }
}

// ============================================================
// Helper to convert UnitBehaviorState to AnimState
// ============================================================

export function behaviorToAnimState(behavior: UnitBehaviorState): AnimState {
  switch (behavior) {
    case UnitBehaviorState.MOVING:
    case UnitBehaviorState.GATHERING:
    case UnitBehaviorState.RETURNING:
    case UnitBehaviorState.BUILDING:
      return 'moving';
    case UnitBehaviorState.ATTACKING:
      return 'attacking';
    default:
      return 'idle';
  }
}
