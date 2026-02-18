import {
  UnitPerception,
  UnitAction,
  UnitType,
  GridPosition,
  BuildingType,
  positionToLabel,
} from '../shared/types';
import { EventBus } from '../engine/EventBus';

// ============================================================
// AgentController - Rule-based AI stub for unit decision-making
// Provides simple heuristic actions per unit type. Designed to
// be replaced by actual LLM calls in a future iteration while
// keeping the same interface.
// ============================================================

export class AgentController {
  private readonly eventBus: EventBus;
  private readonly localPlayerId: string;
  private llmEnabled = true;

  constructor(eventBus: EventBus, localPlayerId: string) {
    this.eventBus = eventBus;
    this.localPlayerId = localPlayerId;
  }

  /**
   * Given a unit's perception of the world, return an action to take.
   * Tries the LLM endpoint for local player units; falls back to rule-based.
   */
  async requestAction(perception: UnitPerception, playerId?: string): Promise<UnitAction> {
    const isLocalPlayer = playerId === this.localPlayerId;
    if (this.llmEnabled && isLocalPlayer) {
      try {
        const action = await this.requestLLMAction(perception);
        if (action) return action;
      } catch {
        // LLM call failed — fall back to rule-based
      }
    }

    return this.requestRuleBasedAction(perception);
  }

