// ============================================================
// Agent RTS - Shared Type Definitions
// ============================================================

// ============ Grid Types & Utilities ============

export interface GridPosition {
  col: number; // 0-indexed
  row: number; // 0-indexed
}

/** Convert 0-indexed column number to alpha label (0='A', 25='Z', 26='AA') */
export function colToLabel(col: number): string {
  let label = '';
  let c = col;
  do {
    label = String.fromCharCode(65 + (c % 26)) + label;
    c = Math.floor(c / 26) - 1;
  } while (c >= 0);
  return label;
}

/** Convert alpha label to 0-indexed column number ('A'=0, 'Z'=25, 'AA'=26) */
export function labelToCol(label: string): number {
  let col = 0;
  for (let i = 0; i < label.length; i++) {
    col = col * 26 + (label.charCodeAt(i) - 64);
  }
  return col - 1;
}

/** Convert grid position to human-readable label like "N15" */
export function positionToLabel(pos: GridPosition): string {
  return `${colToLabel(pos.col)}${pos.row + 1}`;
}

/** Parse a grid label like "N15" to a GridPosition */
export function labelToPosition(label: string): GridPosition {
  const match = label.match(/^([A-Z]+)(\d+)$/i);
  if (!match) throw new Error(`Invalid grid label: ${label}`);
  return {
    col: labelToCol(match[1].toUpperCase()),
    row: parseInt(match[2]) - 1,
  };
}

/** Euclidean distance between two grid positions */
export function gridDistance(a: GridPosition, b: GridPosition): number {
  return Math.sqrt((a.col - b.col) ** 2 + (a.row - b.row) ** 2);
}

/** Manhattan distance between two grid positions */
export function manhattanDistance(a: GridPosition, b: GridPosition): number {
  return Math.abs(a.col - b.col) + Math.abs(a.row - b.row);
}

/** Check if two grid positions are equal */
export function positionsEqual(a: GridPosition, b: GridPosition): boolean {
  return a.col === b.col && a.row === b.row;
}

// ============ Enums ============

export enum TerrainType {
  PLAINS = 'plains',
  FOREST = 'forest',
  MOUNTAIN = 'mountain',
  WATER = 'water',
  SWAMP = 'swamp',
}

export enum ResourceType {
  MINERALS = 'minerals',
  ENERGY = 'energy',
}

export enum UnitType {
  ENGINEER = 'engineer',
  SCOUT = 'scout',
  MESSENGER = 'messenger',
  SPY = 'spy',
  SOLDIER = 'soldier',
  SIEGE = 'siege',
  CAPTAIN = 'captain',
}

export enum BuildingType {
  BASE = 'base',
  BARRACKS = 'barracks',
  FACTORY = 'factory',
  WATCHTOWER = 'watchtower',
}

export enum AfflictionType {
  POISONED = 'poisoned',
  SLOWED = 'slowed',
  STUNNED = 'stunned',
  BLINDED = 'blinded',
}

export enum UnitBehaviorState {
  IDLE = 'idle',
  MOVING = 'moving',
  GATHERING = 'gathering',
  RETURNING = 'returning',
  ATTACKING = 'attacking',
  BUILDING = 'building',
  DEAD = 'dead',
}

export enum FogState {
  UNEXPLORED = 'unexplored',
  EXPLORED = 'explored',   // previously seen but no longer visible
  VISIBLE = 'visible',     // currently within a unit's vision
}

export enum GameEventType {
  // Engine lifecycle
  TICK = 'tick',
  GAME_START = 'game_start',
  GAME_PAUSE = 'game_pause',
  GAME_RESUME = 'game_resume',

  // Units
  UNIT_SPAWNED = 'unit_spawned',
  UNIT_DESTROYED = 'unit_destroyed',
  UNIT_MOVED = 'unit_moved',
  UNIT_ATTACKED = 'unit_attacked',
  UNIT_DAMAGED = 'unit_damaged',

  // Commands
  PLAYER_COMMAND = 'player_command',   // voice command from player
  UNIT_COMMAND = 'unit_command',       // command assigned to a unit

  // Communication
  UNIT_COMMUNICATION = 'unit_communication',  // unit-to-unit
  UNIT_REPORT = 'unit_report',                // unit reporting to player chat

  // Resources
  RESOURCE_GATHERED = 'resource_gathered',
  RESOURCE_DEPOSITED = 'resource_deposited',
  RESOURCE_DEPLETED = 'resource_depleted',

