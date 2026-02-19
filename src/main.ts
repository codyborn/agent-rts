// ============================================================
// Agent RTS - Main Entry Point
// ============================================================
// Wires together all subsystems: engine, map, units, rendering,
// player input, AI, and communication. Sets up the initial game
// state and starts the simulation + render loop.
// ============================================================

import {
  DEFAULT_GAME_CONFIG,
  GameEventType,
  UnitType,
  BuildingType,
  ResourceType,
  FogState,
  UNIT_STATS,
  UNIT_COSTS,
  BUILDING_STATS,
  BUILDING_COSTS,
  PRODUCTION_BUILDINGS,
  PLAYER_COLORS,
  positionToLabel,
  GridPosition,
  BuildingState,
  UnitBehaviorState,
  gridDistance,
} from './shared/types';
import { HEX_WIDTH, HEX_HEIGHT, HEX_VERT_SPACING, hexNeighbors } from './hex/HexUtils';
import { GameEngine, System } from './engine/GameEngine';
import { GameMap } from './map/GameMap';
import { FogOfWar } from './map/FogOfWar';
import { findPath } from './map/Pathfinding';
import { UnitManager } from './units/UnitManager';
import { ResourceManager } from './resources/ResourceManager';
import { Camera } from './rendering/Camera';
import { Renderer, RenderState } from './rendering/Renderer';
import { MinimapRenderer } from './rendering/MinimapRenderer';
import { UIRenderer } from './rendering/UIRenderer';
import { SpriteManager } from './rendering/SpriteManager';
import { TerrainTextureManager } from './rendering/TerrainTextureManager';
import { classifyInput } from './player/InputClassifier';
import { PlayerController } from './player/PlayerController';
import { AgentController } from './ai/AgentController';
import { Communication } from './ai/Communication';
import { StrategicCommander } from './ai/StrategicCommander';
import { DirectiveExecutor } from './ai/DirectiveExecutor';
import { AISystem } from './systems/AISystem';
import { ResourceSystem } from './systems/ResourceSystem';
import { CombatSystem } from './systems/CombatSystem';
import { BuildingSystem } from './systems/BuildingSystem';

// ============================================================
// Bootstrap
// ============================================================

const config = DEFAULT_GAME_CONFIG;
const LOCAL_PLAYER_ID = '0';

// ---- Core Engine ----
const engine = new GameEngine(config);
const { eventBus, state } = engine;

// ---- Map ----
const gameMap = new GameMap(config.mapWidth, config.mapHeight);
gameMap.generate(Date.now());
state.setMapTiles(gameMap.tiles);

// ---- Fog of War ----
const fogOfWar = new FogOfWar(config.mapWidth, config.mapHeight);
fogOfWar.initPlayer(LOCAL_PLAYER_ID);

// ---- Resources ----
const resourceManager = new ResourceManager(eventBus);
resourceManager.initPlayer(LOCAL_PLAYER_ID);

// ---- Player ----
const basePosition: GridPosition = { col: 2, row: 2 };

state.addPlayer({
  id: LOCAL_PLAYER_ID,
  name: 'Commander',
  color: PLAYER_COLORS[0],
  resources: resourceManager.getResources(LOCAL_PLAYER_ID),
  basePosition,
});

// ---- Buildings ----
const baseBuilding: BuildingState = {
  id: 'building_base_0',
  type: BuildingType.BASE,
  playerId: LOCAL_PLAYER_ID,
  position: basePosition,
  health: BUILDING_STATS[BuildingType.BASE].maxHealth,
  maxHealth: BUILDING_STATS[BuildingType.BASE].maxHealth,
  isConstructing: false,
  constructionProgress: 1,
  constructionTime: 0,
  productionQueue: [],
  productionProgress: 0,
  productionTime: 0,
  rallyPoint: { col: 4, row: 4 },
};
state.addBuilding(baseBuilding);

// ---- Units ----
const unitManager = new UnitManager(eventBus);

// Spawn 3 starting engineers near the base
const startingUnits = [
  unitManager.spawnUnit(UnitType.ENGINEER, LOCAL_PLAYER_ID, { col: 3, row: 2 }, basePosition),
  unitManager.spawnUnit(UnitType.ENGINEER, LOCAL_PLAYER_ID, { col: 2, row: 3 }, basePosition),
  unitManager.spawnUnit(UnitType.ENGINEER, LOCAL_PLAYER_ID, { col: 3, row: 3 }, basePosition),
];

// ---- Enemy Player ----
const ENEMY_PLAYER_ID = '1';
const enemyBasePosition: GridPosition = { col: config.mapWidth - 3, row: config.mapHeight - 3 };

resourceManager.initPlayer(ENEMY_PLAYER_ID);
fogOfWar.initPlayer(ENEMY_PLAYER_ID);

state.addPlayer({
  id: ENEMY_PLAYER_ID,
  name: 'Enemy AI',
  color: PLAYER_COLORS[1],
  resources: resourceManager.getResources(ENEMY_PLAYER_ID),
  basePosition: enemyBasePosition,
});

const enemyBase: BuildingState = {
  id: 'building_base_1',
  type: BuildingType.BASE,
  playerId: ENEMY_PLAYER_ID,
  position: enemyBasePosition,
  health: BUILDING_STATS[BuildingType.BASE].maxHealth,
  maxHealth: BUILDING_STATS[BuildingType.BASE].maxHealth,
  isConstructing: false,
  constructionProgress: 1,
  constructionTime: 0,
  productionQueue: [],
  productionProgress: 0,
  productionTime: 0,
  rallyPoint: { col: config.mapWidth - 5, row: config.mapHeight - 5 },
};
state.addBuilding(enemyBase);

