import { GameEventType } from '../shared/types';

// ============================================================
// EventBus - Core event system for the RTS engine
// Designed for multiplayer: all events are logged with tick numbers
// for deterministic replay and network synchronization.
// ============================================================

export type EventHandler<T = unknown> = (data: T) => void;

export interface GameEvent {
  type: GameEventType;
  data: unknown;
  tick: number;
  timestamp: number;
}

export class EventBus {
  private handlers = new Map<GameEventType, Set<EventHandler>>();
  private eventLog: GameEvent[] = [];
  private currentTick = 0;

  /** Update the current tick (called by GameEngine each simulation step) */
  setTick(tick: number): void {
    this.currentTick = tick;
  }

  getTick(): number {
    return this.currentTick;
  }

  /** Subscribe to an event. Returns an unsubscribe function. */
  on<T = unknown>(event: GameEventType, handler: EventHandler<T>): () => void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler as EventHandler);
    return () => this.off(event, handler);
  }

  /** Subscribe to an event, auto-unsubscribe after first trigger. */
  once<T = unknown>(event: GameEventType, handler: EventHandler<T>): () => void {
    const wrapper: EventHandler<T> = (data) => {
      handler(data);
      this.off(event, wrapper);
    };
    return this.on(event, wrapper);
  }

  /** Unsubscribe a handler from an event. */
  off<T = unknown>(event: GameEventType, handler: EventHandler<T>): void {
    this.handlers.get(event)?.delete(handler as EventHandler);
  }

  /** Emit an event. All handlers are called synchronously. Event is logged. */
  emit<T = unknown>(event: GameEventType, data: T): void {
    const gameEvent: GameEvent = {
      type: event,
      data,
      tick: this.currentTick,
      timestamp: Date.now(),
    };
    this.eventLog.push(gameEvent);

    const handlers = this.handlers.get(event);
    if (handlers) {
      for (const handler of handlers) {
        handler(data);
      }
    }
  }

  /** Get a copy of the full event log (for replay / debugging). */
  getLog(): GameEvent[] {
    return [...this.eventLog];
  }

  /** Get events from the log filtered by type. */
  getLogByType(type: GameEventType): GameEvent[] {
    return this.eventLog.filter(e => e.type === type);
  }

  /** Clear the event log. */
  clearLog(): void {
    this.eventLog = [];
  }

  /** Remove all handlers. */
  removeAllListeners(): void {
    this.handlers.clear();
  }
}