  // Buildings
  BUILDING_STARTED = 'building_started',
  BUILDING_COMPLETED = 'building_completed',
  BUILDING_DESTROYED = 'building_destroyed',
  PRODUCTION_STARTED = 'production_started',
  PRODUCTION_COMPLETED = 'production_completed',

  // Vision
  ENEMY_SPOTTED = 'enemy_spotted',
  AREA_EXPLORED = 'area_explored',

  // Proximity (wake system)
  RESOURCE_NEARBY = 'resource_nearby',
  ENEMY_NEARBY = 'enemy_nearby',

  // Selection / Input
  SELECTION_CHANGED = 'selection_changed',
  HOTKEY_ASSIGNED = 'hotkey_assigned',
}

// ============ Core Interfaces ============

export interface Affliction {
  type: AfflictionType;
  duration: number;  // ticks remaining
  severity: number;  // 0-1
}

export interface AuditLogEntry {
  tick: number;
  timestamp: number;
  message: string;
  source: string; // unit id or 'player'
  type: 'command' | 'observation' | 'communication' | 'action' | 'status';
}

export interface UnitStats {
  maxHealth: number;
  maxEnergy: number;
  attack: number;
  defense: number;
  moveSpeed: number;    // tiles per second
  visionRange: number;  // tiles (radius)
  attackRange: number;  // tiles
}

export interface UnitState {
  id: string;
  type: UnitType;
  playerId: string;
  position: GridPosition;
  health: number;
  energy: number;
  afflictions: Affliction[];
  currentCommand: string | null;
  auditLog: AuditLogEntry[];
  isSelected: boolean;
  path: GridPosition[] | null;
  targetPosition: GridPosition | null;
  autoReturn: boolean;
  homeBase: GridPosition | null;
  inSiegeMode: boolean;
  lastActionTick: number;

  // Behavior state machine
  behaviorState: UnitBehaviorState;

  // Gathering
  gatherTarget: GridPosition | null;
  carryingType: ResourceType | null;
  carryingAmount: number;
  gatherProgress: number;     // ticks spent gathering current tile

  // Combat
  attackTargetId: string | null;
  attackCooldown: number;     // ticks until next attack

  // AI
  lastThought: string | null;
}

export interface BuildingState {
  id: string;
  type: BuildingType;
  playerId: string;
  position: GridPosition;
  health: number;
  maxHealth: number;
  isConstructing: boolean;
  constructionProgress: number; // 0.0 - 1.0
  constructionTime: number;    // total ticks to build
  productionQueue: UnitType[];
  productionProgress: number;  // 0.0 - 1.0
  productionTime: number;      // ticks for current unit
  rallyPoint: GridPosition | null;
}

export interface MapTile {
  terrain: TerrainType;
  resource: ResourceType | null;
  resourceAmount: number;
  walkable: boolean;
  movementCost: number; // base multiplier for pathfinding
}

export interface Player {
  id: string;
  name: string;
  color: string;
  resources: Record<ResourceType, number>;
  basePosition: GridPosition;
}

// ============ Communication ============

export interface UnitMessage {
  id: string;
  fromUnitId: string;
  toUnitId: string | null; // null = broadcast to nearby units
  content: string;
  tick: number;
  position: GridPosition;
  type: 'command' | 'report' | 'communication';
}

// ============ Multiplayer-Ready Commands ============

export interface GameCommand {
  id: string;
  tick: number;       // scheduled execution tick
  playerId: string;
  type: 'move' | 'attack' | 'gather' | 'build' | 'produce' | 'voice' | 'stop' | 'custom';
  targetUnitIds: string[];
  payload: Record<string, unknown>;
}

// ============ AI / Agent Types ============

export interface UnitPerception {
  self: {
    id: string;
    type: UnitType;
    position: GridPosition;
    gridLabel: string;
    health: number;
    maxHealth: number;
    energy: number;
    maxEnergy: number;
    afflictions: Affliction[];
  };
  visibleUnits: {
    id: string;
    type: UnitType;
    relativePosition: { dx: number; dy: number };
    gridLabel: string;
    isFriendly: boolean;
    healthPercent: number;
  }[];
  visibleTerrain: {
    gridLabel: string;
    type: TerrainType;
    hasResource: boolean;
    resourceType?: ResourceType;
    walkable: boolean;
    relativePosition: { dx: number; dy: number };
  }[];
  recentAuditLog: AuditLogEntry[];
  currentCommand: string | null;
  nearbyMessages: UnitMessage[];
}

