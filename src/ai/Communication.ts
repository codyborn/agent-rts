import {
  UnitMessage,
  UnitState,
  GameEventType,
  GridPosition,
  gridDistance,
  UNIT_COMMUNICATION_RANGE,
  BASE_COMMAND_RANGE,
  positionToLabel,
} from '../shared/types';
import { EventBus } from '../engine/EventBus';

// ============================================================
// Communication - Inter-unit and player-to-unit messaging
// Handles direct messages, proximity broadcasts, player voice
// commands with range limits, and audit log sharing between
// friendly units.
// ============================================================

/** Minimal unit info needed for communication operations */
interface CommUnit {
  id: string;
  position: GridPosition;
  playerId: string;
}

/** Extended unit info that includes homeBase for command range checks */
interface CommandableUnit extends CommUnit {
  homeBase: GridPosition | null;
}

/** Unit info that includes audit log for intelligence sharing */
interface AuditableUnit extends CommUnit {
  auditLog: Array<{ type: string; message: string; tick: number }>;
}

export class Communication {
  private readonly eventBus: EventBus;
  private messages: UnitMessage[] = [];
  private messageIdCounter = 0;

  constructor(eventBus: EventBus) {
    this.eventBus = eventBus;
  }

  /**
   * Send a direct message from one unit to another (or broadcast if toUnitId is null).
   *
   * @param fromUnit - The sending unit
   * @param toUnitId - Target unit ID, or null for nearby broadcast
   * @param content - Message text
   * @param tick - Current simulation tick
   * @param type - Message type classification
   * @returns The created UnitMessage
   */
  sendMessage(
    fromUnit: CommUnit,
    toUnitId: string | null,
    content: string,
    tick: number,
    type: UnitMessage['type'] = 'communication'
  ): UnitMessage {
    const message: UnitMessage = {
      id: `msg_${this.messageIdCounter++}`,
      fromUnitId: fromUnit.id,
      toUnitId,
      content,
      tick,
      position: { ...fromUnit.position },
      type,
    };

    this.messages.push(message);
    this.eventBus.emit(GameEventType.UNIT_COMMUNICATION, message);

    return message;
  }

  /**
   * Broadcast a message to all friendly units within a given range.
   *
   * @param fromUnit - The broadcasting unit
   * @param content - Message text
   * @param range - Maximum distance (tiles) for the broadcast
   * @param allUnits - All units to consider as recipients
   * @param tick - Current simulation tick
   * @returns Array of messages sent (one per recipient)
   */
  broadcastNearby(
    fromUnit: CommUnit,
    content: string,
    range: number,
    allUnits: CommUnit[],
    tick: number
  ): UnitMessage[] {
    const sent: UnitMessage[] = [];

    for (const unit of allUnits) {
      // Skip self
      if (unit.id === fromUnit.id) continue;
      // Only same player
      if (unit.playerId !== fromUnit.playerId) continue;
      // Within range
      if (gridDistance(fromUnit.position, unit.position) > range) continue;

      const msg = this.sendMessage(fromUnit, unit.id, content, tick, 'communication');
      sent.push(msg);
    }

    return sent;
  }

  /**
   * Send a player command to target units, respecting base command range.
   * Units that are too far from their home base will not receive the command,
   * and a UNIT_REPORT event is emitted for the player's information.
   *
   * @param playerId - The commanding player's ID
   * @param content - Command text (from voice or typed input)
   * @param targetUnits - Units the player intends to command
   * @param tick - Current simulation tick
   * @returns Array of messages successfully delivered
   */
  sendPlayerCommand(
    playerId: string,
    content: string,
    targetUnits: CommandableUnit[],
    tick: number
  ): UnitMessage[] {
    const sent: UnitMessage[] = [];

    // Virtual "player" sender positioned at origin (commands come from base)
    const playerSender: CommUnit = {
      id: `player_${playerId}`,
      position: { col: 0, row: 0 }, // will be overridden per-unit
      playerId,
    };

    for (const unit of targetUnits) {
      // Only command own units
      if (unit.playerId !== playerId) continue;

      // Check command range from home base
      if (unit.homeBase) {
        const distFromBase = gridDistance(unit.position, unit.homeBase);
        if (distFromBase > BASE_COMMAND_RANGE) {
          this.eventBus.emit(GameEventType.UNIT_REPORT, {
            message: `Unit ${unit.id} is too far from base to receive commands`,
          });
          continue;
        }
        // Position the "sender" at the unit's home base for the message record
        playerSender.position = { ...unit.homeBase };
      }

      const msg = this.sendMessage(playerSender, unit.id, content, tick, 'command');
      sent.push(msg);
    }

    return sent;
  }

  /**
   * Get all messages addressed to a specific unit (or broadcast messages).
   *
   * @param unitId - The unit to get messages for
   * @param sinceTick - If provided, only return messages from this tick onward
   * @returns Matching messages
   */
  getMessagesForUnit(unitId: string, sinceTick?: number): UnitMessage[] {
    return this.messages.filter(msg => {
      // Message is addressed to this unit or is a broadcast
      const isRelevant = msg.toUnitId === unitId || msg.toUnitId === null;
      if (!isRelevant) return false;

      // Filter by tick if specified
      if (sinceTick !== undefined && msg.tick < sinceTick) return false;

      return true;
    });
  }

  /**
   * Share relevant observations from one unit's audit log with another unit.
   * Filters for observation entries that mention enemies, and sends the
   * last 3 relevant entries as communication messages.
   *
   * @param fromUnit - The unit sharing its audit log
   * @param toUnitId - The recipient unit's ID
   * @param tick - Current simulation tick
   */
  shareAuditLog(
    fromUnit: AuditableUnit,
    toUnitId: string,
    tick: number
  ): void {
    // Filter for observation entries mentioning enemies
    const relevantEntries = fromUnit.auditLog.filter(
      entry =>
        entry.type === 'observation' &&
        (entry.message.toLowerCase().includes('enemy') ||
         entry.message.toLowerCase().includes('spotted'))
    );

    // Take only the last 3 to avoid spam
    const entriesToShare = relevantEntries.slice(-3);

    for (const entry of entriesToShare) {
      this.sendMessage(
        fromUnit,
        toUnitId,
        `[Intel from tick ${entry.tick}] ${entry.message}`,
        tick,
        'communication'
      );
    }
  }

  /**
   * Remove all messages older than the given tick.
   * Call this periodically to prevent unbounded memory growth.
   *
   * @param beforeTick - Messages with tick < this value are removed
   */
  cleanupOldMessages(beforeTick: number): void {
    this.messages = this.messages.filter(msg => msg.tick >= beforeTick);
  }

  /**
   * Get a copy of all messages in the system.
   */
  getAllMessages(): UnitMessage[] {
    return [...this.messages];
  }

  /**
   * Get the most recent N messages (default 50).
   */
  getRecentMessages(count: number = 50): UnitMessage[] {
    return this.messages.slice(-count);
  }
}
