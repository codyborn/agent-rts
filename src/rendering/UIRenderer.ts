// ============================================================
// Agent RTS - HTML UI Renderer
// ============================================================

import {
  UnitState,
  UnitType,
  AuditLogEntry,
  UNIT_STATS,
  positionToLabel,
  UNIT_ICONS,
} from '../shared/types';

/**
 * Updates HTML UI elements in the sidebar and overlay bars.
 *
 * Manages the resource bar, unit info panel, chat/audit log,
 * hotkey bar, and voice indicator -- all driven by DOM manipulation
 * rather than canvas rendering.
 */
export class UIRenderer {
  // Cached DOM element references
  private mineralsEl: HTMLElement | null;
  private energyEl: HTMLElement | null;
  private tickEl: HTMLElement | null;
  private unitInfoEl: HTMLElement | null;
  private chatLogEl: HTMLElement | null;
  private voiceIndicatorEl: HTMLElement | null;
  private commandBarEl: HTMLElement | null;
  private commandInputEl: HTMLInputElement | null;
  private micBtnEl: HTMLElement | null;

  /** Maximum number of chat messages to retain in the DOM */
  private static readonly MAX_CHAT_MESSAGES = 200;

  /** Optional callback invoked when a chat message is clicked */
  private chatClickCallback: ((unitId: string) => void) | null = null;

  constructor() {
    this.mineralsEl = document.getElementById('minerals-count');
    this.energyEl = document.getElementById('energy-count');
    this.tickEl = document.getElementById('tick-display');
    this.unitInfoEl = document.getElementById('unit-info');
    this.chatLogEl = document.getElementById('chat-log');
    this.voiceIndicatorEl = document.getElementById('voice-indicator');
    this.commandBarEl = document.getElementById('command-bar');
    this.commandInputEl = document.getElementById('command-input') as HTMLInputElement | null;
    this.micBtnEl = document.getElementById('mic-btn');
  }

  // ----------------------------------------------------------
  // Resource Bar
  // ----------------------------------------------------------

  /**
   * Update the mineral and energy counters in the resource bar.
   */
  updateResources(minerals: number, energy: number): void {
    if (this.mineralsEl) {
      this.mineralsEl.textContent = String(minerals);
    }
    if (this.energyEl) {
      this.energyEl.textContent = String(energy);
    }
  }

  // ----------------------------------------------------------
  // Tick Display
  // ----------------------------------------------------------

  /**
   * Update the current tick counter.
   */
  updateTick(tick: number): void {
    if (this.tickEl) {
      this.tickEl.textContent = `Tick: ${tick}`;
    }
  }

  // ----------------------------------------------------------
  // Unit Info Panel
  // ----------------------------------------------------------

  /**
   * Update the unit info panel in the sidebar.
   *
   * - No units: shows "No unit selected"
   * - One unit: shows detailed stats (health, energy, command, afflictions)
   * - Multiple units: shows a summary with type breakdown
   */
  updateUnitInfo(units: UnitState[]): void {
    if (!this.unitInfoEl) return;

    if (units.length === 0) {
      this.unitInfoEl.innerHTML =
        '<div style="color: #8e8e93; font-size: 11px;">No unit selected</div>';
      return;
    }

    if (units.length === 1) {
      this.renderSingleUnitInfo(units[0]);
      return;
    }

    this.renderMultiUnitInfo(units);
  }