export interface UnitAction {
  type: 'move' | 'attack' | 'gather' | 'build' | 'communicate' | 'idle' | 'special';
  target?: GridPosition;
  targetUnitId?: string;
  message?: string;
  buildingType?: BuildingType;
  details?: string;
}

// ============ Strategic Commander ============

export enum DirectiveType {
  GATHER_RESOURCES = 'gather_resources',
  EXPLORE_AREA = 'explore_area',
  DEFEND_POSITION = 'defend_position',
  ATTACK_MOVE = 'attack_move',
  PATROL_AREA = 'patrol_area',
  BUILD_STRUCTURE = 'build_structure',
  RETREAT = 'retreat',
  ESCORT = 'escort',
  IDLE = 'idle',
}

export interface Directive {
  unitId: string;
  type: DirectiveType;
  targetPosition?: GridPosition;
  targetUnitId?: string;
  buildingType?: BuildingType;
  resourceType?: ResourceType;
  priority: number;       // 1-5
  reasoning?: string;
  createdAtTick: number;
  ttl: number;            // ticks until expiry (default 300)
  completed: boolean;
}

// ============ Config ============

export interface GameConfig {
  mapWidth: number;   // tiles
  mapHeight: number;  // tiles
  tickRate: number;   // simulation ticks per second
  tileSize: number;   // pixels per tile for rendering
}

export const DEFAULT_GAME_CONFIG: GameConfig = {
  mapWidth: 40,
  mapHeight: 40,
  tickRate: 10,
  tileSize: 32,
};

// ============ Unit Stats & Costs ============

export const UNIT_STATS: Record<UnitType, UnitStats> = {
  [UnitType.ENGINEER]:  { maxHealth: 50,  maxEnergy: 100, attack: 5,  defense: 5,  moveSpeed: 1.5, visionRange: 4, attackRange: 1 },
  [UnitType.SCOUT]:     { maxHealth: 40,  maxEnergy: 80,  attack: 10, defense: 3,  moveSpeed: 3.0, visionRange: 8, attackRange: 1 },
  [UnitType.MESSENGER]: { maxHealth: 30,  maxEnergy: 120, attack: 5,  defense: 2,  moveSpeed: 4.0, visionRange: 5, attackRange: 1 },
  [UnitType.SPY]:       { maxHealth: 35,  maxEnergy: 100, attack: 8,  defense: 3,  moveSpeed: 2.5, visionRange: 6, attackRange: 1 },
  [UnitType.SOLDIER]:   { maxHealth: 100, maxEnergy: 60,  attack: 25, defense: 15, moveSpeed: 2.0, visionRange: 5, attackRange: 1 },
  [UnitType.SIEGE]:     { maxHealth: 80,  maxEnergy: 80,  attack: 50, defense: 10, moveSpeed: 0.5, visionRange: 4, attackRange: 6 },
  [UnitType.CAPTAIN]:   { maxHealth: 80,  maxEnergy: 100, attack: 20, defense: 12, moveSpeed: 2.0, visionRange: 6, attackRange: 1 },
};

export const UNIT_COSTS: Record<UnitType, Record<ResourceType, number>> = {
  [UnitType.ENGINEER]:  { [ResourceType.MINERALS]: 50,  [ResourceType.ENERGY]: 0 },
  [UnitType.SCOUT]:     { [ResourceType.MINERALS]: 75,  [ResourceType.ENERGY]: 0 },
  [UnitType.MESSENGER]: { [ResourceType.MINERALS]: 60,  [ResourceType.ENERGY]: 0 },
  [UnitType.SPY]:       { [ResourceType.MINERALS]: 100, [ResourceType.ENERGY]: 50 },
  [UnitType.SOLDIER]:   { [ResourceType.MINERALS]: 100, [ResourceType.ENERGY]: 0 },
  [UnitType.SIEGE]:     { [ResourceType.MINERALS]: 200, [ResourceType.ENERGY]: 100 },
  [UnitType.CAPTAIN]:   { [ResourceType.MINERALS]: 150, [ResourceType.ENERGY]: 75 },
};

export const PRODUCTION_TIME: Record<UnitType, number> = {
  [UnitType.ENGINEER]:  15,
  [UnitType.SCOUT]:     10,
  [UnitType.MESSENGER]: 8,
  [UnitType.SPY]:       20,
  [UnitType.SOLDIER]:   12,
  [UnitType.SIEGE]:     25,
  [UnitType.CAPTAIN]:   20,
};