// Enemy starting units
unitManager.spawnUnit(UnitType.ENGINEER, ENEMY_PLAYER_ID, { col: config.mapWidth - 4, row: config.mapHeight - 3 }, enemyBasePosition);
unitManager.spawnUnit(UnitType.ENGINEER, ENEMY_PLAYER_ID, { col: config.mapWidth - 3, row: config.mapHeight - 4 }, enemyBasePosition);
unitManager.spawnUnit(UnitType.ENGINEER, ENEMY_PLAYER_ID, { col: config.mapWidth - 4, row: config.mapHeight - 4 }, enemyBasePosition);
unitManager.spawnUnit(UnitType.SOLDIER, ENEMY_PLAYER_ID, { col: config.mapWidth - 5, row: config.mapHeight - 5 }, enemyBasePosition);
unitManager.spawnUnit(UnitType.SCOUT, ENEMY_PLAYER_ID, { col: config.mapWidth - 5, row: config.mapHeight - 3 }, enemyBasePosition);

// ---- AI ----
const agentController = new AgentController(eventBus, LOCAL_PLAYER_ID);
const communication = new Communication(eventBus);
const strategicCommander = new StrategicCommander(
  LOCAL_PLAYER_ID, eventBus, unitManager, gameMap, fogOfWar, resourceManager, state,
);
const directiveExecutor = new DirectiveExecutor(unitManager, gameMap, fogOfWar, LOCAL_PLAYER_ID, eventBus, state);

// ---- Canvas & Rendering ----
const gameCanvas = document.getElementById('game-canvas') as HTMLCanvasElement;
const minimapCanvas = document.getElementById('minimap-canvas') as HTMLCanvasElement;

// Size the game canvas to fill its flex-allocated space
function resizeCanvas() {
  const sidebar = document.getElementById('sidebar');
  const sidebarWidth = sidebar ? sidebar.offsetWidth : 0;
  gameCanvas.width = window.innerWidth - sidebarWidth;
  gameCanvas.height = window.innerHeight;
}
resizeCanvas();

const worldWidth = config.mapWidth * HEX_WIDTH + HEX_WIDTH;
const worldHeight = config.mapHeight * HEX_VERT_SPACING + HEX_VERT_SPACING + HEX_HEIGHT * 0.25;
const camera = new Camera(gameCanvas.width, gameCanvas.height, worldWidth, worldHeight);
camera.centerOn(basePosition, config.tileSize);

const spriteManager = new SpriteManager();
spriteManager.init();

const terrainTextures = new TerrainTextureManager();
terrainTextures.init();

const renderer = new Renderer(gameCanvas, camera, spriteManager, terrainTextures);
const minimapRenderer = new MinimapRenderer(minimapCanvas);
const uiRenderer = new UIRenderer();

// ---- Player Controller ----
const playerController = new PlayerController(gameCanvas, eventBus, LOCAL_PLAYER_ID);

// Wire up coordinate conversion for selection
playerController.setScreenToGrid((x: number, y: number) =>
  camera.screenToGrid(x, y, config.tileSize)
);
playerController.setGridToScreen((pos: GridPosition) =>
  camera.gridToScreen(pos, config.tileSize)
);

// ============================================================
// Event Wiring
// ============================================================

// ---- Helper: find building at grid position ----
/**
 * Find a valid build location near a starting position by spiral-searching outward.
 */
function findBuildLocation(origin: GridPosition, buildingType: BuildingType): GridPosition | null {
  const isSmall = buildingType === BuildingType.WATCHTOWER;
  const footprint = isSmall ? 1 : 2;

  // Spiral outward from origin, checking up to ~10 tile radius
  for (let radius = 2; radius <= 12; radius++) {
    for (let dr = -radius; dr <= radius; dr++) {
      for (let dc = -radius; dc <= radius; dc++) {
        if (Math.abs(dr) !== radius && Math.abs(dc) !== radius) continue; // ring only
        const row = origin.row + dr;
        const col = origin.col + dc;
        if (row < 0 || col < 0) continue;
        if (row + footprint > config.mapHeight || col + footprint > config.mapWidth) continue;

        let valid = true;
        for (let fr = 0; fr < footprint && valid; fr++) {
          for (let fc = 0; fc < footprint && valid; fc++) {
            const tile = gameMap.tiles[row + fr]?.[col + fc];
            if (!tile || !tile.walkable) valid = false;
          }
        }
        if (!valid) continue;

        // Check overlap with existing buildings
        for (const building of state.getAllBuildings()) {
          const bFoot = building.type === BuildingType.WATCHTOWER ? 1 : 2;
          for (let fr = 0; fr < footprint && valid; fr++) {
            for (let fc = 0; fc < footprint && valid; fc++) {
              for (let br = 0; br < bFoot; br++) {
                for (let bc = 0; bc < bFoot; bc++) {
                  if (
                    row + fr === building.position.row + br &&
                    col + fc === building.position.col + bc
                  ) {
                    valid = false;
                  }
                }
              }
            }
          }
        }
        if (valid) return { row, col };
      }
    }
  }
  return null;
}

/**
 * Find a walkable tile adjacent to a building position (hex neighbors).
 */
function findAdjacentWalkable(buildPos: GridPosition, _footprint: number): GridPosition {
  for (const neighbor of hexNeighbors(buildPos)) {
    const tile = gameMap.tiles[neighbor.row]?.[neighbor.col];
    if (tile && tile.walkable) return neighbor;
  }
  return buildPos;
}

function findBuildingAtPosition(gridPos: GridPosition): BuildingState | null {
  for (const building of state.getAllBuildings()) {
    const footprint = building.type === BuildingType.WATCHTOWER ? 1 : 2;
    for (let dr = 0; dr < footprint; dr++) {
      for (let dc = 0; dc < footprint; dc++) {
        if (
          building.position.row + dr === gridPos.row &&
          building.position.col + dc === gridPos.col
        ) {
          return building;
        }
      }
    }
  }
  return null;
}

