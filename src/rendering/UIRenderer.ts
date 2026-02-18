// ============================================================
// Agent RTS - HTML UI Renderer
// ============================================================

import {
  UnitState,
  UnitType,
  BuildingType,
  BuildingState,
  ResourceType,
  AuditLogEntry,
  UNIT_STATS,
  UNIT_COSTS,
  BUILDING_COSTS,
  PRODUCTION_BUILDINGS,
  positionToLabel,
  UNIT_ICONS,
} from '../shared/types';

/**
 * Updates HTML UI elements in the sidebar and overlay bars.
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

  /** Callback for training units from building panel */
  private trainUnitCallback: ((buildingId: string, unitType: UnitType) => void) | null = null;

  /** Callback for build menu button clicks */
  private buildMenuCallback: ((buildingType: BuildingType) => void) | null = null;

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

  updateTick(tick: number): void {
    if (this.tickEl) {
      this.tickEl.textContent = `Tick: ${tick}`;
    }
  }

  // ----------------------------------------------------------
  // Unit Info Panel
  // ----------------------------------------------------------

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

  private renderMultiUnitInfo(units: UnitState[]): void {
    if (!this.unitInfoEl) return;

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
  // Building Info Panel
  // ----------------------------------------------------------

  /**
   * Update the unit info panel to show building information instead.
   */
  updateBuildingInfo(
    building: BuildingState,
    resources: Record<ResourceType, number>,
  ): void {
    if (!this.unitInfoEl) return;

    const typeName = building.type.charAt(0).toUpperCase() + building.type.slice(1);
    const gridLabel = positionToLabel(building.position);
    const healthPercent = Math.round((building.health / building.maxHealth) * 100);
    const healthColor = healthPercent > 50 ? '#53d769' : healthPercent > 25 ? '#ffcc02' : '#ff3b30';

    // Get producible units for this building type
    const producible = this.getProducibleUnits(building.type);

    // Production queue display
    let queueHtml = '';
    if (building.productionQueue.length > 0) {
      const queueItems = building.productionQueue
        .map((ut) => ut.charAt(0).toUpperCase() + ut.slice(1))
        .join(', ');
      const progressPct = Math.round(building.productionProgress * 100);
      queueHtml = `
        <div style="font-size: 10px; margin-top: 6px; color: #ffcc02;">
          Producing: ${queueItems} (${progressPct}%)
          <div style="background: rgba(255,204,2,0.2); height: 4px; border-radius: 2px; margin-top: 1px;">
            <div style="background: #ffcc02; height: 100%; width: ${progressPct}%; border-radius: 2px;"></div>
          </div>
        </div>
      `;
    }

    // Train buttons
    let trainHtml = '';
    if (!building.isConstructing && producible.length > 0) {
      const buttons = producible.map((ut) => {
        const cost = UNIT_COSTS[ut];
        const name = ut.charAt(0).toUpperCase() + ut.slice(1);
        const canAfford = resources.minerals >= cost.minerals && resources.energy >= cost.energy;
        const disabledClass = canAfford ? '' : ' disabled';
        const costStr = cost.energy > 0
          ? `${cost.minerals}M ${cost.energy}E`
          : `${cost.minerals}M`;
        return `<button class="train-btn${disabledClass}" data-unit-type="${ut}" data-building-id="${building.id}">
          ${name}<br><span style="font-size: 9px;">${costStr}</span>
        </button>`;
      }).join('');

      trainHtml = `<div style="margin-top: 6px; display: flex; flex-wrap: wrap; gap: 4px;">${buttons}</div>`;
    }

    this.unitInfoEl.innerHTML = `
      <div style="font-size: 12px; font-weight: bold; margin-bottom: 4px;">
        ${typeName} @ ${gridLabel}
      </div>
      <div style="font-size: 11px; margin-bottom: 2px;">
        Health: ${building.health}/${building.maxHealth}
        <div style="background: rgba(255,0,0,0.3); height: 4px; border-radius: 2px; margin-top: 1px;">
          <div style="background: ${healthColor}; height: 100%; width: ${healthPercent}%; border-radius: 2px;"></div>
        </div>
      </div>
      ${building.isConstructing ? `<div style="font-size: 10px; color: #ffcc02;">Under construction (${Math.round(building.constructionProgress * 100)}%)</div>` : ''}
      ${queueHtml}
      ${trainHtml}
    `;

    // Attach click handlers to train buttons
    if (!building.isConstructing && this.trainUnitCallback) {
      const callback = this.trainUnitCallback;
      const buttons = this.unitInfoEl.querySelectorAll('.train-btn:not(.disabled)');
      buttons.forEach((btn) => {
        btn.addEventListener('click', () => {
          const unitType = btn.getAttribute('data-unit-type') as UnitType;
          const buildingId = btn.getAttribute('data-building-id')!;
          callback(buildingId, unitType);
        });
      });
    }
  }

  /**
   * Register a callback for training units from the building panel.
   */
  onTrainUnit(callback: (buildingId: string, unitType: UnitType) => void): void {
    this.trainUnitCallback = callback;
  }

  /**
   * Register a callback for when a build menu option is clicked.
   */
  onBuildMenuSelect(callback: (buildingType: BuildingType) => void): void {
    this.buildMenuCallback = callback;
  }

  /**
   * Show a floating build menu with building options and costs.
   */
  showBuildMenu(): void {
    // Remove existing build menu if any
    this.hideBuildMenu();

    const menu = document.createElement('div');
    menu.id = 'build-menu';
    menu.className = 'build-menu';

    const buildableTypes: { type: BuildingType; label: string }[] = [
      { type: BuildingType.BARRACKS, label: 'Barracks' },
      { type: BuildingType.FACTORY, label: 'Factory' },
      { type: BuildingType.WATCHTOWER, label: 'Watchtower' },
    ];

    for (const { type, label } of buildableTypes) {
      const cost = BUILDING_COSTS[type];
      const costStr = cost[ResourceType.ENERGY] > 0
        ? `${cost[ResourceType.MINERALS]}M ${cost[ResourceType.ENERGY]}E`
        : `${cost[ResourceType.MINERALS]}M`;

      const btn = document.createElement('button');
      btn.className = 'build-menu-btn';
      btn.innerHTML = `${label}<br><span style="font-size: 9px; color: #8e8e93;">${costStr}</span>`;
      btn.addEventListener('click', () => {
        if (this.buildMenuCallback) {
          this.buildMenuCallback(type);
        }
        this.hideBuildMenu();
      });
      menu.appendChild(btn);
    }

    document.body.appendChild(menu);
  }

  /**
   * Hide the build menu.
   */
  hideBuildMenu(): void {
    const existing = document.getElementById('build-menu');
    if (existing) existing.remove();
  }

  /**
   * Reverse-lookup which unit types a building can produce.
   */
  private getProducibleUnits(buildingType: BuildingType): UnitType[] {
    const result: UnitType[] = [];
    for (const [unitType, bType] of Object.entries(PRODUCTION_BUILDINGS)) {
      if (bType === buildingType) {
        result.push(unitType as UnitType);
      }
    }
    return result;
  }

  // ----------------------------------------------------------
  // Chat / Audit Log
  // ----------------------------------------------------------

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

    while (this.chatLogEl.children.length > UIRenderer.MAX_CHAT_MESSAGES) {
      this.chatLogEl.removeChild(this.chatLogEl.firstChild!);
    }

    this.chatLogEl.scrollTop = this.chatLogEl.scrollHeight;
  }

  onChatMessageClick(callback: (unitId: string) => void): void {
    this.chatClickCallback = callback;
  }

  clearChat(): void {
    if (this.chatLogEl) {
      this.chatLogEl.innerHTML = '';
    }
  }

  // ----------------------------------------------------------
  // Hotkey Bar
  // ----------------------------------------------------------

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

  showCommandBar(): void {
    this.commandBarEl?.classList.add('visible');
    setTimeout(() => this.commandInputEl?.focus(), 0);
  }

  hideCommandBar(): void {
    this.commandBarEl?.classList.remove('visible');
    if (this.commandInputEl) this.commandInputEl.value = '';
    this.micBtnEl?.classList.remove('recording');
  }

  setMicRecording(active: boolean): void {
    if (!this.micBtnEl) return;
    if (active) {
      this.micBtnEl.classList.add('recording');
    } else {
      this.micBtnEl.classList.remove('recording');
    }
  }

  onCommandSubmit(callback: (command: string) => void): void {
    this.commandInputEl?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const text = this.commandInputEl!.value.trim();
        if (text.length > 0) {
          callback(text);
          this.commandInputEl!.value = '';
        }
      }
      e.stopPropagation();
    });
  }

  onMicButtonClick(callback: () => void): void {
    this.micBtnEl?.addEventListener('click', callback);
  }

  // ----------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}