// ============ Building Stats & Costs ============

export const BUILDING_STATS: Record<BuildingType, { maxHealth: number; visionRange: number; constructionTime: number }> = {
  [BuildingType.BASE]:       { maxHealth: 500, visionRange: 8,  constructionTime: 0 },
  [BuildingType.BARRACKS]:   { maxHealth: 300, visionRange: 4,  constructionTime: 30 },
  [BuildingType.FACTORY]:    { maxHealth: 300, visionRange: 4,  constructionTime: 40 },
  [BuildingType.WATCHTOWER]: { maxHealth: 100, visionRange: 12, constructionTime: 20 },
};

export const BUILDING_COSTS: Record<BuildingType, Record<ResourceType, number>> = {
  [BuildingType.BASE]:       { [ResourceType.MINERALS]: 400, [ResourceType.ENERGY]: 200 },
  [BuildingType.BARRACKS]:   { [ResourceType.MINERALS]: 150, [ResourceType.ENERGY]: 0 },
  [BuildingType.FACTORY]:    { [ResourceType.MINERALS]: 200, [ResourceType.ENERGY]: 100 },
  [BuildingType.WATCHTOWER]: { [ResourceType.MINERALS]: 75,  [ResourceType.ENERGY]: 25 },
};

// Buildings that can produce each unit type
export const PRODUCTION_BUILDINGS: Record<UnitType, BuildingType> = {
  [UnitType.ENGINEER]:  BuildingType.BASE,
  [UnitType.SCOUT]:     BuildingType.BARRACKS,
  [UnitType.MESSENGER]: BuildingType.BARRACKS,
  [UnitType.SPY]:       BuildingType.BARRACKS,
  [UnitType.SOLDIER]:   BuildingType.BARRACKS,
  [UnitType.SIEGE]:     BuildingType.FACTORY,
  [UnitType.CAPTAIN]:   BuildingType.BARRACKS,
};

// ============ Terrain ============

export const TERRAIN_MOVEMENT_COST: Record<TerrainType, number> = {
  [TerrainType.PLAINS]:   1.0,
  [TerrainType.FOREST]:   1.5,
  [TerrainType.MOUNTAIN]: 3.0,
  [TerrainType.WATER]:    Infinity, // impassable
  [TerrainType.SWAMP]:    2.0,
};

/** Scouts move through rough terrain more easily */
export const SCOUT_TERRAIN_BONUS: Partial<Record<TerrainType, number>> = {
  [TerrainType.FOREST]:   0.6,  // multiplied against movement cost
  [TerrainType.MOUNTAIN]: 0.5,
  [TerrainType.SWAMP]:    0.5,
};

// ============ Rendering Colors ============

export const TERRAIN_COLORS: Record<TerrainType, string> = {
  [TerrainType.PLAINS]:   '#4a7c59',
  [TerrainType.FOREST]:   '#2d5a27',
  [TerrainType.MOUNTAIN]: '#8b7355',
  [TerrainType.WATER]:    '#1a5276',
  [TerrainType.SWAMP]:    '#4a6741',
};

export const UNIT_ICONS: Record<UnitType, string> = {
  [UnitType.ENGINEER]:  'E',
  [UnitType.SCOUT]:     'S',
  [UnitType.MESSENGER]: 'M',
  [UnitType.SPY]:       'Y',
  [UnitType.SOLDIER]:   'I',
  [UnitType.SIEGE]:     'G',
  [UnitType.CAPTAIN]:   'C',
};

export const PLAYER_COLORS = ['#3498db', '#e74c3c', '#2ecc71', '#f39c12'];

// ============ Communication Range ============

/** Max distance (tiles) units can communicate with each other */
export const UNIT_COMMUNICATION_RANGE = 6;

/** Range from base where player can issue voice commands */
export const BASE_COMMAND_RANGE = 10;

/** Ticks to gather one load of resources from a tile */
export const GATHER_TICKS = 15;

/** Amount of resources gathered per trip */
export const GATHER_AMOUNT = 10;

/** Max distance (tiles) from a resource tile to start gathering */
export const GATHER_RANGE = 1;

/** Ticks between attacks (base cooldown, modified by unit speed) */
export const ATTACK_COOLDOWN_TICKS = 10;