// Handle selection resolution on mouseup (left-click only)
gameCanvas.addEventListener('mouseup', (e) => {
  // Ignore right-clicks — handled by contextmenu listener
  if (e.button !== 0) return;

  // If in build placement mode, handle placement on left click
  if (playerController.buildPlacementMode && e.button === 0) {
    const rect = gameCanvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const gridPos = camera.screenToGrid(sx, sy, config.tileSize);
    const buildType = playerController.buildPlacementMode.buildingType;
    const isSmall = buildType === BuildingType.WATCHTOWER;
    const footprint = isSmall ? 1 : 2;

    // Validate placement
    let valid = true;
    for (let dr = 0; dr < footprint && valid; dr++) {
      for (let dc = 0; dc < footprint && valid; dc++) {
        const r = gridPos.row + dr;
        const c = gridPos.col + dc;
        const tile = gameMap.tiles[r]?.[c];
        if (!tile || !tile.walkable) valid = false;
      }
    }
    // Check overlap
    if (valid) {
      for (const building of state.getAllBuildings()) {
        const bFoot = building.type === BuildingType.WATCHTOWER ? 1 : 2;
        for (let dr = 0; dr < footprint && valid; dr++) {
          for (let dc = 0; dc < footprint && valid; dc++) {
            for (let br = 0; br < bFoot; br++) {
              for (let bc = 0; bc < bFoot; bc++) {
                if (
                  gridPos.row + dr === building.position.row + br &&
                  gridPos.col + dc === building.position.col + bc
                ) {
                  valid = false;
                }
              }
            }
          }
        }
      }
    }

    if (valid && resourceManager.canAfford(LOCAL_PLAYER_ID, BUILDING_COSTS[buildType])) {
      resourceManager.spend(LOCAL_PLAYER_ID, BUILDING_COSTS[buildType]);

      const buildingId = `building_${buildType}_${Date.now()}`;
      const newBuilding: BuildingState = {
        id: buildingId,
        type: buildType,
        playerId: LOCAL_PLAYER_ID,
        position: { col: gridPos.col, row: gridPos.row },
        health: BUILDING_STATS[buildType].maxHealth,
        maxHealth: BUILDING_STATS[buildType].maxHealth,
        isConstructing: true,
        constructionProgress: 0,
        constructionTime: BUILDING_STATS[buildType].constructionTime,
        productionQueue: [],
        productionProgress: 0,
        productionTime: 0,
        rallyPoint: { col: gridPos.col + footprint, row: gridPos.row + footprint },
      };
      state.addBuilding(newBuilding);

      // Pathfind nearest engineer to the building site
      const engineers = playerController.buildPlacementMode.engineerIds
        .map((id) => unitManager.getUnit(id))
        .filter((u) => u && u.type === UnitType.ENGINEER);

      if (engineers.length > 0) {
        const engineer = engineers[0]!;
        const adjPos = findAdjacentWalkable(gridPos, footprint);
        const path = findPath(engineer.position, adjPos, gameMap, engineer.type);
        if (path.length > 0) {
          engineer.setPath(path);
          engineer.moveTo(adjPos);
          engineer.behaviorState = UnitBehaviorState.MOVING;
          (engineer as any)._buildTargetId = buildingId;
        } else {
          engineer.behaviorState = UnitBehaviorState.BUILDING;
        }
      }

      playerController.cancelBuildMode();
      uiRenderer.hideBuildMenu();
    }
    return;
  }

  const allUnitStates = Array.from(unitManager.getUnitStates().values());
  const selectedIds = playerController.selection.resolveSelection(
    allUnitStates,
    (x, y) => camera.screenToGrid(x, y, config.tileSize),
    (pos) => camera.gridToScreen(pos, config.tileSize),
    LOCAL_PLAYER_ID,
    config.tileSize * camera.zoom,
  );

  if (selectedIds.length > 0) {
    playerController.selectedBuildingId = null;
    if (playerController.selection.isShiftHeld) {
      const current = new Set(playerController.getSelectedUnitIds());
      for (const id of selectedIds) current.add(id);
      unitManager.selectUnits([...current]);
    } else {
      unitManager.selectUnits(selectedIds);
    }
  } else if (!playerController.selection.isShiftHeld) {
    // Check if clicking on a building
    const rect = gameCanvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const gridPos = camera.screenToGrid(sx, sy, config.tileSize);
    const building = findBuildingAtPosition(gridPos);

    if (building && building.playerId === LOCAL_PLAYER_ID) {
      playerController.setSelectedBuildingId(building.id);
      unitManager.deselectAll(LOCAL_PLAYER_ID);
      uiRenderer.showCommandBar();
    } else {
      playerController.selectedBuildingId = null;
      unitManager.deselectAll(LOCAL_PLAYER_ID);
    }
  }
});

// Right-click to move selected units
gameCanvas.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  const rect = gameCanvas.getBoundingClientRect();
  const screenX = e.clientX - rect.left;
  const screenY = e.clientY - rect.top;
  const targetPos = camera.screenToGrid(screenX, screenY, config.tileSize);

  const selected = unitManager.getSelectedUnits(LOCAL_PLAYER_ID);
  for (const unit of selected) {
    const path = findPath(unit.position, targetPos, gameMap, unit.type);
    if (path.length > 0) {
      unit.setPath(path);
      unit.moveTo(targetPos);
      // Reset any AI behavior — player is taking direct control
      unit.behaviorState = UnitBehaviorState.MOVING;
      unit.gatherTarget = null;
      unit.gatherProgress = 0;
      unit.attackTargetId = null;
      unit.autoReturn = true;
      unit.addAuditLog(`Moving to ${positionToLabel(targetPos)}`, unit.id, 'action');
    }
  }
});

// Camera panning with arrow keys and WASD
const keysHeld = new Set<string>();
window.addEventListener('keydown', (e) => keysHeld.add(e.key.toLowerCase()));
window.addEventListener('keyup', (e) => keysHeld.delete(e.key.toLowerCase()));

// Edge panning with mouse + grid tooltip + hovered hex tracking
let mouseX = 0;
let mouseY = 0;
let hoveredHex: GridPosition | null = null;
const gridTooltip = document.getElementById('grid-tooltip')!;
gameCanvas.addEventListener('mousemove', (e) => {
  const rect = gameCanvas.getBoundingClientRect();
  mouseX = e.clientX - rect.left;
  mouseY = e.clientY - rect.top;

  const gridPos = camera.screenToGrid(mouseX, mouseY, config.tileSize);
  if (gridPos.col >= 0 && gridPos.col < config.mapWidth && gridPos.row >= 0 && gridPos.row < config.mapHeight) {
    hoveredHex = gridPos;
    gridTooltip.textContent = positionToLabel(gridPos);
    gridTooltip.style.left = `${e.clientX + 12}px`;
    gridTooltip.style.top = `${e.clientY + 12}px`;
    gridTooltip.style.display = 'block';
  } else {
    hoveredHex = null;
    gridTooltip.style.display = 'none';
  }
});
gameCanvas.addEventListener('mouseleave', () => {
  hoveredHex = null;
  gridTooltip.style.display = 'none';
});

