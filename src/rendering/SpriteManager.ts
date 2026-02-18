// ============================================================
// Agent RTS - Procedural Pixel Sprite Generator
// ============================================================
// Generates all unit and building pixel-art sprites on offscreen
// canvases at init time. No external image assets required.
// ============================================================

import { UnitType, BuildingType, PLAYER_COLORS, UnitBehaviorState } from '../shared/types';

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
      drawFn(ctx, { r, g, b }, dark, light, bob, 'idle', frame);
    });

    const moving = this.generateFrameStrip(MOVING_FRAMES, UNIT_SIZE, (ctx, frame) => {
      drawFn(ctx, { r, g, b }, dark, light, 0, 'moving', frame);
    });

    const attacking = this.generateFrameStrip(ATTACKING_FRAMES, UNIT_SIZE, (ctx, frame) => {
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
      frames.push({ canvas, sx: i * size, sy: 0, sw: size, sh: size });
    }

    return frames;
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
  // Hard hat (yellow-ish tint)
  const hat: RGB = { r: 220, g: 200, b: 50 };
  fillPixel(ctx, 12, 4 + y, 8, PX, hat);
  fillPixel(ctx, 10, 6 + y, 12, PX, hat);
  // Head
  fillPixel(ctx, 12, 8 + y, 8, 6, body);
  fillPixel(ctx, 12, 8 + y, 8, PX, dark); // outline top
  // Body (stocky)
  fillPixel(ctx, 10, 14 + y, 12, 8, body);
  fillPixel(ctx, 8, 14 + y, PX, 8, dark); // left outline
  fillPixel(ctx, 22, 14 + y, PX, 8, dark); // right outline
  // Wrench in right hand
  const wrenchOff = anim === 'attacking' ? (frame === 1 ? -2 : 0) : 0;
  fillPixel(ctx, 24, 16 + y + wrenchOff, PX, 6, { r: 180, g: 180, b: 180 });
  fillPixel(ctx, 22, 14 + y + wrenchOff, PX, PX, { r: 180, g: 180, b: 180 });
  // Legs
  const legSpread = anim === 'moving' ? (frame % 2 === 0 ? 2 : -2) : 0;
  fillPixel(ctx, 12, 22 + y, PX, 8, dark);
  fillPixel(ctx, 18 + legSpread, 22 + y, PX, 8, dark);
  // Highlight
  fillPixel(ctx, 14, 16 + y, PX, PX, light);
}

function drawScout(ctx: OffscreenCanvasRenderingContext2D, body: RGB, dark: RGB, light: RGB, yOff: number, anim: string, frame: number): void {
  const y = yOff;
  // Goggles
  fillPixel(ctx, 12, 6 + y, 8, PX, { r: 200, g: 100, b: 50 });
  fillPixel(ctx, 10, 6 + y, PX, PX, { r: 200, g: 200, b: 200 }); // lens
  fillPixel(ctx, 20, 6 + y, PX, PX, { r: 200, g: 200, b: 200 }); // lens
  // Head
  fillPixel(ctx, 12, 4 + y, 8, 6, body);
  // Lean body
  const lean = anim === 'moving' ? (frame % 2 === 0 ? 1 : -1) : 0;
  fillPixel(ctx, 12 + lean, 10 + y, 8, 10, body);
  fillPixel(ctx, 10 + lean, 10 + y, PX, 10, dark);
  fillPixel(ctx, 20 + lean, 10 + y, PX, 10, dark);
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
  // Helmet
  fillPixel(ctx, 10, 2 + y, 12, PX, dark);
  fillPixel(ctx, 10, 4 + y, 12, PX, body);
  // Head
  fillPixel(ctx, 12, 6 + y, 8, 6, body);
  // Broad body
  fillPixel(ctx, 8, 12 + y, 16, 10, body);
  fillPixel(ctx, 6, 12 + y, PX, 10, dark);
  fillPixel(ctx, 24, 12 + y, PX, 10, dark);
  // Shield (left)
  fillPixel(ctx, 2, 12 + y, 6, 8, dark);
  fillPixel(ctx, 4, 14 + y, PX, 4, light);
  // Sword (right)
  const swordExt = anim === 'attacking' ? (frame === 0 ? 0 : frame === 1 ? -4 : -1) : 0;
  fillPixel(ctx, 26, 10 + y + swordExt, PX, 12, { r: 200, g: 200, b: 210 });
  fillPixel(ctx, 24, 14 + y, 6, PX, { r: 139, g: 90, b: 43 }); // hilt
  // Legs
  const legMod = anim === 'moving' ? (frame % 2 === 0 ? 2 : -2) : 0;
  fillPixel(ctx, 10, 22 + y, PX, 8, dark);
  fillPixel(ctx, 20 + legMod, 22 + y, PX, 8, dark);
  // Chest highlight
  fillPixel(ctx, 14, 14 + y, 4, PX, light);
}

