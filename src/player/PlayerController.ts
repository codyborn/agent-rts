import { GameEventType, GameCommand, GridPosition, UnitType, BuildingType } from '../shared/types';
import { EventBus } from '../engine/EventBus';
import { Selection } from './Selection';
import { Hotkeys } from './Hotkeys';
import { VoiceInput } from './VoiceInput';

// ============================================================
// PlayerController - Top-level player input coordinator
// Wires together Selection, Hotkeys, and VoiceInput subsystems,
// manages the current selection state, and translates raw input
// into GameCommand objects for the command queue.
// ============================================================

export class PlayerController {
  public readonly selection: Selection;
  public readonly hotkeys: Hotkeys;
  public readonly voice: VoiceInput;
  public readonly playerId: string;

  private selectedUnitIds: string[] = [];
  private commandIdCounter = 0;

  private screenToGridFn: ((x: number, y: number) => GridPosition) | null = null;
  private gridToScreenFn: ((pos: GridPosition) => { x: number; y: number }) | null = null;

  private readonly eventBus: EventBus;

  // ---- Building selection & build mode ----
  public selectedBuildingId: string | null = null;
  public buildPlacementMode: { buildingType: BuildingType; engineerIds: string[] } | null = null;

  // ---- Heat map toggle ----
  public heatMapEnabled: boolean = false;

  // Bound references for cleanup
  private readonly onKeyDown: (e: KeyboardEvent) => void;
  private readonly unsubscribeSelectionChanged: () => void;
  private readonly unsubscribePlayerCommand: () => void;

  constructor(canvas: HTMLCanvasElement, eventBus: EventBus, playerId: string) {
    this.eventBus = eventBus;
    this.playerId = playerId;

    // Initialize subsystems
    this.selection = new Selection(canvas, eventBus);
    this.hotkeys = new Hotkeys(eventBus);
    this.voice = new VoiceInput(eventBus);

    // Listen for selection changes (from hotkeys or external sources)
    this.unsubscribeSelectionChanged = this.eventBus.on<{ unitIds: string[]; centerCamera?: boolean }>(
      GameEventType.SELECTION_CHANGED,
      (data) => {
        this.selectedUnitIds = [...data.unitIds];
        this.hotkeys.setCurrentSelection(this.selectedUnitIds);
        // Clear building selection when units are selected
        if (this.selectedUnitIds.length > 0) {
          this.selectedBuildingId = null;
        }
      }
    );

    // Listen for voice commands
    this.unsubscribePlayerCommand = this.eventBus.on<{ transcript: string; timestamp: number }>(
      GameEventType.PLAYER_COMMAND,
      (data) => {
        this.processVoiceCommand(data.transcript);
      }
    );

    // Keyboard shortcuts
    this.onKeyDown = this.handleKeyDown.bind(this);
    window.addEventListener('keydown', this.onKeyDown);
  }

  // ---- Event handler ----

  private handleKeyDown(e: KeyboardEvent): void {
    // Ignore if the user is typing in an input field
    const target = e.target as HTMLElement;
    if (
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.isContentEditable
    ) {
      return;
    }

    switch (e.key) {
      case 'Escape':
        if (this.buildPlacementMode) {
          // Cancel build placement mode first
          this.cancelBuildMode();
        } else {
          // Deselect all units and buildings
          this.selectedUnitIds = [];
          this.selectedBuildingId = null;
          this.heatMapEnabled = false;
          this.hotkeys.setCurrentSelection([]);
          this.eventBus.emit(GameEventType.SELECTION_CHANGED, { unitIds: [] });
        }
        break;

      case 'b':
      case 'B':
        // Enter build mode if engineers are selected
        if (this.selectedUnitIds.length > 0 && !e.ctrlKey && !e.metaKey) {
          this.eventBus.emit(GameEventType.BUILDING_PLACE_REQUESTED, {
            engineerIds: [...this.selectedUnitIds],
          });
        }
        break;

      case 'h':
      case 'H':
        // Toggle heat map overlay
        if (this.selectedUnitIds.length > 0 && !e.ctrlKey && !e.metaKey) {
          this.heatMapEnabled = !this.heatMapEnabled;
        }
        break;

      case 's':
      case 'S':
        // Stop command for selected units
        if (this.selectedUnitIds.length > 0 && !e.ctrlKey && !e.metaKey) {
          const stopCommand: GameCommand = {
            id: `cmd_${this.commandIdCounter++}`,
            tick: 0,
            playerId: this.playerId,
            type: 'stop',
            targetUnitIds: [...this.selectedUnitIds],
            payload: {},
          };
          this.eventBus.emit(GameEventType.UNIT_COMMAND, stopCommand);
        }
        break;
    }
  }

  // ---- Public methods ----

  processVoiceCommand(transcript: string): GameCommand {
    const command: GameCommand = {
      id: `cmd_${this.commandIdCounter++}`,
      tick: 0,
      playerId: this.playerId,
      type: 'voice',
      targetUnitIds: [...this.selectedUnitIds],
      payload: { transcript },
    };

    this.eventBus.emit(GameEventType.UNIT_COMMAND, command);
    return command;
  }

  getSelectedUnitIds(): string[] {
    return [...this.selectedUnitIds];
  }

  setSelectedUnitIds(ids: string[]): void {
    this.selectedUnitIds = [...ids];
    this.hotkeys.setCurrentSelection(this.selectedUnitIds);
    this.eventBus.emit(GameEventType.SELECTION_CHANGED, {
      unitIds: [...this.selectedUnitIds],
    });
  }

  setSelectedBuildingId(id: string | null): void {
    this.selectedBuildingId = id;
    if (id) {
      // Clear unit selection when selecting a building
      this.selectedUnitIds = [];
      this.hotkeys.setCurrentSelection([]);
      this.eventBus.emit(GameEventType.SELECTION_CHANGED, { unitIds: [] });
    }
  }

  enterBuildMode(type: BuildingType, engineerIds: string[]): void {
    this.buildPlacementMode = { buildingType: type, engineerIds };
  }

  cancelBuildMode(): void {
    this.buildPlacementMode = null;
  }

  getScreenToGrid(): ((x: number, y: number) => GridPosition) | null {
    return this.screenToGridFn;
  }

  setScreenToGrid(fn: (x: number, y: number) => GridPosition): void {
    this.screenToGridFn = fn;
  }

  setGridToScreen(fn: (pos: GridPosition) => { x: number; y: number }): void {
    this.gridToScreenFn = fn;
  }

  getGridToScreen(): ((pos: GridPosition) => { x: number; y: number }) | null {
    return this.gridToScreenFn;
  }

  destroy(): void {
    this.selection.destroy();
    this.hotkeys.destroy();
    this.voice.destroy();
    this.unsubscribeSelectionChanged();
    this.unsubscribePlayerCommand();
    window.removeEventListener('keydown', this.onKeyDown);
  }
}