// Minimap click to pan camera
minimapCanvas.addEventListener('click', (e) => {
  const rect = minimapCanvas.getBoundingClientRect();
  const pos = minimapRenderer.handleClick(
    e.clientX - rect.left,
    e.clientY - rect.top,
    config,
  );
  camera.centerOn(pos, config.tileSize);
});

// Chat message click to jump to unit
uiRenderer.onChatMessageClick((unitId) => {
  const unit = unitManager.getUnit(unitId);
  if (unit) {
    camera.centerOn(unit.position, config.tileSize);
    unitManager.selectUnits([unitId]);
  }
});

// ---- Unit training from building panel ----
uiRenderer.onTrainUnit((buildingId, unitType) => {
  const building = state.getBuilding(buildingId);
  if (!building || building.isConstructing) return;
  if (!resourceManager.canAfford(LOCAL_PLAYER_ID, UNIT_COSTS[unitType])) return;
  resourceManager.spend(LOCAL_PLAYER_ID, UNIT_COSTS[unitType]);
  building.productionQueue.push(unitType);
});

// ---- Build menu handling (B key emits event) ----
// Unit command buttons from sidebar panel
uiRenderer.onUnitCommand((unitIds, command) => {
  for (const uid of unitIds) {
    const unit = unitManager.getUnit(uid);
    if (!unit || !unit.isAlive()) continue;

    switch (command) {
      case 'stop':
        unit.path = null;
        unit.behaviorState = UnitBehaviorState.IDLE;
        unit.currentCommand = null;
        unit.autoReturn = false;
        break;
      case 'gather':
        // Set the unit to gather mode — AI will find nearest resource
        unit.setCommand('gather nearby resources');
        eventBus.emit(GameEventType.UNIT_COMMAND, {
          id: `cmd_panel_${Date.now()}`, tick: 0, playerId: LOCAL_PLAYER_ID,
          type: 'voice', targetUnitIds: [uid], payload: { transcript: 'gather nearby resources' },
        });
        break;
      case 'build':
        // Trigger build menu for this engineer
        eventBus.emit(GameEventType.BUILDING_PLACE_REQUESTED, { engineerIds: [uid] });
        break;
      case 'explore':
        unit.setCommand('explore the map');
        eventBus.emit(GameEventType.UNIT_COMMAND, {
          id: `cmd_panel_${Date.now()}`, tick: 0, playerId: LOCAL_PLAYER_ID,
          type: 'voice', targetUnitIds: [uid], payload: { transcript: 'explore the map' },
        });
        break;
      case 'attack_move':
        unit.setCommand('attack nearest enemy');
        eventBus.emit(GameEventType.UNIT_COMMAND, {
          id: `cmd_panel_${Date.now()}`, tick: 0, playerId: LOCAL_PLAYER_ID,
          type: 'voice', targetUnitIds: [uid], payload: { transcript: 'attack nearest enemy' },
        });
        break;
      case 'defend':
        unit.setCommand('defend this position');
        eventBus.emit(GameEventType.UNIT_COMMAND, {
          id: `cmd_panel_${Date.now()}`, tick: 0, playerId: LOCAL_PLAYER_ID,
          type: 'voice', targetUnitIds: [uid], payload: { transcript: 'defend this position' },
        });
        break;
      case 'patrol':
        unit.setCommand('patrol the area');
        eventBus.emit(GameEventType.UNIT_COMMAND, {
          id: `cmd_panel_${Date.now()}`, tick: 0, playerId: LOCAL_PLAYER_ID,
          type: 'voice', targetUnitIds: [uid], payload: { transcript: 'patrol the area' },
        });
        break;
      case 'siege_mode':
        unit.setCommand('enter siege mode');
        eventBus.emit(GameEventType.UNIT_COMMAND, {
          id: `cmd_panel_${Date.now()}`, tick: 0, playerId: LOCAL_PLAYER_ID,
          type: 'voice', targetUnitIds: [uid], payload: { transcript: 'enter siege mode' },
        });
        break;
    }
  }
});

eventBus.on(GameEventType.BUILDING_PLACE_REQUESTED, (data: any) => {
  const engineerIds = data.engineerIds as string[];
  // Check if any selected units are actually engineers
  const hasEngineers = engineerIds.some((id) => {
    const unit = unitManager.getUnit(id);
    return unit && unit.type === UnitType.ENGINEER;
  });
  if (hasEngineers) {
    uiRenderer.showBuildMenu();
  }
});

