import type { Villager, WorldState } from "@idle-sim/shared";
import { adjacentToStructure, structuresWithFunction } from "../world.ts";
import { travelTo, type StepResult } from "./helpers.ts";

export function stepEat(w: WorldState, v: Villager): StepResult {
  const store = structuresWithFunction(w, "storage")[0];
  if (!store || w.storehouse.food <= 0) return "failed";
  const t = travelTo(w, v, adjacentToStructure(w, store));
  if (t === "unreachable") return "failed";
  if (t !== "arrived") return "running";
  if (w.storehouse.food <= 0) return "failed";
  w.storehouse.food -= 1;
  v.needs.hunger = Math.min(100, v.needs.hunger + 40);
  return "done";
}
