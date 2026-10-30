import { CARRY_LIMIT, type Goal, type Villager, type WorldState } from "@idle-sim/shared";
import { adjacentToStructure, adjacentToTile, nearestResourceTile, setTile, structuresWithFunction, tileAt } from "../world.ts";
import { villagerTile } from "../villager.ts";
import { travelTo, type StepResult } from "./helpers.ts";

const TICKS_PER_UNIT = 20;

export function stepGather(w: WorldState, v: Villager, g: Extract<Goal, { type: "gather" }>): StepResult {
  const tileKind = g.resource === "wood" ? "forest" : "rock";
  const carried = v.inventory[g.resource] ?? 0;

  if (g.phase === "to_resource") {
    if (!g.target || tileAt(w, g.target.x, g.target.y).amount <= 0) {
      const next = nearestResourceTile(w, villagerTile(v), tileKind);
      if (!next) return carried > 0 ? switchToReturn(g, v) : "failed";
      g.target = next;
      v.path = [];
    }
    const t = travelTo(w, v, adjacentToTile(w, g.target));
    if (t === "unreachable") {
      g.target = undefined;
      return "running";
    }
    if (t === "arrived") g.phase = "collecting";
    return "running";
  }

  if (g.phase === "collecting") {
    const target = g.target!;
    const tile = tileAt(w, target.x, target.y);
    if (tile.amount <= 0) {
      g.phase = "to_resource";
      g.target = undefined;
      return "running";
    }
    g.collectTimer++;
    if (g.collectTimer >= TICKS_PER_UNIT) {
      g.collectTimer = 0;
      tile.amount -= 1;
      v.inventory[g.resource] = carried + 1;
      if (tile.amount <= 0) setTile(w, target.x, target.y, { kind: tileKind === "forest" ? "grass" : "dirt", amount: 0 });
      else setTile(w, target.x, target.y, tile);
      if ((v.inventory[g.resource] ?? 0) >= CARRY_LIMIT) return switchToReturn(g, v);
    }
    return "running";
  }

  // to_storehouse
  const store = structuresWithFunction(w, "storage")[0];
  if (!store) return "failed";
  const t = travelTo(w, v, adjacentToStructure(w, store));
  if (t === "unreachable") return "failed";
  if (t === "arrived") {
    w.storehouse[g.resource] += v.inventory[g.resource] ?? 0;
    v.inventory[g.resource] = 0;
    return "done";
  }
  return "running";
}

function switchToReturn(g: Extract<Goal, { type: "gather" }>, v: Villager): StepResult {
  g.phase = "to_storehouse";
  v.path = [];
  return "running";
}