uiRenderer.onBuildMenuSelect((buildingType) => {
  const engineers = playerController.getSelectedUnitIds()
    .map((id) => unitManager.getUnit(id))
    .filter((u) => u && u.type === UnitType.ENGINEER) as import('./units/Unit').Unit[];
  if (engineers.length === 0) return;

  if (!resourceManager.canAfford(LOCAL_PLAYER_ID, BUILDING_COSTS[buildingType])) return;

  // Auto-find a suitable build location near the engineer
  const engineer = engineers[0];
  const buildPos = findBuildLocation(engineer.position, buildingType);
  if (!buildPos) return;

  const isSmall = buildingType === BuildingType.WATCHTOWER;
  const footprint = isSmall ? 1 : 2;

  resourceManager.spend(LOCAL_PLAYER_ID, BUILDING_COSTS[buildingType]);

  const buildingId = `building_${buildingType}_${Date.now()}`;
  const newBuilding: BuildingState = {
    id: buildingId,
    type: buildingType,
    playerId: LOCAL_PLAYER_ID,
    position: { col: buildPos.col, row: buildPos.row },
    health: BUILDING_STATS[buildingType].maxHealth,
    maxHealth: BUILDING_STATS[buildingType].maxHealth,
    isConstructing: true,
    constructionProgress: 0,
    constructionTime: BUILDING_STATS[buildingType].constructionTime,
    productionQueue: [],
    productionProgress: 0,
    productionTime: 0,
    rallyPoint: { col: buildPos.col + footprint, row: buildPos.row + footprint },
  };
  state.addBuilding(newBuilding);

  // Send engineer to build site — stay MOVING until arrival
  const adjPos = findAdjacentWalkable(buildPos, footprint);
  const path = findPath(engineer.position, adjPos, gameMap, engineer.type);
  if (path.length > 0) {
    engineer.setPath(path);
    engineer.moveTo(adjPos);
    engineer.behaviorState = UnitBehaviorState.MOVING;
    // Store target building so we can transition to BUILDING on arrival
    (engineer as any)._buildTargetId = buildingId;
  } else {
    // Already adjacent — start building immediately
    engineer.behaviorState = UnitBehaviorState.BUILDING;
  }

  uiRenderer.addChatMessage({
    unitId: engineer.id,
    unitType: engineer.type,
    content: `Building ${buildingType} at ${positionToLabel(buildPos)}`,
    type: 'action',
    gridLabel: positionToLabel(engineer.position),
  });

  uiRenderer.hideBuildMenu();
});

// When a building finishes, return nearby BUILDING-state engineers to IDLE
eventBus.on(GameEventType.BUILDING_COMPLETED, (data: any) => {
  const buildingId = data.buildingId as string;
  const building = state.getBuilding(buildingId);
  if (!building) return;
  const footprint = building.type === BuildingType.WATCHTOWER ? 1 : 2;
  for (const unit of unitManager.getUnitsForPlayer(building.playerId)) {
    if (unit.type !== UnitType.ENGINEER || unit.behaviorState !== UnitBehaviorState.BUILDING) continue;
    // Check adjacency
    const dr = unit.position.row - building.position.row;
    const dc = unit.position.col - building.position.col;
    if (dr >= -1 && dr <= footprint && dc >= -1 && dc <= footprint) {
      unit.behaviorState = UnitBehaviorState.IDLE;
    }
  }
});

// Command bar: show when units are selected, hide when deselected
eventBus.on(GameEventType.SELECTION_CHANGED, (data: any) => {
  const ids = data.unitIds as string[];
  if (ids.length > 0) {
    uiRenderer.showCommandBar();
  } else {
    // Sync unitManager selection when Escape or other deselect clears selection.
    // Clear isSelected directly to avoid re-emitting SELECTION_CHANGED.
    for (const unit of unitManager.getAllUnits()) {
      if (unit.playerId === LOCAL_PLAYER_ID) {
        unit.isSelected = false;
      }
    }
    uiRenderer.hideCommandBar();
    if (playerController.voice.isListening) {
      playerController.voice.stopListening();
      uiRenderer.setMicRecording(false);
    }
  }
});

// Command bar text submit (Enter key) -> issue command to selected units
uiRenderer.onCommandSubmit((text) => {
  playerController.processVoiceCommand(text);
});

// Mic button click -> toggle Web Speech API recording
uiRenderer.onMicButtonClick(() => {
  playerController.voice.toggleListening();
  uiRenderer.setMicRecording(playerController.voice.isListening);
});

// Reset mic button after speech is captured
eventBus.on(GameEventType.PLAYER_COMMAND, () => {
  uiRenderer.setMicRecording(false);
});

// ---- Unit Q&A handler ----
async function handleUnitQuestion(question: string, targetUnits: any[]): Promise<void> {
  for (const unit of targetUnits) {
    uiRenderer.addChatMessage({
      unitId: unit.id,
      unitType: unit.type,
      content: `Commander asks: "${question}"`,
      type: 'command',
      gridLabel: unit.getGridLabel(),
    });

    // Build lightweight perception
    const perception = [
      `Position: ${positionToLabel(unit.position)}`,
      `Health: ${unit.health}/${unit.getStats().maxHealth}`,
      `Behavior: ${unit.behaviorState}`,
      unit.currentCommand ? `Current order: ${unit.currentCommand}` : 'No standing orders',
    ].join('\n');

    try {
      const res = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          perception,
          unitType: unit.type,
          question,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        uiRenderer.addChatMessage({
          unitId: unit.id,
          unitType: unit.type,
          content: data.answer || 'Unable to respond at this time, Commander.',
          type: 'communication',
          gridLabel: unit.getGridLabel(),
        });
      } else {
        uiRenderer.addChatMessage({
          unitId: unit.id,
          unitType: unit.type,
          content: 'Unable to respond at this time, Commander.',
          type: 'communication',
          gridLabel: unit.getGridLabel(),
        });
      }
    } catch {
      uiRenderer.addChatMessage({
        unitId: unit.id,
        unitType: unit.type,
        content: 'Unable to respond at this time, Commander.',
        type: 'communication',
        gridLabel: unit.getGridLabel(),
      });
    }
  }
}

/**
 * Parse a building production command like "build 5 soldiers and 1 messenger".
 * Returns an array of { unitType, count } entries, or null if unparseable.
 */
function parseBuildingCommand(
  text: string,
  building: BuildingState,
): { unitType: UnitType; count: number }[] | null {
  const producible = new Set<UnitType>();
  for (const [ut, bt] of Object.entries(PRODUCTION_BUILDINGS)) {
    if (bt === building.type) producible.add(ut as UnitType);
  }
  if (producible.size === 0) return null;

  const results: { unitType: UnitType; count: number }[] = [];
  const lower = text.toLowerCase();

  // Match patterns like "5 soldiers", "1 messenger", "a scout", "soldiers"
  const pattern = /(\d+|an?)\s+(engineer|scout|messenger|spy|soldier|siege|captain)s?/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(lower)) !== null) {
    const countStr = match[1];
    const count = countStr === 'a' || countStr === 'an' ? 1 : parseInt(countStr, 10);
    const typeName = match[2] as UnitType;
    if (producible.has(typeName) && count > 0 && count <= 20) {
      results.push({ unitType: typeName, count });
    }
  }

  // If no pattern matched but text mentions a producible unit type, build 1
  if (results.length === 0) {
    for (const ut of producible) {
      if (lower.includes(ut)) {
        results.push({ unitType: ut, count: 1 });
      }
    }
  }

  return results.length > 0 ? results : null;
}

