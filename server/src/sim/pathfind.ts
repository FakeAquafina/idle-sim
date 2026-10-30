// A* on the tile grid, 4-directional. Targets can be a set of tiles so a
// villager can path to "any tile next to this building".

import { tileIndex, type Vec2, type WorldState } from "@idle-sim/shared";
import { isWalkable } from "./world.ts";

class MinHeap {
  private items: { i: number; f: number }[] = [];
  get size() {
    return this.items.length;
  }
  push(i: number, f: number) {
    const a = this.items;
    a.push({ i, f });
    let k = a.length - 1;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (a[p].f <= a[k].f) break;
      [a[p], a[k]] = [a[k], a[p]];
      k = p;
    }
  }
  pop(): number {
    const a = this.items;
    const top = a[0];
    const last = a.pop()!;
    if (a.length > 0) {
      a[0] = last;
      let k = 0;
      for (;;) {
        const l = 2 * k + 1;
        const r = l + 1;
        let m = k;
        if (l < a.length && a[l].f < a[m].f) m = l;
        if (r < a.length && a[r].f < a[m].f) m = r;
        if (m === k) break;
        [a[m], a[k]] = [a[k], a[m]];
        k = m;
      }
    }
    return top.i;
  }
}

/**
 * Find a path from `from` to any tile in `goals` (tile indices).
 * Returns the waypoints after `from` (last one is the goal tile), or null.
 */
export function findPathToAny(w: WorldState, from: Vec2, goals: Set<number>, maxNodes = 8000): Vec2[] | null {
  if (goals.size === 0) return null;
  const W = w.width;
  const start = tileIndex(W, from.x, from.y);
  if (goals.has(start)) return [];

  const goalList = [...goals].map((i) => ({ x: i % W, y: Math.floor(i / W) }));
  const h = (x: number, y: number) => {
    let best = Infinity;
    for (const g of goalList) {
      const d = Math.abs(g.x - x) + Math.abs(g.y - y);
      if (d < best) best = d;
    }
    return best;
  };

  const gScore = new Map<number, number>([[start, 0]]);
  const cameFrom = new Map<number, number>();
  const closed = new Set<number>();
  const open = new MinHeap();
  open.push(start, h(from.x, from.y));
  let expanded = 0;

  while (open.size > 0 && expanded < maxNodes) {
    const current = open.pop();
    if (closed.has(current)) continue;
    closed.add(current);
    expanded++;

    if (goals.has(current)) {
      const path: Vec2[] = [];
      let node = current;
      while (node !== start) {
        path.push({ x: node % W, y: Math.floor(node / W) });
        node = cameFrom.get(node)!;
      }
      return path.reverse();
    }

    const cx = current % W;
    const cy = Math.floor(current / W);
    const g = gScore.get(current)!;
    const neighbours = [
      [cx + 1, cy],
      [cx - 1, cy],
      [cx, cy + 1],
      [cx, cy - 1],
    ];
    for (const [nx, ny] of neighbours) {
      if (!isWalkable(w, nx, ny)) continue;
      const ni = tileIndex(W, nx, ny);
      if (closed.has(ni)) continue;
      const ng = g + 1;
      if (ng < (gScore.get(ni) ?? Infinity)) {
        gScore.set(ni, ng);
        cameFrom.set(ni, current);
        open.push(ni, ng + h(nx, ny));
      }
    }
  }
  return null;
}

export function findPath(w: WorldState, from: Vec2, to: Vec2): Vec2[] | null {
  return findPathToAny(w, from, new Set([tileIndex(w.width, to.x, to.y)]));
}
