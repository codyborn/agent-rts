import { GameEventType } from '../shared/types';
import { EventBus } from '../engine/EventBus';

// ============================================================
// Hotkeys - Control group system (StarCraft-style)
// Supports Ctrl+[0-9] to assign, [0-9] to recall,
// and double-tap to recall + center camera.
// ============================================================

export class Hotkeys {
  private readonly eventBus: EventBus;

  /** Control groups: digit key -> array of unit IDs */
  private groups: Map<string, string[]> = new Map();

  /** Timestamp of last key press per digit, for double-tap detection */
  private lastKeyTime: Map<string, number> = new Map();

  /** Maximum interval (ms) between two key presses to count as double-tap */
  private readonly DOUBLE_TAP_MS = 300;

  /** Current selection, updated externally so Ctrl+key can assign it */
  private currentSelection: string[] = [];

  // Bound reference for cleanup
  private readonly onKeyDown: (e: KeyboardEvent) => void;

  constructor(eventBus: EventBus) {
    this.eventBus = eventBus;

    this.onKeyDown = this.handleKeyDown.bind(this);
    window.addEventListener('keydown', this.onKeyDown);
  }

  // ---- Event handler ----

  private handleKeyDown(e: KeyboardEvent): void {
    // Only handle digit keys 0-9
    const digit = e.key;
    if (!/^[0-9]$/.test(digit)) return;

    // Ignore if the user is typing in an input field
    const target = e.target as HTMLElement;
    if (
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.isContentEditable
    ) {
      return;
    }

    const isCtrlOrMeta = e.ctrlKey || e.metaKey;

    if (isCtrlOrMeta) {
      // Ctrl/Cmd + digit: assign current selection to this group
      e.preventDefault();
      this.assignGroup(digit, this.currentSelection);
      this.eventBus.emit(GameEventType.HOTKEY_ASSIGNED, {
        key: digit,
        unitIds: [...this.currentSelection],
      });
      return;
    }

    // Digit without modifier: recall group
    e.preventDefault();

    const now = Date.now();
    const lastTime = this.lastKeyTime.get(digit) || 0;
    const isDoubleTap = now - lastTime < this.DOUBLE_TAP_MS;
    this.lastKeyTime.set(digit, now);

    const unitIds = this.recallGroup(digit);

    this.eventBus.emit(GameEventType.SELECTION_CHANGED, { unitIds });

    if (isDoubleTap && unitIds.length > 0) {
      // Double-tap: also signal the camera to center on the group
      this.eventBus.emit(GameEventType.SELECTION_CHANGED, {
        unitIds,
        centerCamera: true,
      });
    }
  }

  // ---- Public methods ----

  /**
   * Assign a group of unit IDs to a control group key.
   * Stores a defensive copy of the IDs array.
   */
  assignGroup(key: string, unitIds: string[]): void {
    this.groups.set(key, [...unitIds]);
  }

  /**
   * Recall the unit IDs stored in a control group.
   * Returns an empty array if the group does not exist.
   */
  recallGroup(key: string): string[] {
    const group = this.groups.get(key);
    return group ? [...group] : [];
  }

  /**
   * Return a copy of all control groups.
   */
  getGroups(): Map<string, string[]> {
    const copy = new Map<string, string[]>();
    for (const [key, ids] of this.groups) {
      copy.set(key, [...ids]);
    }
    return copy;
  }

  /**
   * Update the current selection so that Ctrl+key can assign it.
   * Called by PlayerController whenever the selection changes.
   */
  setCurrentSelection(unitIds: string[]): void {
    this.currentSelection = [...unitIds];
  }

  /**
   * Remove all event listeners and clean up resources.
   */
  destroy(): void {
    window.removeEventListener('keydown', this.onKeyDown);
  }
}