  /**
   * Render detailed info for a single selected unit.
   */
  private renderSingleUnitInfo(unit: UnitState): void {
    if (!this.unitInfoEl) return;

    const stats = UNIT_STATS[unit.type];
    const typeName = unit.type.charAt(0).toUpperCase() + unit.type.slice(1);
    const gridLabel = positionToLabel(unit.position);
    const icon = UNIT_ICONS[unit.type] || '?';

    const healthPercent = stats ? Math.round((unit.health / stats.maxHealth) * 100) : 0;
    const energyPercent = stats ? Math.round((unit.energy / stats.maxEnergy) * 100) : 0;
    const healthColor = healthPercent > 50 ? '#53d769' : healthPercent > 25 ? '#ffcc02' : '#ff3b30';
    const energyColor = '#5ac8fa';

    const command = unit.currentCommand || 'Idle';

    // Afflictions
    let afflictionHtml = '';
    if (unit.afflictions && unit.afflictions.length > 0) {
      const afflictionList = unit.afflictions
        .map((a) => `<span style="color: #ff9500;">${a.type} (${a.duration}t)</span>`)
        .join(', ');
      afflictionHtml = `<div style="font-size: 10px; margin-top: 4px;">Effects: ${afflictionList}</div>`;
    }

    this.unitInfoEl.innerHTML = `
      <div style="font-size: 12px; font-weight: bold; margin-bottom: 4px;">
        ${icon} ${typeName} @ ${gridLabel}
      </div>
      <div style="font-size: 11px; margin-bottom: 2px;">
        Health: ${unit.health}/${stats ? stats.maxHealth : '?'}
        <div style="background: rgba(255,0,0,0.3); height: 4px; border-radius: 2px; margin-top: 1px;">
          <div style="background: ${healthColor}; height: 100%; width: ${healthPercent}%; border-radius: 2px;"></div>
        </div>
      </div>
      <div style="font-size: 11px; margin-bottom: 2px;">
        Energy: ${unit.energy}/${stats ? stats.maxEnergy : '?'}
        <div style="background: rgba(90,200,250,0.2); height: 4px; border-radius: 2px; margin-top: 1px;">
          <div style="background: ${energyColor}; height: 100%; width: ${energyPercent}%; border-radius: 2px;"></div>
        </div>
      </div>
      <div style="font-size: 11px; color: #8e8e93; margin-top: 4px;">
        Command: <span style="color: #53d769;">${this.escapeHtml(command)}</span>
      </div>
      ${unit.lastThought ? `<div style="font-size: 10px; color: #5ac8fa; margin-top: 4px; font-style: italic;">"${this.escapeHtml(unit.lastThought)}"</div>` : ''}
      ${afflictionHtml}
    `;
  }

  /**
   * Render a summary for multiple selected units.
   */
  private renderMultiUnitInfo(units: UnitState[]): void {
    if (!this.unitInfoEl) return;

    // Count units by type
    const typeCounts = new Map<UnitType, number>();
    for (const unit of units) {
      typeCounts.set(unit.type, (typeCounts.get(unit.type) || 0) + 1);
    }

    const breakdown = Array.from(typeCounts.entries())
      .map(([type, count]) => {
        const name = type.charAt(0).toUpperCase() + type.slice(1);
        return `${count} ${name}${count > 1 ? 's' : ''}`;
      })
      .join(', ');

    this.unitInfoEl.innerHTML = `
      <div style="font-size: 12px; font-weight: bold; margin-bottom: 4px;">
        ${units.length} units selected
      </div>
      <div style="font-size: 11px; color: #8e8e93;">
        ${breakdown}
      </div>
    `;
  }

  // ----------------------------------------------------------
  // Chat / Audit Log
  // ----------------------------------------------------------

  /**
   * Append a chat message to the chat log.
   *
   * Messages are color-coded by type (command, communication, observation,
   * action, status) using CSS classes. Clicking a message invokes the
   * registered callback with the source unit ID.
   *
   * @param message - The chat message to display
   */
  addChatMessage(message: {
    unitId: string;
    unitType: UnitType;
    content: string;
    type: AuditLogEntry['type'];
    gridLabel: string;
  }): void {
    if (!this.chatLogEl) return;

    const icon = UNIT_ICONS[message.unitType] || '?';
    const div = document.createElement('div');
    div.className = `message ${message.type}`;
    div.setAttribute('data-unit-id', message.unitId);
    div.textContent = `[${icon}@${message.gridLabel}] ${message.content}`;

    // Click handler to select the source unit
    if (this.chatClickCallback) {
      const callback = this.chatClickCallback;
      div.addEventListener('click', () => {
        const unitId = div.getAttribute('data-unit-id');
        if (unitId) {
          callback(unitId);
        }
      });
    }

    this.chatLogEl.appendChild(div);

    // Enforce message limit
    while (this.chatLogEl.children.length > UIRenderer.MAX_CHAT_MESSAGES) {
      this.chatLogEl.removeChild(this.chatLogEl.firstChild!);
    }

    // Auto-scroll to bottom
    this.chatLogEl.scrollTop = this.chatLogEl.scrollHeight;
  }

