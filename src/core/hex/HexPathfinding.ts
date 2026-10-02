import type { HexCoord } from './HexCoord';
import type { HexGrid } from './HexGrid';

/** Cost of stepping INTO a hex. Must be >= 1, or the A* heuristic stops being admissible. */
export type StepCost = (hex: HexCoord) => number;

const UNIFORM_COST: StepCost = () => 1;

interface PathNode {
  hex: HexCoord;
  /** Cost paid from the start to reach this hex. */
  g: number;
  /** g + estimated remaining cost. */
  f: number;
  parent: PathNode | null;
}

/**
 * Removes and returns the most promising node. A linear scan is enough for a
 * 63-cell grid; swap in a binary heap if rooms ever get large.
 */
function popBest(open: PathNode[]): PathNode | undefined {
  let best: PathNode | undefined;
  let bestIndex = -1;
  for (const [index, node] of open.entries()) {
    // On equal f, prefer the node that has travelled further: it is closer to
    // the goal, so ties resolve toward finishing instead of fanning out.
    if (!best || node.f < best.f || (node.f === best.f && node.g > best.g)) {
      best = node;
      bestIndex = index;
    }
  }
  if (bestIndex >= 0) open.splice(bestIndex, 1);
  return best;
}

/**
 * A* over the hex grid. Returns the path from `start` to `goal` with both ends
 * included, or an empty array when the goal cannot be reached.
 */
export function findPath(
  grid: HexGrid,
  start: HexCoord,
  goal: HexCoord,
  cost: StepCost = UNIFORM_COST,
): HexCoord[] {
  if (!grid.has(start) || !grid.has(goal)) return [];
  if (start.equals(goal)) return [start];
  if (grid.isBlocked(goal)) return [];

  const open: PathNode[] = [{ hex: start, g: 0, f: start.distance(goal), parent: null }];
  const bestCost = new Map<string, number>([[start.key(), 0]]);
  const closed = new Set<string>();

  let current = popBest(open);
  while (current) {
    if (current.hex.equals(goal)) {
      const path: HexCoord[] = [];
      for (let node: PathNode | null = current; node; node = node.parent) {
        path.push(node.hex);
      }
      return path.reverse();
    }

    const currentKey = current.hex.key();
    // A hex can sit in `open` several times; only its cheapest copy is expanded.
    if (!closed.has(currentKey)) {
      closed.add(currentKey);
      for (const next of current.hex.neighbors()) {
        const nextKey = next.key();
        if (closed.has(nextKey) || grid.isBlocked(next)) continue;

        const g = current.g + cost(next);
        if (g >= (bestCost.get(nextKey) ?? Infinity)) continue;

        bestCost.set(nextKey, g);
        open.push({ hex: next, g, f: g + next.distance(goal), parent: current });
      }
    }
    current = popBest(open);
  }

  return [];
}

/** Every hex that can be reached from `start` by spending at most `budget`. Excludes `start`. */
export function reachableHexes(
  grid: HexGrid,
  start: HexCoord,
  budget: number,
  cost: StepCost = UNIFORM_COST,
): HexCoord[] {
  const spent = new Map<string, number>([[start.key(), 0]]);
  const reached = new Map<string, HexCoord>();

  // Relax until nothing improves: a hex is re-queued whenever a cheaper route
  // to it turns up, which stays correct for non-uniform costs.
  const queue: HexCoord[] = [start];
  for (const current of queue) {
    const currentCost = spent.get(current.key()) ?? Infinity;
    for (const next of current.neighbors()) {
      if (grid.isBlocked(next)) continue;

      const nextKey = next.key();
      const nextCost = currentCost + cost(next);
      if (nextCost > budget || nextCost >= (spent.get(nextKey) ?? Infinity)) continue;

      spent.set(nextKey, nextCost);
      reached.set(nextKey, next);
      queue.push(next);
    }
  }

  return [...reached.values()];
}
