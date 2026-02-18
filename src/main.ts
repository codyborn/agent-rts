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
  BUILDING_STATS,
  PLAYER_COLORS,
  positionToLabel,
  GridPosition,
  BuildingState,
  UnitBehaviorState,
} from './shared/types';
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
const directiveExecutor = new DirectiveExecutor(unitManager, gameMap, fogOfWar, LOCAL_PLAYER_ID, eventBus);

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

const worldWidth = config.mapWidth * config.tileSize;
const worldHeight = config.mapHeight * config.tileSize;
const camera = new Camera(gameCanvas.width, gameCanvas.height, worldWidth, worldHeight);
camera.centerOn(basePosition, config.tileSize);

const renderer = new Renderer(gameCanvas, camera);
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

// Handle selection resolution on mouseup
gameCanvas.addEventListener('mouseup', () => {
  const allUnitStates = Array.from(unitManager.getUnitStates().values());
  const selectedIds = playerController.selection.resolveSelection(
    allUnitStates,
    (x, y) => camera.screenToGrid(x, y, config.tileSize),
    (pos) => camera.gridToScreen(pos, config.tileSize),
    LOCAL_PLAYER_ID,
    config.tileSize * camera.zoom,
  );

  if (selectedIds.length > 0) {
    if (playerController.selection.isShiftHeld) {
      // Additive selection
      const current = new Set(playerController.getSelectedUnitIds());
      for (const id of selectedIds) current.add(id);
      unitManager.selectUnits([...current]);
    } else {
      unitManager.selectUnits(selectedIds);
    }
  } else if (!playerController.selection.isShiftHeld) {
    unitManager.deselectAll(LOCAL_PLAYER_ID);
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
      unit.addAuditLog(`Moving to ${positionToLabel(targetPos)}`, unit.id, 'action');
    }
  }
});

// Camera panning with arrow keys and WASD
const keysHeld = new Set<string>();
window.addEventListener('keydown', (e) => keysHeld.add(e.key.toLowerCase()));
window.addEventListener('keyup', (e) => keysHeld.delete(e.key.toLowerCase()));

// Edge panning with mouse + grid tooltip
let mouseX = 0;
let mouseY = 0;
const gridTooltip = document.getElementById('grid-tooltip')!;
gameCanvas.addEventListener('mousemove', (e) => {
  const rect = gameCanvas.getBoundingClientRect();
  mouseX = e.clientX - rect.left;
  mouseY = e.clientY - rect.top;

  const gridPos = camera.screenToGrid(mouseX, mouseY, config.tileSize);
  if (gridPos.col >= 0 && gridPos.col < config.mapWidth && gridPos.row >= 0 && gridPos.row < config.mapHeight) {
    gridTooltip.textContent = positionToLabel(gridPos);
    gridTooltip.style.left = `${e.clientX + 12}px`;
    gridTooltip.style.top = `${e.clientY + 12}px`;
    gridTooltip.style.display = 'block';
  } else {
    gridTooltip.style.display = 'none';
  }
});
gameCanvas.addEventListener('mouseleave', () => {
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

// Voice/text command handling
eventBus.on(GameEventType.UNIT_COMMAND, (data: any) => {
  if (data.type === 'voice' && data.payload?.transcript) {
    const transcript = data.payload.transcript as string;
    const targetUnits = data.targetUnitIds
      .map((id: string) => unitManager.getUnit(id))
      .filter(Boolean);

    if (targetUnits.length === 0) {
      console.warn('[Command] No selected units to command');
      return;
    }

    // Set command directly on all targeted units (bypass base range limit)
    for (const unit of targetUnits) {
      (unit as any).setCommand(transcript);
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

          // If unit finished its path and was MOVING, go idle
          if (!unit.path && unit.behaviorState === UnitBehaviorState.MOVING) {
            unit.behaviorState = UnitBehaviorState.IDLE;
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
engine.registerSystem('combat', new CombatSystem(unitManager, gameMap, LOCAL_PLAYER_ID));
engine.registerSystem('buildings', new BuildingSystem(unitManager, resourceManager, state));

// ============================================================
// Render Loop (runs every frame via engine.onFrame)
// ============================================================

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

  const renderState: RenderState = {
    tiles: gameMap.tiles,
    units: unitStates,
    buildings,
    fog: fogGrid,
    config,
    selectedUnitIds: selectedIds,
    localPlayerId: LOCAL_PLAYER_ID,
    selectionRect: playerController.selection.getSelectionRect(),
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
  });

  // ---- UI Updates ----
  const resources = resourceManager.getResources(LOCAL_PLAYER_ID);
  uiRenderer.updateResources(resources.minerals, resources.energy);
  uiRenderer.updateTick(engine.getCurrentTick());
  uiRenderer.updateHotkeys(playerController.hotkeys.getGroups());

  const selectedUnits = unitManager
    .getSelectedUnits(LOCAL_PLAYER_ID)
    .map((u) => u.toState());
  uiRenderer.updateUnitInfo(selectedUnits);
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