// Voice/text command handling
eventBus.on(GameEventType.UNIT_COMMAND, (data: any) => {
  if (data.type === 'voice' && data.payload?.transcript) {
    const transcript = data.payload.transcript as string;
    const targetUnits = data.targetUnitIds
      .map((id: string) => unitManager.getUnit(id))
      .filter(Boolean);

    // If a building is selected and no units targeted, route to building
    if (targetUnits.length === 0 && playerController.selectedBuildingId) {
      const building = state.getBuilding(playerController.selectedBuildingId);
      if (building && !building.isConstructing) {
        const orders = parseBuildingCommand(transcript, building);
        if (orders) {
          let queued = 0;
          for (const order of orders) {
            for (let i = 0; i < order.count; i++) {
              const cost = UNIT_COSTS[order.unitType];
              if (resourceManager.canAfford(LOCAL_PLAYER_ID, cost)) {
                resourceManager.spend(LOCAL_PLAYER_ID, cost);
                building.productionQueue.push(order.unitType);
                queued++;
              }
            }
          }
          const summary = orders.map((o) => `${o.count} ${o.unitType}${o.count > 1 ? 's' : ''}`).join(', ');
          uiRenderer.addChatMessage({
            unitId: building.id,
            unitType: UnitType.ENGINEER,
            content: queued > 0 ? `Queued: ${summary}` : `Can't afford: ${summary}`,
            type: queued > 0 ? 'action' : 'status',
            gridLabel: positionToLabel(building.position),
          });
        }
      }
      return;
    }

    if (targetUnits.length === 0) {
      console.warn('[Command] No selected units to command');
      return;
    }

    // Classify input as command or question
    const intent = classifyInput(transcript);

    if (intent === 'question') {
      handleUnitQuestion(transcript, targetUnits);
      return;
    }

    // Set command directly on all targeted units (bypass base range limit)
    // Note: autoReturn is NOT set here — voice commands are managed by the
    // directive system which handles lifecycle. autoReturn is only for
    // simple right-click moves that bypass the commander entirely.
    for (const unit of targetUnits) {
      (unit as any).setCommand(transcript);
      (unit as any).autoReturn = false;
      uiRenderer.addChatMessage({
        unitId: (unit as any).id,
        unitType: (unit as any).type,
        content: `Received: "${transcript}"`,
        type: 'command',
        gridLabel: (unit as any).getGridLabel(),
      });
    }

    // Also deliver via communication for the messaging system
    const commandableUnits = targetUnits.map((u: any) => ({
      id: u.id,
      position: u.position,
      playerId: u.playerId,
      homeBase: u.homeBase,
    }));

    communication.sendPlayerCommand(
      LOCAL_PLAYER_ID,
      transcript,
      commandableUnits,
      engine.getCurrentTick(),
    );

    console.log(`[Command] "${transcript}" sent to ${targetUnits.length} unit(s)`);
  }
});

// Unit communication -> chat log
eventBus.on(GameEventType.UNIT_COMMUNICATION, (msg: any) => {
  const fromUnit = unitManager.getUnit(msg.fromUnitId);
  if (fromUnit && fromUnit.playerId === LOCAL_PLAYER_ID) {
    uiRenderer.addChatMessage({
      unitId: fromUnit.id,
      unitType: fromUnit.type,
      content: msg.content,
      type: 'communication',
      gridLabel: fromUnit.getGridLabel(),
    });
  }
});

// Window resize
window.addEventListener('resize', () => {
  resizeCanvas();
  camera.resize(gameCanvas.width, gameCanvas.height);
  renderer.handleResize();
});

// ============================================================
// Game Systems Registration
// ============================================================

// Movement + Fog system (always needed)
const movementFogSystem: System = {
  init() {},
  update(tick: number, _dt: number) {
    // ---- Unit movement ----
    for (const unit of unitManager.getAllUnits()) {
      if (!unit.isAlive()) continue;

      const stats = unit.getStats();
      const movesPerTick = stats.moveSpeed / config.tickRate;

      if (unit.path && unit.path.length > 0) {
        if (movesPerTick >= 0.1 && tick % Math.max(1, Math.round(1 / movesPerTick)) === 0) {
          unit.advanceOnPath();

          // If unit finished its path and was MOVING
          if (!unit.path && unit.behaviorState === UnitBehaviorState.MOVING) {
            // Check if this engineer was heading to a build site
            const buildTargetId = (unit as any)._buildTargetId as string | undefined;
            if (buildTargetId && unit.type === UnitType.ENGINEER) {
              unit.behaviorState = UnitBehaviorState.BUILDING;
              delete (unit as any)._buildTargetId;
            } else {
              unit.behaviorState = UnitBehaviorState.IDLE;

              // Return-to-base after command completion
              // Only trigger when there is no active directive (i.e. right-click move).
              // Voice-commanded units with directives let the DirectiveExecutor
              // manage the full objective lifecycle before returning.
              if (unit.autoReturn && unit.playerId === LOCAL_PLAYER_ID && unit.homeBase) {
                const directive = strategicCommander.getDirective(unit.id);
                const hasActiveDirective = directive && !directive.completed;
                if (!hasActiveDirective) {
                  const dist = gridDistance(unit.position, unit.homeBase);
                  if (dist > 1) {
                    unit.behaviorState = UnitBehaviorState.RETURNING;
                    const returnPath = findPath(unit.position, unit.homeBase, gameMap, unit.type);
                    if (returnPath.length > 0) unit.setPath(returnPath);
                  }
                  unit.autoReturn = false;
                }
              }
            }
          }
        }
      }
    }

    // ---- Fog of War (local player only) ----
    const visionSources: Array<{ position: GridPosition; range: number }> = [];

    for (const unit of unitManager.getUnitsForPlayer(LOCAL_PLAYER_ID)) {
      visionSources.push({
        position: unit.position,
        range: unit.getStats().visionRange,
      });
    }

    for (const building of state.getAllBuildings()) {
      if (building.playerId === LOCAL_PLAYER_ID) {
        const bStats = BUILDING_STATS[building.type];
        visionSources.push({
          position: building.position,
          range: bStats.visionRange,
        });
      }
    }

    fogOfWar.updateVision(LOCAL_PLAYER_ID, visionSources);
  },
};