  private async requestLLMAction(perception: UnitPerception): Promise<UnitAction | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    try {
      const res = await fetch('/api/think', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          perception: this.formatPerception(perception),
          unitType: perception.self.type,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        if (res.status === 503) {
          // LLM not configured — disable for future calls
          this.llmEnabled = false;
          console.warn('[AgentController] LLM not configured, falling back to rule-based AI');
        }
        return null;
      }

      const action = await res.json() as UnitAction;
      console.log(`[AgentController] LLM action for ${perception.self.type} ${perception.self.id}: ${action.type}`, action.details ?? '');
      return action;
    } finally {
      clearTimeout(timeout);
    }
  }

  private requestRuleBasedAction(perception: UnitPerception): UnitAction {
    const { self, visibleUnits, visibleTerrain, currentCommand, nearbyMessages } = perception;

    const enemies = visibleUnits.filter(u => !u.isFriendly);
    const friendlies = visibleUnits.filter(u => u.isFriendly);
    const commandLower = currentCommand?.toLowerCase() ?? '';

    switch (self.type) {
      case UnitType.ENGINEER:
        return this.engineerAction(self, enemies, visibleTerrain, commandLower);

      case UnitType.SCOUT:
        return this.scoutAction(self, enemies);

      case UnitType.SOLDIER:
        return this.soldierAction(self, enemies, commandLower);

      case UnitType.MESSENGER:
        return this.messengerAction(self, commandLower);

      case UnitType.SIEGE:
        return this.siegeAction(self, enemies);

      case UnitType.CAPTAIN:
        return this.captainAction(self, friendlies);

      case UnitType.SPY:
        return this.spyAction(self, enemies);

      default:
        return { type: 'idle' };
    }
  }

  // ---- Per-unit-type decision logic ----

  private engineerAction(
    self: UnitPerception['self'],
    enemies: UnitPerception['visibleUnits'],
    visibleTerrain: UnitPerception['visibleTerrain'],
    command: string
  ): UnitAction {
    // If commanded to build
    if (command.includes('build')) {
      return {
        type: 'build',
        buildingType: BuildingType.BARRACKS,
        details: 'Building as commanded',
      };
    }

    // If commanded to gather/extract/resource
    if (command.includes('gather') || command.includes('extract') || command.includes('resource')) {
      const nearestResource = AgentController.findNearestResource(self.position, visibleTerrain);
      if (nearestResource) {
        return {
          type: 'gather',
          target: nearestResource,
          details: 'Gathering as commanded',
        };
      }
    }

    // If there are visible resources, go gather
    const nearestResource = AgentController.findNearestResource(self.position, visibleTerrain);
    if (nearestResource) {
      return {
        type: 'gather',
        target: nearestResource,
        details: 'Gathering nearby resource',
      };
    }

    // No resources visible — explore to find some
    const angle = Math.random() * Math.PI * 2;
    return {
      type: 'move',
      target: {
        col: Math.max(0, Math.round(self.position.col + Math.cos(angle) * 5)),
        row: Math.max(0, Math.round(self.position.row + Math.sin(angle) * 5)),
      },
      details: 'Exploring to find resources',
    };
  }

  private scoutAction(
    self: UnitPerception['self'],
    enemies: UnitPerception['visibleUnits']
  ): UnitAction {
    // If enemy spotted, report it
    if (enemies.length > 0) {
      const enemy = enemies[0];
      const enemyPos: GridPosition = {
        col: self.position.col + enemy.relativePosition.dx,
        row: self.position.row + enemy.relativePosition.dy,
      };
      return {
        type: 'communicate',
        message: `Enemy ${enemy.type} spotted at ${enemy.gridLabel}`,
        details: 'Reporting enemy position',
      };
    }

    // Otherwise explore: pick a random direction, 5 tiles away
    const angle = Math.random() * Math.PI * 2;
    const target: GridPosition = {
      col: Math.max(0, Math.round(self.position.col + Math.cos(angle) * 5)),
      row: Math.max(0, Math.round(self.position.row + Math.sin(angle) * 5)),
    };

    return {
      type: 'move',
      target,
      details: 'Exploring',
    };
  }

  private soldierAction(
    self: UnitPerception['self'],
    enemies: UnitPerception['visibleUnits'],
    command: string
  ): UnitAction {
    // If commanded to attack
    if (command.includes('attack')) {
      if (enemies.length > 0) {
        const nearest = AgentController.findNearestEnemy(self.position, enemies);
        return {
          type: 'attack',
          targetUnitId: nearest.id,
          details: 'Attacking as commanded',
        };
      }
      // No visible enemy but commanded to attack: move toward a direction
      const angle = Math.random() * Math.PI * 2;
      return {
        type: 'move',
        target: {
          col: Math.max(0, Math.round(self.position.col + Math.cos(angle) * 3)),
          row: Math.max(0, Math.round(self.position.row + Math.sin(angle) * 3)),
        },
        details: 'Moving to find attack target',
      };
    }

    // If enemy visible within 3 tiles, engage
    if (enemies.length > 0) {
      const nearest = AgentController.findNearestEnemy(self.position, enemies);
      const dist = Math.sqrt(
        nearest.relativePosition.dx ** 2 + nearest.relativePosition.dy ** 2
      );
      if (dist <= 3) {
        return {
          type: 'attack',
          targetUnitId: nearest.id,
          details: 'Engaging nearby enemy',
        };
      }
    }

    return { type: 'idle' };
  }

  private messengerAction(
    self: UnitPerception['self'],
    command: string
  ): UnitAction {
    if (command) {
      // Try to extract a destination from command, otherwise pick a direction
      const angle = Math.random() * Math.PI * 2;
      return {
        type: 'move',
        target: {
          col: Math.max(0, Math.round(self.position.col + Math.cos(angle) * 4)),
          row: Math.max(0, Math.round(self.position.row + Math.sin(angle) * 4)),
        },
        details: `Carrying message: ${command}`,
      };
    }

    return { type: 'idle' };
  }

  private siegeAction(
    self: UnitPerception['self'],
    enemies: UnitPerception['visibleUnits']
  ): UnitAction {
    // If enemy visible within vision range, attack
    if (enemies.length > 0) {
      const nearest = AgentController.findNearestEnemy(self.position, enemies);
      return {
        type: 'attack',
        targetUnitId: nearest.id,
        details: 'Bombarding enemy',
      };
    }

    return { type: 'idle' };
  }

  private captainAction(
    self: UnitPerception['self'],
    friendlies: UnitPerception['visibleUnits']
  ): UnitAction {
    // If friendly soldiers are nearby, issue orders
    const nearbySoldiers = friendlies.filter(
      u => u.type === UnitType.SOLDIER || u.type === UnitType.SIEGE
    );

    if (nearbySoldiers.length > 0) {
      return {
        type: 'communicate',
        message: 'Hold position and watch for enemies',
        details: `Commanding ${nearbySoldiers.length} nearby combat units`,
      };
    }

    return { type: 'idle' };
  }

  private spyAction(
    self: UnitPerception['self'],
    enemies: UnitPerception['visibleUnits']
  ): UnitAction {
    // If enemy visible, report intel
    if (enemies.length > 0) {
      const enemy = enemies[0];
      return {
        type: 'communicate',
        message: `Intel: Enemy ${enemy.type} at ${enemy.gridLabel}`,
        details: 'Relaying intelligence',
      };
    }

    // Otherwise move toward map center (assume 40x40 map, center at 20,20)
    const centerCol = 20;
    const centerRow = 20;
    const dx = centerCol - self.position.col;
    const dy = centerRow - self.position.row;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < 2) {
      // Already near center, wander slightly
      return {
        type: 'move',
        target: {
          col: self.position.col + Math.round((Math.random() - 0.5) * 4),
          row: self.position.row + Math.round((Math.random() - 0.5) * 4),
        },
        details: 'Patrolling near center',
      };
    }

    // Move a few tiles toward center
    const step = 3;
    const normDx = dx / dist;
    const normDy = dy / dist;

    return {
      type: 'move',
      target: {
        col: Math.max(0, Math.round(self.position.col + normDx * step)),
        row: Math.max(0, Math.round(self.position.row + normDy * step)),
      },
      details: 'Moving toward map center for recon',
    };
  }

  // ---- Helpers ----

  /**
   * Find the nearest visible resource tile and return its grid position.
   */
  static findNearestResource(
    selfPos: GridPosition,
    terrain: UnitPerception['visibleTerrain']
  ): GridPosition | null {
    const resources = terrain.filter(t => t.hasResource);
    if (resources.length === 0) return null;

    let closest = resources[0];
    let closestDist = Math.abs(closest.relativePosition.dx) + Math.abs(closest.relativePosition.dy);

    for (let i = 1; i < resources.length; i++) {
      const dist = Math.abs(resources[i].relativePosition.dx) + Math.abs(resources[i].relativePosition.dy);
      if (dist < closestDist) {
        closest = resources[i];
        closestDist = dist;
      }
    }

    return {
      col: selfPos.col + closest.relativePosition.dx,
      row: selfPos.row + closest.relativePosition.dy,
    };
  }

  /**
   * Find the nearest enemy unit from the visible units list.
   */
  static findNearestEnemy(
    selfPos: GridPosition,
    enemies: UnitPerception['visibleUnits']
  ): UnitPerception['visibleUnits'][0] {
    let nearest = enemies[0];
    let nearestDist = Math.sqrt(
      nearest.relativePosition.dx ** 2 + nearest.relativePosition.dy ** 2
    );

    for (let i = 1; i < enemies.length; i++) {
      const dist = Math.sqrt(
        enemies[i].relativePosition.dx ** 2 + enemies[i].relativePosition.dy ** 2
      );
      if (dist < nearestDist) {
        nearest = enemies[i];
        nearestDist = dist;
      }
    }

    return nearest;
  }

  /**
   * Format a UnitPerception into a human-readable prompt string suitable
   * for sending to an LLM. Useful for debugging and future LLM integration.
   *
   * @param perception - The unit's world perception
   * @returns Formatted prompt string
   */
  formatPerception(perception: UnitPerception): string {
    const { self, visibleUnits, visibleTerrain, recentAuditLog, currentCommand, nearbyMessages } = perception;

    const lines: string[] = [];

    lines.push(`You are a ${self.type.toUpperCase()} unit at position ${self.gridLabel}.`);
    lines.push(`Health: ${self.health}/${self.maxHealth} | Energy: ${self.energy}/${self.maxEnergy}`);

    if (self.afflictions.length > 0) {
      const afflictionStr = self.afflictions
        .map(a => `${a.type}(${a.duration} ticks)`)
        .join(', ');
      lines.push(`Afflictions: ${afflictionStr}`);
    }

    lines.push('');
    lines.push(`Current command: ${currentCommand || 'None'}`);
    lines.push('');

    // Visible units
    if (visibleUnits.length > 0) {
      lines.push('Visible units:');
      for (const unit of visibleUnits) {
        const relation = unit.isFriendly ? 'friendly' : 'enemy';
        const healthStr = `${Math.round(unit.healthPercent * 100)}%`;
        lines.push(`  - ${unit.type} at ${unit.gridLabel} (${relation}, ${healthStr} hp)`);
      }
    } else {
      lines.push('Visible units: None');
    }
    lines.push('');

    // Visible terrain of interest (resources, obstacles)
    const notableTerrain = visibleTerrain.filter(t => t.hasResource || !t.walkable);
    if (notableTerrain.length > 0) {
      lines.push('Notable terrain:');
      for (const tile of notableTerrain) {
        const parts: string[] = [tile.type];
        if (tile.hasResource && tile.resourceType) {
          parts.push(`resource: ${tile.resourceType}`);
        }
        if (!tile.walkable) {
          parts.push('impassable');
        }
        lines.push(`  - ${tile.gridLabel}: ${parts.join(', ')}`);
      }
    } else {
      lines.push('Notable terrain: None');
    }
    lines.push('');

    // Recent messages
    if (nearbyMessages.length > 0) {
      lines.push('Recent messages:');
      for (const msg of nearbyMessages) {
        lines.push(`  - From ${msg.fromUnitId}: "${msg.content}"`);
      }
    } else {
      lines.push('Recent messages: None');
    }
    lines.push('');

    // Audit log (last 5 entries)
    const recentEntries = recentAuditLog.slice(-5);
    if (recentEntries.length > 0) {
      lines.push('Recent events:');
      for (const entry of recentEntries) {
        lines.push(`  - [tick ${entry.tick}] ${entry.type}: ${entry.message}`);
      }
    } else {
      lines.push('Recent events: None');
    }
    lines.push('');

    lines.push('What action do you take?');

    return lines.join('\n');
  }
}
