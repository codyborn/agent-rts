import { GameConfig, GameEventType } from '../shared/types';
import { EventBus } from './EventBus';
import { GameState } from './GameState';
import { CommandQueue } from './CommandQueue';

// ============================================================
// GameEngine - Main game loop with fixed-timestep simulation
// ============================================================
// The engine owns the authoritative GameState, an EventBus for
// decoupled communication, and a CommandQueue for deterministic
// multiplayer-ready command processing.
//
// Systems are registered in order and updated each tick. The
// fixed timestep ensures that simulation results are identical
// regardless of frame rate, which is critical for lock-step
// networking and replay.
// ============================================================

/**
 * A System is a self-contained module that operates on the
 * GameState each tick. Systems are updated in registration order.
 */
export interface System {
  /** Called once when the system is registered with the engine. */
  init(engine: GameEngine): void;

  /**
   * Called every simulation tick.
   * @param tick - The current simulation tick number.
   * @param deltaTime - Fixed time step in seconds (1 / tickRate).
   */
  update(tick: number, deltaTime: number): void;
}

export class GameEngine {
  public readonly eventBus: EventBus;
  public readonly state: GameState;
  public readonly commands: CommandQueue;
  public readonly config: GameConfig;

  /** Ordered list of (name, system) pairs -- iteration order matters. */
  private systems: Map<string, System> = new Map();

  private running = false;
  private paused = false;
  private currentTick = 0;
  private lastTimestamp = 0;
  private accumulator = 0;

  /** Callback invoked every animation frame (for rendering). */
  public onFrame: (() => void) | null = null;

  /** Bound reference to the loop function for requestAnimationFrame. */
  private boundGameLoop: (timestamp: number) => void;

  constructor(config: GameConfig) {
    this.config = config;
    this.eventBus = new EventBus();
    this.state = new GameState();
    this.commands = new CommandQueue();
    this.boundGameLoop = this.gameLoop.bind(this);
  }

  // ---- System Management ------------------------------------

  /**
   * Register a named system. The system's `init` method is called
   * immediately with a reference to this engine. Systems are
   * updated each tick in registration order.
   */
  registerSystem(name: string, system: System): void {
    this.systems.set(name, system);
    system.init(this);
  }

  /**
   * Retrieve a previously registered system by name. Throws if
   * the system has not been registered.
   */
  getSystem<T extends System>(name: string): T {
    const system = this.systems.get(name);
    if (!system) {
      throw new Error(`System "${name}" is not registered.`);
    }
    return system as T;
  }

  // ---- Lifecycle --------------------------------------------

  /** Start the simulation loop. */
  start(): void {
    if (this.running) {
      return;
    }

    this.running = true;
    this.paused = false;
    this.lastTimestamp = 0;
    this.accumulator = 0;

    this.eventBus.emit(GameEventType.GAME_START, { tick: this.currentTick });
    requestAnimationFrame(this.boundGameLoop);
  }

  /** Stop the simulation loop entirely. */
  stop(): void {
    this.running = false;
  }

  /** Pause the simulation. The loop continues running but no ticks advance. */
  pause(): void {
    if (!this.paused) {
      this.paused = true;
      this.eventBus.emit(GameEventType.GAME_PAUSE, { tick: this.currentTick });
    }
  }

  /** Resume a paused simulation. */
  resume(): void {
    if (this.paused) {
      this.paused = false;
      // Reset the timestamp so we don't get a huge delta on resume.
      this.lastTimestamp = 0;
      this.eventBus.emit(GameEventType.GAME_RESUME, { tick: this.currentTick });
    }
  }

  /** Return the current simulation tick number. */
  getCurrentTick(): number {
    return this.currentTick;
  }

  /** Whether the engine is currently running. */
  isRunning(): boolean {
    return this.running;
  }

  /** Whether the engine is currently paused. */
  isPaused(): boolean {
    return this.paused;
  }

  // ---- Game Loop --------------------------------------------

  /**
   * Core loop driven by `requestAnimationFrame`. Uses a fixed
   * timestep accumulator so the simulation advances in discrete,
   * deterministic ticks regardless of the browser's frame rate.
   */
  private gameLoop(timestamp: number): void {
    if (!this.running) {
      return;
    }

    // On the very first frame (or after resume) we have no previous
    // timestamp, so just seed it and schedule the next frame.
    if (this.lastTimestamp === 0) {
      this.lastTimestamp = timestamp;
      requestAnimationFrame(this.boundGameLoop);
      return;
    }

    const deltaTime = timestamp - this.lastTimestamp;
    this.lastTimestamp = timestamp;

    // While paused, keep the animation frame alive but skip simulation.
    if (this.paused) {
      requestAnimationFrame(this.boundGameLoop);
      return;
    }

    this.accumulator += deltaTime;

    const tickInterval = 1000 / this.config.tickRate;

    while (this.accumulator >= tickInterval) {
      // Synchronize the event bus tick before anything fires.
      this.eventBus.setTick(this.currentTick);

      // Drain all commands scheduled for this tick.
      const tickCommands = this.commands.getCommandsForTick(this.currentTick);
      for (const command of tickCommands) {
        this.eventBus.emit(GameEventType.PLAYER_COMMAND, command);
      }

      // Update every system in registration order.
      const dtSeconds = tickInterval / 1000;
      for (const system of this.systems.values()) {
        system.update(this.currentTick, dtSeconds);
      }

      // Broadcast the tick event for any listeners (UI, logging, etc.).
      this.eventBus.emit(GameEventType.TICK, { tick: this.currentTick });

      this.currentTick++;
      this.accumulator -= tickInterval;
    }

    // Call the render callback every frame (not just every tick).
    if (this.onFrame) {
      this.onFrame();
    }

    requestAnimationFrame(this.boundGameLoop);
  }
}