function drawCaptain(ctx: OffscreenCanvasRenderingContext2D, body: RGB, dark: RGB, light: RGB, yOff: number, anim: string, frame: number): void {
  const y = yOff;
  // Cape (behind, flutters with movement)
  const capeFlutter = anim === 'moving' ? (frame % 2) * 2 : 0;
  fillPixel(ctx, 6, 10 + y, PX, 14 + capeFlutter, { r: 180, g: 40, b: 40 });
  fillPixel(ctx, 8, 12 + y, PX, 12 + capeFlutter, { r: 180, g: 40, b: 40 });
  // Head
  fillPixel(ctx, 12, 4 + y, 8, 6, body);
  // Star badge
  fillPixel(ctx, 14, 14 + y, 4, 4, { r: 255, g: 215, b: 0 });
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
  // Satchel
  fillPixel(ctx, 22, 12 + y, 4, 6, { r: 139, g: 90, b: 43 });
  fillPixel(ctx, 20, 12 + y, PX, PX, { r: 139, g: 90, b: 43 }); // strap
  // Wing boots
  const wingFlap = anim === 'moving' ? (frame % 2 === 0 ? -2 : 0) : 0;
  fillPixel(ctx, 8, 26 + y + wingFlap, 4, PX, light);
  fillPixel(ctx, 20, 26 + y - wingFlap, 4, PX, light);
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
  // Eyes (glowing)
  fillPixel(ctx, 13, 7 + y, PX, PX, { r: 200, g: 255, b: 200 });
  fillPixel(ctx, 17, 7 + y, PX, PX, { r: 200, g: 255, b: 200 });
  // Cloak body
  const cloakWave = anim === 'moving' ? (frame % 2) : 0;
  fillPixel(ctx, 8, 10 + y, 16, 14 + cloakWave, dark);
  fillPixel(ctx, 6, 12 + y, PX, 10 + cloakWave, dark);
  fillPixel(ctx, 24, 12 + y, PX, 10 + cloakWave, dark);
  // Dagger (shown during attack)
  if (anim === 'attacking') {
    const daggerOff = frame === 1 ? -4 : 0;
    fillPixel(ctx, 26, 14 + y + daggerOff, PX, 6, { r: 200, g: 200, b: 210 });
  }
  // Legs (barely visible under cloak)
  fillPixel(ctx, 12, 24 + y + cloakWave, PX, 6, dark);
  fillPixel(ctx, 18, 24 + y + cloakWave, PX, 6, dark);
  // Subtle highlight on cloak edge
  fillPixel(ctx, 10, 14 + y, PX, PX, light);
}

function drawSiege(ctx: OffscreenCanvasRenderingContext2D, body: RGB, dark: RGB, light: RGB, yOff: number, anim: string, frame: number): void {
  const y = yOff;
  // Wheels
  fillPixel(ctx, 4, 24 + y, 6, 6, dark);
  fillPixel(ctx, 22, 24 + y, 6, 6, dark);
  fillPixel(ctx, 6, 26 + y, PX, PX, light); // axle
  fillPixel(ctx, 24, 26 + y, PX, PX, light); // axle
  // Body/frame
  fillPixel(ctx, 4, 16 + y, 24, 8, body);
  fillPixel(ctx, 2, 16 + y, PX, 8, dark);
  fillPixel(ctx, 28, 16 + y, PX, 8, dark);
  // Cannon barrel
  const recoil = anim === 'attacking' ? (frame === 1 ? -3 : frame === 2 ? 1 : 0) : 0;
  fillPixel(ctx, 20 + recoil, 12 + y, 10, 4, dark);
  fillPixel(ctx, 28 + recoil, 10 + y, 4, 8, { r: 100, g: 100, b: 100 });
  // Cannonball flash
  if (anim === 'attacking' && frame === 1) {
    fillPixel(ctx, 30, 12 + y, 2, 4, { r: 255, g: 200, b: 50 });
  }
  // Highlight
  fillPixel(ctx, 12, 18 + y, 4, PX, light);
}

