// Test fixtures. A fresh world now starts with nothing but a hidden shrine, so
// tests about an established village build one: fire, storehouse, found shrine,
// and some common stock to work with.

import type { ResourceKind, WorldState } from "@idle-sim/shared";
import { findPlacement, placeStructure } from "../src/sim/world.ts";

export const ESTABLISHED_STOCK: Record<ResourceKind, number> = { wood: 30, stone: 10, food: 40, seeds: 6, ore: 0 };

/** Give a world the buildings the old starting village had, and a stocked storehouse. */
export function establish(w: WorldState, stock: Record<ResourceKind, number> = ESTABLISHED_STOCK): WorldState {
  for (const s of w.structures) if (s.kind === "shrine") s.hidden = false;
  const c = w.camp;
  if (!w.structures.some((s) => s.kind === "campfire")) {
    const spot = findPlacement(w, "campfire", { x: c.x, y: c.y + 1 }, 4)!;
    placeStructure(w, "campfire", spot.x, spot.y, { built: true, free: true });
  }
  if (!w.structures.some((s) => s.kind === "storehouse")) {
    const spot = findPlacement(w, "storehouse", { x: c.x, y: c.y - 4 }, 6)!;
    placeStructure(w, "storehouse", spot.x, spot.y, { built: true, free: true });
  }
  w.storehouse = { ...stock };
  return w;
}