  /**
   * Register a callback that fires when a chat message is clicked.
   * The callback receives the unit ID of the message source.
   */
  onChatMessageClick(callback: (unitId: string) => void): void {
    this.chatClickCallback = callback;
  }

  /**
   * Clear all messages from the chat log.
   */
  clearChat(): void {
    if (this.chatLogEl) {
      this.chatLogEl.innerHTML = '';
    }
  }

  // ----------------------------------------------------------
  // Hotkey Bar
  // ----------------------------------------------------------

  /**
   * Update the hotkey bar slots.
   *
   * @param hotkeys - Map from hotkey key ("1"-"0") to array of unit IDs
   */
  updateHotkeys(hotkeys: Map<string, string[]>): void {
    const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];

    for (const key of keys) {
      const slot = document.getElementById(`hotkey-${key}`);
      if (!slot) continue;

      const unitIds = hotkeys.get(key);
      const countEl = slot.querySelector('.count');

      if (unitIds && unitIds.length > 0) {
        if (countEl) {
          countEl.textContent = String(unitIds.length);
        }
        slot.classList.add('active');
      } else {
        if (countEl) {
          countEl.textContent = '-';
        }
        slot.classList.remove('active');
      }
    }
  }

  // ----------------------------------------------------------
  // Voice Indicator
  // ----------------------------------------------------------

  /**
   * Show or hide the voice recording indicator.
   */
  setVoiceActive(active: boolean): void {
    if (!this.voiceIndicatorEl) return;

    if (active) {
      this.voiceIndicatorEl.classList.add('active');
    } else {
      this.voiceIndicatorEl.classList.remove('active');
    }
  }

  // ----------------------------------------------------------
  // Command Bar
  // ----------------------------------------------------------

  /**
   * Show the command bar and focus the input.
   */
  showCommandBar(): void {
    this.commandBarEl?.classList.add('visible');
    // Defer focus so it doesn't conflict with the mouseup that triggered selection
    setTimeout(() => this.commandInputEl?.focus(), 0);
  }

  /**
   * Hide the command bar and clear the input.
   */
  hideCommandBar(): void {
    this.commandBarEl?.classList.remove('visible');
    if (this.commandInputEl) this.commandInputEl.value = '';
    this.micBtnEl?.classList.remove('recording');
  }

  /**
   * Toggle recording state on the mic button.
   */
  setMicRecording(active: boolean): void {
    if (!this.micBtnEl) return;
    if (active) {
      this.micBtnEl.classList.add('recording');
    } else {
      this.micBtnEl.classList.remove('recording');
    }
  }

  /**
   * Register a callback for when the user submits a command (Enter key).
   * The callback receives the command text; the input is cleared afterward.
   */
  onCommandSubmit(callback: (command: string) => void): void {
    this.commandInputEl?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const text = this.commandInputEl!.value.trim();
        if (text.length > 0) {
          callback(text);
          this.commandInputEl!.value = '';
        }
      }
      // Prevent game hotkeys from firing while typing
      e.stopPropagation();
    });
  }

  /**
   * Register a callback for when the mic button is clicked.
   */
  onMicButtonClick(callback: () => void): void {
    this.micBtnEl?.addEventListener('click', callback);
  }

  // ----------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------

  /**
   * Escape HTML special characters to prevent XSS when inserting
   * user/unit-generated text into innerHTML.
   */
  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}