// ============================================================
// Building draw functions
// ============================================================

function drawBase(ctx: OffscreenCanvasRenderingContext2D, body: RGB, dark: RGB, light: RGB, size: number, constructing: boolean): void {
  // Castle walls
  fillPixel(ctx, 4, 16, size - 8, size - 20, body);
  // Outline
  ctx.strokeStyle = rgb(dark);
  ctx.lineWidth = 2;
  ctx.strokeRect(4, 16, size - 8, size - 20);
  // Battlements
  for (let x = 4; x < size - 4; x += 8) {
    fillPixel(ctx, x, 12, 4, 6, body);
    fillPixel(ctx, x, 10, 4, PX, dark);
  }
  // Gate
  fillPixel(ctx, size / 2 - 6, size - 16, 12, 12, dark);
  fillPixel(ctx, size / 2 - 4, size - 14, 8, 10, { r: 60, g: 40, b: 20 });
  // Flag
  fillPixel(ctx, size / 2, 2, PX, 12, { r: 139, g: 90, b: 43 }); // pole
  fillPixel(ctx, size / 2 + 2, 2, 8, 6, body);
  fillPixel(ctx, size / 2 + 4, 4, 4, PX, light); // flag detail
  // Window highlights
  fillPixel(ctx, 12, 24, 4, 4, light);
  fillPixel(ctx, size - 16, 24, 4, 4, light);
  // Scaffold for constructing
  if (constructing) {
    ctx.strokeStyle = 'rgba(139, 90, 43, 0.6)';
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
  // Roof
  ctx.fillStyle = rgb(dark);
  ctx.beginPath();
  ctx.moveTo(size / 2, 8);
  ctx.lineTo(6, 22);
  ctx.lineTo(size - 6, 22);
  ctx.closePath();
  ctx.fill();
  // Door
  fillPixel(ctx, size / 2 - 4, size - 12, 8, 8, { r: 60, g: 40, b: 20 });
  // Weapon rack (crossed swords)
  ctx.strokeStyle = rgb(light);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(12, 26);
  ctx.lineTo(20, 38);
  ctx.moveTo(20, 26);
  ctx.lineTo(12, 38);
  ctx.stroke();
  // Shield emblem
  fillPixel(ctx, size - 22, 28, 6, 8, light);
  if (constructing) {
    ctx.strokeStyle = 'rgba(139, 90, 43, 0.6)';
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
  // Smoke puffs
  fillPixel(ctx, 10, 2, 4, 4, { r: 150, g: 150, b: 150 });
  fillPixel(ctx, 16, 0, 4, 4, { r: 180, g: 180, b: 180 });
  // Gear emblem
  const gx = size - 22;
  const gy = 32;
  ctx.strokeStyle = rgb(light);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(gx + 4, gy + 4, 6, 0, Math.PI * 2);
  ctx.stroke();
  fillPixel(ctx, gx + 2, gy + 2, 4, 4, light);
  // Door
  fillPixel(ctx, size / 2 - 5, size - 10, 10, 6, { r: 60, g: 40, b: 20 });
  // Window
  fillPixel(ctx, 16, 30, 4, 4, light);
  if (constructing) {
    ctx.strokeStyle = 'rgba(139, 90, 43, 0.6)';
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
  // Battlements on top
  fillPixel(ctx, 6, 2, 4, 4, dark);
  fillPixel(ctx, 14, 2, 4, 4, dark);
  fillPixel(ctx, 22, 2, 4, 4, dark);
  // Window slit
  fillPixel(ctx, 14, 14, 4, 6, light);
  // Door at bottom
  fillPixel(ctx, 13, 26, 6, 4, { r: 60, g: 40, b: 20 });
  if (constructing) {
    ctx.strokeStyle = 'rgba(139, 90, 43, 0.6)';
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
