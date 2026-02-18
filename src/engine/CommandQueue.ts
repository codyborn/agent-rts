import { GameCommand } from '../shared/types';

// ============================================================
// CommandQueue - Deterministic command processing
// ============================================================
// All player and AI commands are scheduled to execute on a
// specific simulation tick. The queue keeps commands sorted by
// tick so the engine can drain them in order during the game
// loop. This is the foundation for lock-step multiplayer: every
// client processes the same commands on the same tick.
// ============================================================

export class CommandQueue {
  private commandQueue: GameCommand[] = [];

  /**
   * Add a command to the queue. The queue is kept sorted by tick
   * in ascending order so that `getCommandsForTick` can drain
   * efficiently from the front.
   */
  addCommand(command: GameCommand): void {
    // Binary search for the correct insertion index to maintain sort order.
    let low = 0;
    let high = this.commandQueue.length;

    while (low < high) {
      const mid = (low + high) >>> 1;
      if (this.commandQueue[mid].tick <= command.tick) {
        low = mid + 1;
      } else {
        high = mid;
      }
    }

    this.commandQueue.splice(low, 0, command);
  }

  /**
   * Return and remove all commands scheduled for the given tick.
   * Commands are returned in insertion order (stable within the
   * same tick).
   */
  getCommandsForTick(tick: number): GameCommand[] {
    const commands: GameCommand[] = [];

    // Commands are sorted by tick. Walk from the front and collect
    // all entries whose tick matches, stopping as soon as we see a
    // tick that is greater.
    while (this.commandQueue.length > 0 && this.commandQueue[0].tick === tick) {
      commands.push(this.commandQueue.shift()!);
    }

    return commands;
  }

  /**
   * Peek at the tick number of the earliest queued command without
   * removing it. Returns null when the queue is empty.
   */
  peekNextTick(): number | null {
    if (this.commandQueue.length === 0) {
      return null;
    }
    return this.commandQueue[0].tick;
  }

  /** Remove all queued commands. */
  clear(): void {
    this.commandQueue = [];
  }

  /** Number of commands currently in the queue. */
  size(): number {
    return this.commandQueue.length;
  }
}
