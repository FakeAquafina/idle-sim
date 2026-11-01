// Giving surplus to the common store: fetch it from home, carry it to the storehouse.

import { CARRY_LIMIT, type Goal, type Villager, type WorldState } from "@idle-sim/shared";
import { emitEvent } from "../events.ts";
import { addTo, depositInventory, homeSpot, takeFrom } from "../stock.ts";
import { remember } from "../villager.ts";
import { adjacentToStructure, structuresWithFunction } from "../world.ts";
import { travelTo, type StepResult } from "./helpers.ts";

export function stepDonate(w: WorldState, v: Villager, g: Extract<Goal, { type: "donate" }>): StepResult {
  const store = structuresWithFunction(w, "storage")[0];
  if (!store) return "failed";

  if (g.phase === "fetching") {
    const t = travelTo(w, v, homeSpot(w, v));
    if (t === "unreachable") return "failed";
    if (t !== "arrived") return "running";
    const n = takeFrom(v.stock, g.resource, g.amount);
    if (n === 0) return "failed";
    addTo(v.inventory, g.resource, n);
    g.phase = "delivering";
    v.path = [];
    return "running";
  }

  const t = travelTo(w, v, adjacentToStructure(w, store));
  if (t === "unreachable") {
    depositInventory(v);
    return "failed";
  }
  if (t !== "arrived") return "running";
  const n = v.inventory[g.resource] ?? 0;
  v.inventory[g.resource] = 0;
  w.storehouse[g.resource] += n;
  if (n > 0) remember(v, `I put ${n} ${g.resource} into the common store.`);
  // Only a full sack is worth a line in the feed; small top-ups stay quiet.
  if (n >= CARRY_LIMIT) emitEvent(w, "donate", `${v.name} puts ${n} ${g.resource} into the storehouse for everyone.`, { villagerIds: [v.id], pos: { x: store.x, y: store.y } });
  return "done";
}
