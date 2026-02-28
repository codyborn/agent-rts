import { UnitState, GridPosition, GameEventType } from '../shared/types';
import { EventBus } from '../engine/EventBus';

// ============================================================
// Selection - Mouse-based unit selection on the canvas
// Supports click-to-select and drag-to-box-select with
// shift-key modifier for additive selection.
// ============================================================

export class Selection {
  private isMouseDown = false;
  private startX = 0;
  private startY = 0;
  private currentX = 0;
  private currentY = 0;
  private shiftHeld = false;

  private readonly canvas: HTMLCanvasElement;
  private readonly eventBus: EventBus;

  // Bound references for cleanup
  private readonly onMouseDown: (e: MouseEvent) => void;
  private readonly onMouseMove: (e: MouseEvent) => void;
  private readonly onMouseUp: (e: MouseEvent) => void;
  private readonly onKeyDown: (e: KeyboardEvent) => void;
  private readonly onKeyUp: (e: KeyboardEvent) => void;

  constructor(canvas: HTMLCanvasElement, eventBus: EventBus) {
    this.canvas = canvas;
    this.eventBus = eventBus;

    this.onMouseDown = this.handleMouseDown.bind(this);
    this.onMouseMove = this.handleMouseMove.bind(this);
    this.onMouseUp = this.handleMouseUp.bind(this);
    this.onKeyDown = this.handleKeyDown.bind(this);
    this.onKeyUp = this.handleKeyUp.bind(this);

    this.canvas.addEventListener('mousedown', this.onMouseDown);
    this.canvas.addEventListener('mousemove', this.onMouseMove);
    this.canvas.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
  }

  // ---- Event handlers ----

  private handleMouseDown(e: MouseEvent): void {
    if (e.button !== 0) return; // left-click only
    const rect = this.canvas.getBoundingClientRect();
    this.isMouseDown = true;
    this.startX = e.clientX - rect.left;
    this.startY = e.clientY - rect.top;
    this.currentX = this.startX;
    this.currentY = this.startY;
  }

  private handleMouseMove(e: MouseEvent): void {
    if (!this.isMouseDown) return;
    const rect = this.canvas.getBoundingClientRect();
    this.currentX = e.clientX - rect.left;
    this.currentY = e.clientY - rect.top;
  }

  private handleMouseUp(_e: MouseEvent): void {
    this.isMouseDown = false;
  }

  private handleKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Shift') {
      this.shiftHeld = true;
    }
  }

  private handleKeyUp(e: KeyboardEvent): void {
    if (e.key === 'Shift') {
      this.shiftHeld = false;
    }
  }

  // ---- Public methods ----

  /**
   * Returns the current drag selection rectangle, or null if the user
   * is not dragging or the drag distance is too small (< 5px).
   * The returned rect always has positive width and height.
   */
  getSelectionRect(): { x: number; y: number; width: number; height: number } | null {
    if (!this.isMouseDown) return null;

    const dx = this.currentX - this.startX;
    const dy = this.currentY - this.startY;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance < 5) return null;

    // Normalize to ensure positive width/height
    const x = Math.min(this.startX, this.currentX);
    const y = Math.min(this.startY, this.currentY);
    const width = Math.abs(dx);
    const height = Math.abs(dy);

    return { x, y, width, height };
  }

  /**
   * Resolve which units are selected based on the current mouse interaction.
   *
   * - Click (drag < 5px): selects the single closest unit belonging to localPlayerId.
   * - Drag (box select): selects all units belonging to localPlayerId whose
   *   screen position falls within the selection rectangle.
   *
   * @param units - All units in the game
   * @param screenToGrid - Converts screen coordinates to grid position
   * @param gridToScreen - Converts grid position to screen coordinates
   * @param localPlayerId - The local player's ID (only their units can be selected)
   * @param tileSize - Pixel size of each tile
   * @returns Array of selected unit IDs
   */
  resolveSelection(
    units: UnitState[],
    screenToGrid: (x: number, y: number) => GridPosition,
    gridToScreen: (pos: GridPosition) => { x: number; y: number },
    localPlayerId: string,
    tileSize: number
  ): string[] {
    const dx = this.currentX - this.startX;
    const dy = this.currentY - this.startY;
    const dragDistance = Math.sqrt(dx * dx + dy * dy);

    const playerUnits = units.filter(u => u.playerId === localPlayerId);

    if (dragDistance < 5) {
      // Click selection: find the closest unit to the click position
      const clickX = this.startX;
      const clickY = this.startY;

      let closestId: string | null = null;
      let closestDist = Infinity;

      for (const unit of playerUnits) {
        // gridToScreen returns top-left of hex bounding box; compute center
        const screenPos = gridToScreen(unit.position);
        const unitX = screenPos.x + tileSize / 2;
        const unitY = screenPos.y + tileSize / 2;

        const dist = Math.sqrt(
          (clickX - unitX) ** 2 + (clickY - unitY) ** 2
        );

        // Only select units within a reasonable click radius (use max dimension)
        if (dist < tileSize * 0.75 && dist < closestDist) {
          closestDist = dist;
          closestId = unit.id;
        }
      }

      return closestId ? [closestId] : [];
    }

    // Box selection: compute rect from stored start/current coords.
    // (Can't use getSelectionRect() here because isMouseDown is already
    // cleared by the time the external mouseup handler calls us.)
    const rx = Math.min(this.startX, this.currentX);
    const ry = Math.min(this.startY, this.currentY);
    const rw = Math.abs(this.currentX - this.startX);
    const rh = Math.abs(this.currentY - this.startY);
    const rect = { x: rx, y: ry, width: rw, height: rh };

    const selected: string[] = [];

    for (const unit of playerUnits) {
      // gridToScreen returns top-left of hex bounding box; compute center
      const screenPos = gridToScreen(unit.position);
      const unitCenterX = screenPos.x + tileSize / 2;
      const unitCenterY = screenPos.y + tileSize / 2;

      if (
        unitCenterX >= rect.x &&
        unitCenterX <= rect.x + rect.width &&
        unitCenterY >= rect.y &&
        unitCenterY <= rect.y + rect.height
      ) {
        selected.push(unit.id);
      }
    }

    return selected;
  }

  /**
   * Whether the shift key is currently held (for additive selection).
   */
  get isShiftHeld(): boolean {
    return this.shiftHeld;
  }

  /**
   * Whether the mouse is currently pressed (drag in progress).
   */
  get isDragging(): boolean {
    return this.isMouseDown;
  }

  /**
   * Remove all event listeners and clean up resources.
   */
  destroy(): void {
    this.canvas.removeEventListener('mousedown', this.onMouseDown);
    this.canvas.removeEventListener('mousemove', this.onMouseMove);
    this.canvas.removeEventListener('mouseup', this.onMouseUp);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
  }
}