// Register systems in order: movement first, then AI, then resources/combat/buildings
engine.registerSystem('movementFog', movementFogSystem);
engine.registerSystem('ai', new AISystem(unitManager, gameMap, agentController, communication, strategicCommander, directiveExecutor, LOCAL_PLAYER_ID));
engine.registerSystem('resources', new ResourceSystem(unitManager, gameMap, resourceManager, LOCAL_PLAYER_ID));
engine.registerSystem('combat', new CombatSystem(unitManager, gameMap, LOCAL_PLAYER_ID, state));
engine.registerSystem('buildings', new BuildingSystem(unitManager, resourceManager, state));

// Win/Loss condition check
let gameOver = false;
const winLossSystem: System = {
  init() {},
  update(tick: number) {
    if (gameOver || tick < 10) return;
    // Check every 10 ticks to avoid overhead
    if (tick % 10 !== 0) return;

    const playerBase = state.getBuildingsForPlayer(LOCAL_PLAYER_ID).find(b => b.type === BuildingType.BASE);
    const enemyBase = state.getBuildingsForPlayer(ENEMY_PLAYER_ID).find(b => b.type === BuildingType.BASE);

    if (!enemyBase || enemyBase.health <= 0) {
      gameOver = true;
      uiRenderer.addChatMessage({ unitId: '', unitType: UnitType.ENGINEER, content: 'VICTORY! Enemy base destroyed!', type: 'status', gridLabel: '' });
      engine.pause();
    } else if (!playerBase || playerBase.health <= 0) {
      gameOver = true;
      uiRenderer.addChatMessage({ unitId: '', unitType: UnitType.ENGINEER, content: 'DEFEAT! Our base has been destroyed!', type: 'status', gridLabel: '' });
      engine.pause();
    }
  },
};
engine.registerSystem('winLoss', winLossSystem);

// ============================================================
// Render Loop (runs every frame via engine.onFrame)
// ============================================================

/** Tracks which unit pairs are currently sharing vision (to avoid spamming chat). */
const activeSharingPairs = new Set<string>();
/** Permanent set: pairs that have already shown "Sharing map intel" chat message. */
const sharedChatPairs = new Set<string>();
/** Cap the total number of "Sharing map intel" messages shown to avoid chat spam. */
const MAX_SHARING_CHAT_MESSAGES = 3;
let sharingChatCount = 0;

