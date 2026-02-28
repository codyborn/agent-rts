// ============================================================
// Agent RTS - A* Pathfinding
// 6-directional hex pathfinding with binary heap priority queue
// ============================================================

import { GridPosition, UnitType } from '../shared/types';
import { hexDistance } from '../hex/HexUtils';

/** Maximum number of nodes to expand before giving up on a path search. */
const MAX_NODES = 2000;

// ============ Binary Min-Heap Priority Queue ============

/**
 * A min-heap priority queue keyed by a numeric priority value.
 * Used internally by the A* algorithm to efficiently select the
 * lowest-cost open node.
 */
class MinHeap<T> {
  private heap: Array<{ priority: number; value: T }> = [];

  get size(): number {
    return this.heap.length;
  }

  /**
   * Inserts a value with the given priority.
   */
  push(priority: number, value: T): void {
    this.heap.push({ priority, value });
    this.bubbleUp(this.heap.length - 1);
  }

  /**
   * Removes and returns the value with the lowest priority.
   * Returns undefined if the heap is empty.
   */
  pop(): T | undefined {
    if (this.heap.length === 0) return undefined;

    const top = this.heap[0];
    const last = this.heap.pop()!;

    if (this.heap.length > 0) {
      this.heap[0] = last;
      this.sinkDown(0);
    }

    return top.value;
  }

  private bubbleUp(index: number): void {
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (this.heap[index].priority < this.heap[parent].priority) {
        this.swap(index, parent);
        index = parent;
      } else {
        break;
      }
    }
  }

  private sinkDown(index: number): void {
    const length = this.heap.length;
    while (true) {
      const left = 2 * index + 1;
      const right = 2 * index + 2;
      let smallest = index;

      if (left < length && this.heap[left].priority < this.heap[smallest].priority) {
        smallest = left;
      }
      if (right < length && this.heap[right].priority < this.heap[smallest].priority) {
        smallest = right;
      }

      if (smallest !== index) {
        this.swap(index, smallest);
        index = smallest;
      } else {
        break;
      }
    }
  }

  private swap(a: number, b: number): void {
    const tmp = this.heap[a];
    this.heap[a] = this.heap[b];
    this.heap[b] = tmp;
  }
}

// ============ Heuristic ============

/**
 * Hex distance heuristic for 6-directional hex grid movement.
 * Admissible and consistent for uniform-cost hex grids.
 */
function hexDistanceHeuristic(a: GridPosition, b: GridPosition): number {
  return hexDistance(a, b);
}

// ============ Position Key ============

function posKey(pos: GridPosition): string {
  return `${pos.col},${pos.row}`;
}

// ============ A* Pathfinding ============

/**
 * Map query interface required by the pathfinder. This is satisfied
 * by the GameMap class, allowing loose coupling between modules.
 */
export interface MapQuery {
  isWalkable(pos: GridPosition): boolean;
  getMovementCost(pos: GridPosition, unitType?: UnitType): number;
  isInBounds(pos: GridPosition): boolean;
  getNeighbors(pos: GridPosition): GridPosition[];
}

/**
 * Finds the shortest path between two grid positions using the A* algorithm
 * with octile distance heuristic and 8-directional movement.
 *
 * @param start - Starting position (excluded from the returned path)
 * @param end - Destination position (included in the returned path)
 * @param mapQuery - Object providing map topology queries (walkability, cost, neighbors)
 * @param unitType - Optional unit type for terrain-specific movement cost bonuses
 * @returns An ordered array of GridPositions from the first step after start to end (inclusive).
 *          Returns an empty array if start equals end, end is unreachable, or the search
 *          exceeds MAX_NODES (2000) expansions.
 *
 * @example
 * ```typescript
 * const path = findPath(
 *   { col: 0, row: 0 },
 *   { col: 5, row: 5 },
 *   gameMap,
 *   UnitType.SCOUT
 * );
 * // path[0] is the first tile to move to
 * // path[path.length - 1] is { col: 5, row: 5 }
 * ```
 */
export function findPath(
  start: GridPosition,
  end: GridPosition,
  mapQuery: MapQuery,
  unitType?: UnitType,
): GridPosition[] {
  // Early exit: same position
  if (start.col === end.col && start.row === end.row) {
    return [];
  }

  // Early exit: destination is not walkable or out of bounds
  if (!mapQuery.isInBounds(end) || !mapQuery.isWalkable(end)) {
    return [];
  }

  // Early exit: start is not in bounds
  if (!mapQuery.isInBounds(start)) {
    return [];
  }

  const openSet = new MinHeap<GridPosition>();
  const closedSet = new Set<string>();
  const gScore = new Map<string, number>();
  const cameFrom = new Map<string, GridPosition>();

  const startKey = posKey(start);
  gScore.set(startKey, 0);
  openSet.push(hexDistanceHeuristic(start, end), start);

  let nodesExpanded = 0;

  while (openSet.size > 0) {
    const current = openSet.pop()!;
    const currentKey = posKey(current);

    // Goal reached -- reconstruct path
    if (current.col === end.col && current.row === end.row) {
      return reconstructPath(cameFrom, current, start);
    }

    // Skip if already processed (the heap may contain stale entries)
    if (closedSet.has(currentKey)) {
      continue;
    }
    closedSet.add(currentKey);

    nodesExpanded++;
    if (nodesExpanded > MAX_NODES) {
      return [];
    }

    const currentG = gScore.get(currentKey)!;
    const neighbors = mapQuery.getNeighbors(current);

    for (const neighbor of neighbors) {
      const neighborKey = posKey(neighbor);
      if (closedSet.has(neighborKey)) continue;
      if (!mapQuery.isWalkable(neighbor)) continue;

      // Hex neighbors are all equidistant — uniform step cost
      const terrainCost = mapQuery.getMovementCost(neighbor, unitType);
      if (!isFinite(terrainCost)) continue; // Impassable

      const tentativeG = currentG + terrainCost;

      const previousG = gScore.get(neighborKey);
      if (previousG !== undefined && tentativeG >= previousG) {
        continue;
      }

      gScore.set(neighborKey, tentativeG);
      cameFrom.set(neighborKey, current);

      const f = tentativeG + hexDistanceHeuristic(neighbor, end);
      openSet.push(f, neighbor);
    }
  }

  // No path found
  return [];
}

/**
 * Reconstructs the path from end to start by walking the cameFrom map,
 * then reverses it. The start position is excluded from the result.
 */
function reconstructPath(
  cameFrom: Map<string, GridPosition>,
  end: GridPosition,
  start: GridPosition,
): GridPosition[] {
  const path: GridPosition[] = [];
  let current: GridPosition | undefined = end;

  while (current) {
    // Do not include the start position in the returned path
    if (current.col === start.col && current.row === start.row) {
      break;
    }
    path.push(current);
    current = cameFrom.get(posKey(current));
  }

  path.reverse();
  return path;
}
