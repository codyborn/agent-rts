import { GameEventType, GameCommand, GridPosition, UnitType } from '../shared/types';
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
        // Deselect all units
        this.selectedUnitIds = [];
        this.hotkeys.setCurrentSelection([]);
        this.eventBus.emit(GameEventType.SELECTION_CHANGED, { unitIds: [] });
        break;

      case 's':
      case 'S':
        // Stop command for selected units
        if (this.selectedUnitIds.length > 0 && !e.ctrlKey && !e.metaKey) {
          const stopCommand: GameCommand = {
            id: `cmd_${this.commandIdCounter++}`,
            tick: 0, // will be set by command queue
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

  /**
   * Process a voice transcript and create a GameCommand from it.
   * Emits UNIT_COMMAND with the generated command.
   *
   * @param transcript - Raw speech-to-text transcript
   * @returns The generated GameCommand
   */
  processVoiceCommand(transcript: string): GameCommand {
    const command: GameCommand = {
      id: `cmd_${this.commandIdCounter++}`,
      tick: 0, // will be set by command queue
      playerId: this.playerId,
      type: 'voice',
      targetUnitIds: [...this.selectedUnitIds],
      payload: { transcript },
    };

    this.eventBus.emit(GameEventType.UNIT_COMMAND, command);
    return command;
  }

  /**
   * Get the currently selected unit IDs.
   */
  getSelectedUnitIds(): string[] {
    return [...this.selectedUnitIds];
  }

  /**
   * Programmatically set the selected unit IDs and sync with subsystems.
   */
  setSelectedUnitIds(ids: string[]): void {
    this.selectedUnitIds = [...ids];
    this.hotkeys.setCurrentSelection(this.selectedUnitIds);
    this.eventBus.emit(GameEventType.SELECTION_CHANGED, {
      unitIds: [...this.selectedUnitIds],
    });
  }

  /**
   * Get the screen-to-grid conversion function (set externally since
   * it depends on the camera state).
   */
  getScreenToGrid(): ((x: number, y: number) => GridPosition) | null {
    return this.screenToGridFn;
  }

  /**
   * Set the screen-to-grid conversion function. This is called by the
   * renderer or camera system to keep the Selection system in sync.
   */
  setScreenToGrid(fn: (x: number, y: number) => GridPosition): void {
    this.screenToGridFn = fn;
  }

  /**
   * Set the grid-to-screen conversion function. Used by the Selection
   * system to map unit positions back to screen coordinates for hit-testing.
   */
  setGridToScreen(fn: (pos: GridPosition) => { x: number; y: number }): void {
    this.gridToScreenFn = fn;
  }

  /**
   * Retrieve the grid-to-screen conversion function.
   */
  getGridToScreen(): ((pos: GridPosition) => { x: number; y: number }) | null {
    return this.gridToScreenFn;
  }

  /**
   * Clean up all subsystems and event listeners.
   */
  destroy(): void {
    this.selection.destroy();
    this.hotkeys.destroy();
    this.voice.destroy();
    this.unsubscribeSelectionChanged();
    this.unsubscribePlayerCommand();
    window.removeEventListener('keydown', this.onKeyDown);
  }
}