engine.onFrame = () => {
  // ---- Camera panning ----
  const panSpeed = 5;
  const edgeThreshold = 30;

  if (keysHeld.has('arrowleft') || keysHeld.has('a')) camera.pan(-panSpeed, 0);
  if (keysHeld.has('arrowright') || keysHeld.has('d')) camera.pan(panSpeed, 0);
  if (keysHeld.has('arrowup') || keysHeld.has('w')) camera.pan(0, -panSpeed);
  if (keysHeld.has('arrowdown')) camera.pan(0, panSpeed);

  // Edge panning
  if (mouseX < edgeThreshold) camera.pan(-panSpeed, 0);
  if (mouseX > gameCanvas.width - edgeThreshold) camera.pan(panSpeed, 0);
  if (mouseY < edgeThreshold + 30) camera.pan(0, -panSpeed); // +30 for resource bar
  if (mouseY > gameCanvas.height - edgeThreshold) camera.pan(0, panSpeed);

  // ---- Build render state ----
  const unitStates = unitManager.getUnitStates();
  const buildings = new Map<string, BuildingState>();
  for (const b of state.getAllBuildings()) {
    buildings.set(b.id, b);
  }

  const fogGrid = fogOfWar.getFogGrid(LOCAL_PLAYER_ID) || [];
  const selectedIds = new Set(
    unitManager.getSelectedUnits(LOCAL_PLAYER_ID).map((u) => u.id)
  );

  // ---- Build placement ghost ----
  let buildPlacementMode: RenderState['buildPlacementMode'] = null;
  if (playerController.buildPlacementMode) {
    const gridPos = camera.screenToGrid(mouseX, mouseY, config.tileSize);
    buildPlacementMode = {
      buildingType: playerController.buildPlacementMode.buildingType,
      mouseGridPos: gridPos,
    };
  }

  // ---- Heat map data ----
  // Compute merged vision history from selected units (minimap always shows when units selected)
  let minimapHeatMapData: Map<string, number> | null = null;
  if (selectedIds.size > 0) {
    minimapHeatMapData = new Map();
    for (const uid of selectedIds) {
      const unit = unitManager.getUnit(uid);
      if (unit) {
        for (const [key, tick] of unit.visionHistory) {
          const existing = minimapHeatMapData.get(key);
          if (existing === undefined || tick > existing) {
            minimapHeatMapData.set(key, tick);
          }
        }
      }
    }
  }
  // Main canvas heat map only shows when toggled with H key
  const heatMapData = playerController.heatMapEnabled ? minimapHeatMapData : null;

  // ---- Vision history tracking ----
  const currentTick = engine.getCurrentTick();
  const localUnits = unitManager.getUnitsForPlayer(LOCAL_PLAYER_ID);
  for (const unit of localUnits) {
    const vRange = unit.getStats().visionRange;
    const vRangeSq = vRange * vRange;
    const minRow = Math.max(0, unit.position.row - vRange);
    const maxRow = Math.min(config.mapHeight - 1, unit.position.row + vRange);
    const minCol = Math.max(0, unit.position.col - vRange);
    const maxCol = Math.min(config.mapWidth - 1, unit.position.col + vRange);
    for (let r = minRow; r <= maxRow; r++) {
      for (let c = minCol; c <= maxCol; c++) {
        const dr = r - unit.position.row;
        const dc = c - unit.position.col;
        if (dr * dr + dc * dc <= vRangeSq) {
          unit.visionHistory.set(`${c},${r}`, currentTick);
        }
      }
    }
  }

  // ---- Idle proximity vision sharing ----
  // When two idle units are within 2 tiles of each other, they share map history.
  const SHARE_RANGE_SQ = 2 * 2;
  const sharingUnitIds = new Set<string>();
  const currentPairs = new Set<string>();
  const idleUnits = localUnits.filter(
    (u) => u.isAlive() && u.behaviorState === UnitBehaviorState.IDLE,
  );
  for (let i = 0; i < idleUnits.length; i++) {
    for (let j = i + 1; j < idleUnits.length; j++) {
      const a = idleUnits[i];
      const b = idleUnits[j];
      const dr = a.position.row - b.position.row;
      const dc = a.position.col - b.position.col;
      if (dr * dr + dc * dc <= SHARE_RANGE_SQ) {
        // Always track proximity so the pair isn't evicted from
        // activeSharingPairs while units remain idle and close.
        const pairKey = a.id < b.id ? `${a.id}:${b.id}` : `${b.id}:${a.id}`;
        currentPairs.add(pairKey);

        // Show speech bubbles for all pairs that have ever shared in this
        // proximity session (stable — no flickering).
        if (activeSharingPairs.has(pairKey)) {
          sharingUnitIds.add(a.id);
          sharingUnitIds.add(b.id);
        }

        // Check if the two units actually have divergent map knowledge
        let hasDivergence = false;
        for (const [key, tick] of b.visionHistory) {
          const existing = a.visionHistory.get(key);
          if (existing === undefined || tick > existing) {
            hasDivergence = true;
            break;
          }
        }
        if (!hasDivergence) {
          for (const [key, tick] of a.visionHistory) {
            const existing = b.visionHistory.get(key);
            if (existing === undefined || tick > existing) {
              hasDivergence = true;
              break;
            }
          }
        }

        if (!hasDivergence) continue;

        // Mark as sharing (also covers the first frame before activeSharingPairs is set)
        sharingUnitIds.add(a.id);
        sharingUnitIds.add(b.id);

        // Log to chat once (ever) when sharing first occurs for this pair (capped)
        if (!sharedChatPairs.has(pairKey)) {
          sharedChatPairs.add(pairKey);
          if (sharingChatCount < MAX_SHARING_CHAT_MESSAGES) {
            sharingChatCount++;
            const aLabel = positionToLabel(a.position);
            const bLabel = positionToLabel(b.position);
            uiRenderer.addChatMessage({
              unitId: a.id,
              unitType: a.type,
              content: `Sharing map intel with ${b.type} @ ${bLabel}`,
              type: 'communication',
              gridLabel: aLabel,
            });
          }
        }
        if (!activeSharingPairs.has(pairKey)) {
          activeSharingPairs.add(pairKey);
        }

        // Merge vision histories — each unit learns what the other has seen
        for (const [key, tick] of b.visionHistory) {
          const existing = a.visionHistory.get(key);
          if (existing === undefined || tick > existing) {
            a.visionHistory.set(key, tick);
          }
        }
        for (const [key, tick] of a.visionHistory) {
          const existing = b.visionHistory.get(key);
          if (existing === undefined || tick > existing) {
            b.visionHistory.set(key, tick);
          }
        }
      }
    }
  }
  // Remove pairs that are no longer idle + close
  for (const key of activeSharingPairs) {
    if (!currentPairs.has(key)) activeSharingPairs.delete(key);
  }

  const renderState: RenderState = {
    tiles: gameMap.tiles,
    units: unitStates,
    buildings,
    fog: fogGrid,
    config,
    selectedUnitIds: selectedIds,
    localPlayerId: LOCAL_PLAYER_ID,
    selectionRect: playerController.selection.getSelectionRect(),
    currentTick,
    buildPlacementMode,
    heatMapData,
    sharingUnitIds,
    hoveredHex,
  };

  // ---- Render ----
  renderer.render(renderState);

  minimapRenderer.render({
    tiles: gameMap.tiles,
    units: unitStates,
    buildings,
    fog: fogGrid,
    config,
    cameraViewport: camera.getViewportRect(),
    localPlayerId: LOCAL_PLAYER_ID,
    heatMapData: minimapHeatMapData,
    currentTick,
  });

  // ---- UI Updates ----
  const resources = resourceManager.getResources(LOCAL_PLAYER_ID);
  uiRenderer.updateResources(resources.minerals, resources.energy);
  uiRenderer.updateTick(currentTick);
  uiRenderer.updateHotkeys(playerController.hotkeys.getGroups());

  // ---- UI: Building or Unit info ----
  if (playerController.selectedBuildingId) {
    const building = state.getBuilding(playerController.selectedBuildingId);
    if (building) {
      const res = resourceManager.getResources(LOCAL_PLAYER_ID);
      uiRenderer.updateBuildingInfo(building, res);
    }
  } else {
    const selectedUnits = unitManager
      .getSelectedUnits(LOCAL_PLAYER_ID)
      .map((u) => u.toState());
    uiRenderer.updateUnitInfo(selectedUnits);
  }
};

// ============================================================
// Start
// ============================================================

// ============================================================
// Expose game internals for Playwright / debug console access
// ============================================================
(window as any).__GAME__ = {
  engine,
  state,
  eventBus,
  unitManager,
  gameMap,
  fogOfWar,
  resourceManager,
  camera,
  renderer,
  playerController,
  strategicCommander,
  directiveExecutor,
  communication,
  config,
};

console.log('Agent RTS - Engine starting...');
console.log(`Map: ${config.mapWidth}x${config.mapHeight} | Tick rate: ${config.tickRate}/s`);
console.log(`Base at ${positionToLabel(basePosition)} | ${startingUnits.length} engineers deployed`);
console.log('Controls: Click/drag to select | Right-click to move | Hold V to speak | Ctrl+1-0 for hotkeys');

engine.start();
