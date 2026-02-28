import {
  UnitState,
  UnitType,
  UnitStats,
  UnitBehaviorState,
  ResourceType,
  GridPosition,
  Affliction,
  AuditLogEntry,
  UNIT_STATS,
  positionToLabel,
  gridDistance,
  BASE_COMMAND_RANGE,
  UNIT_COMMUNICATION_RANGE,
} from '../shared/types';

// ============================================================
// Unit - Individual unit wrapper around UnitState
// Provides behaviour methods for movement, combat, energy,
// pathfinding, communication, and audit logging.
// ============================================================

const MAX_AUDIT_LOG_ENTRIES = 50;

export class Unit {
  // ---- Core identity ----
  public readonly id: string;
  public readonly type: UnitType;
  public readonly playerId: string;

  // ---- Mutable state ----
  public position: GridPosition;
  public health: number;
  public energy: number;
  public afflictions: Affliction[];
  public currentCommand: string | null;
  public auditLog: AuditLogEntry[];
  public isSelected: boolean;
  public path: GridPosition[] | null;
  public targetPosition: GridPosition | null;
  public autoReturn: boolean;
  public homeBase: GridPosition | null;
  public inSiegeMode: boolean;
  public lastActionTick: number;

  // Behavior state machine
  public behaviorState: UnitBehaviorState;

  // Gathering
  public gatherTarget: GridPosition | null;
  public carryingType: ResourceType | null;
  public carryingAmount: number;
  public gatherProgress: number;

  // Combat
  public attackTargetId: string | null;
  public attackCooldown: number;

  // AI
  public lastThought: string | null;

  // Rendering
  public facingDirection: 'left' | 'right' = 'right';

  // Smooth movement interpolation
  public previousPosition: GridPosition | null = null;
  public moveStartTime: number = 0;

  // Per-unit vision tracking (for heat map overlay)
  public visionHistory: Map<string, number> = new Map();

  constructor(
    id: string,
    type: UnitType,
    playerId: string,
    position: GridPosition,
  ) {
    const stats = UNIT_STATS[type];

    this.id = id;
    this.type = type;
    this.playerId = playerId;
    this.position = { col: position.col, row: position.row };
    this.health = stats.maxHealth;
    this.energy = stats.maxEnergy;
    this.afflictions = [];
    this.currentCommand = null;
    this.auditLog = [];
    this.isSelected = false;
    this.path = null;
    this.targetPosition = null;
    this.autoReturn = false;
    this.homeBase = null;
    this.inSiegeMode = false;
    this.lastActionTick = 0;

    this.behaviorState = UnitBehaviorState.IDLE;
    this.gatherTarget = null;
    this.carryingType = null;
    this.carryingAmount = 0;
    this.gatherProgress = 0;
    this.attackTargetId = null;
    this.attackCooldown = 0;
    this.lastThought = null;
  }

  // ---- Queries ----

  /** Return the static stat block for this unit's type. */
  getStats(): UnitStats {
    return UNIT_STATS[this.type];
  }

  /** Human-readable grid label for the unit's current position (e.g. "N15"). */
  getGridLabel(): string {
    return positionToLabel(this.position);
  }

  /** Whether the unit is still alive. */
  isAlive(): boolean {
    return this.health > 0;
  }

  /** Whether the unit is within BASE_COMMAND_RANGE of its home base. */
  isNearBase(): boolean {
    if (!this.homeBase) return false;
    return gridDistance(this.position, this.homeBase) <= BASE_COMMAND_RANGE;
  }

  /** Whether this unit can communicate with a position (within UNIT_COMMUNICATION_RANGE). */
  canCommunicateWith(otherPosition: GridPosition): boolean {
    return gridDistance(this.position, otherPosition) <= UNIT_COMMUNICATION_RANGE;
  }

  // ---- Audit log ----

  /**
   * Append a message to the unit's audit log.
   * Tick is initialised to 0 here and is expected to be overwritten
   * externally by the engine with the correct simulation tick.
   */
  addAuditLog(
    message: string,
    source: string,
    type: AuditLogEntry['type'],
  ): void {
    this.auditLog.push({
      tick: 0,
      timestamp: Date.now(),
      message,
      source,
      type,
    });

    // Keep only the most recent entries.
    if (this.auditLog.length > MAX_AUDIT_LOG_ENTRIES) {
      this.auditLog = this.auditLog.slice(-MAX_AUDIT_LOG_ENTRIES);
    }
  }

  // ---- Commands & movement ----

  /** Set the unit's current command string and record it in the audit log. */
  setCommand(command: string): void {
    this.currentCommand = command;
    this.addAuditLog(`Command received: ${command}`, this.id, 'command');
  }

  /** Set a target position for the unit to move towards. */
  moveTo(target: GridPosition): void {
    this.targetPosition = { col: target.col, row: target.row };
  }

  /** Assign a pre-computed path for the unit to follow. */
  setPath(path: GridPosition[]): void {
    this.path = path.map((p) => ({ col: p.col, row: p.row }));
  }

  /**
   * Advance one step along the current path.
   * Stores previous position for smooth rendering interpolation.
   * Returns the new position or null if there is no path to follow.
   */
  advanceOnPath(): GridPosition | null {
    if (!this.path || this.path.length === 0) {
      return null;
    }

    const next = this.path.shift()!;
    // Store previous position for smooth interpolation
    this.previousPosition = { col: this.position.col, row: this.position.row };
    this.moveStartTime = performance.now();
    // Update facing direction based on horizontal movement
    if (next.col > this.position.col) {
      this.facingDirection = 'right';
    } else if (next.col < this.position.col) {
      this.facingDirection = 'left';
    }
    this.position = { col: next.col, row: next.row };

    if (this.path.length === 0) {
      this.path = null;
      this.targetPosition = null;
    }

    return this.position;
  }

  // ---- Combat & healing ----

  /**
   * Apply damage to the unit after defense mitigation.
   * Minimum damage is always 1.
   * Returns the actual amount of damage dealt.
   */
  takeDamage(amount: number): number {
    const actualDamage = Math.max(1, amount - this.getStats().defense / 2);
    this.health = Math.max(0, this.health - actualDamage);
    return actualDamage;
  }

  /** Heal the unit, capped at its maximum health. */
  heal(amount: number): void {
    this.health = Math.min(this.getStats().maxHealth, this.health + amount);
  }

  // ---- Energy ----

  /**
   * Attempt to spend energy.
   * Returns true and deducts the cost if the unit has enough energy,
   * otherwise returns false without modifying energy.
   */
  useEnergy(amount: number): boolean {
    if (this.energy >= amount) {
      this.energy -= amount;
      return true;
    }
    return false;
  }

  // ---- Serialisation ----

  /** Return a plain-object snapshot of the unit's full state. */
  toState(): UnitState {
    return {
      id: this.id,
      type: this.type,
      playerId: this.playerId,
      position: { col: this.position.col, row: this.position.row },
      health: this.health,
      energy: this.energy,
      afflictions: this.afflictions.map((a) => ({ ...a })),
      currentCommand: this.currentCommand,
      auditLog: this.auditLog.map((e) => ({ ...e })),
      isSelected: this.isSelected,
      path: this.path ? this.path.map((p) => ({ col: p.col, row: p.row })) : null,
      targetPosition: this.targetPosition
        ? { col: this.targetPosition.col, row: this.targetPosition.row }
        : null,
      autoReturn: this.autoReturn,
      homeBase: this.homeBase
        ? { col: this.homeBase.col, row: this.homeBase.row }
        : null,
      inSiegeMode: this.inSiegeMode,
      lastActionTick: this.lastActionTick,

      behaviorState: this.behaviorState,
      gatherTarget: this.gatherTarget
        ? { col: this.gatherTarget.col, row: this.gatherTarget.row }
        : null,
      carryingType: this.carryingType,
      carryingAmount: this.carryingAmount,
      gatherProgress: this.gatherProgress,
      attackTargetId: this.attackTargetId,
      attackCooldown: this.attackCooldown,
      lastThought: this.lastThought,
      facingDirection: this.facingDirection,
      previousPosition: this.previousPosition
        ? { col: this.previousPosition.col, row: this.previousPosition.row }
        : null,
      moveStartTime: this.moveStartTime,
    };
  }
}
