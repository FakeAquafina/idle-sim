import { CARRY_LIMIT, FISH_FOOD, type Goal, type Villager, type WorldState } from "@idle-sim/shared";
import { adjacentToStructure, shoreTiles, structuresWithFunction, workBonus } from "../world.ts";
import { villagerTile } from "../villager.ts";
import { travelTo, type StepResult } from "./helpers.ts";

const TICKS_PER_FISH_BEACH = 70;
const TICKS_PER_FISH_DOCK = 35;

export function stepFish(w: WorldState, v: Villager, g: Extract<Goal, { type: "fish" }>): StepResult {
  const carried = v.inventory.food ?? 0;
  const dock = structuresWithFunction(w, "fishing")[0];

  if (g.phase === "to_shore") {
    const spots = dock ? adjacentToStructure(w, dock) : shoreTiles(w, villagerTile(v));
    const t = travelTo(w, v, spots);
    if (t === "unreachable") return "failed";
    if (t === "arrived") g.phase = "fishing";
    return "running";
  }

  if (g.phase === "fishing") {
    g.timer++;
    let needed = (dock ? TICKS_PER_FISH_DOCK : TICKS_PER_FISH_BEACH) / workBonus(w);
    if (w.clock.season === "winter") needed *= 1.8;
    if (v.skill === "fisher") needed *= 0.7;
    if (g.timer >= needed) {
      g.timer = 0;
      v.inventory.food = carried + 1;
      if ((v.inventory.food ?? 0) >= CARRY_LIMIT) {
        g.phase = "to_storehouse";
        v.path = [];
      }
    }
    return "running";
  }

  const store = structuresWithFunction(w, "storage")[0];
  if (!store) return "failed";
  const t = travelTo(w, v, adjacentToStructure(w, store));
  if (t === "unreachable") return "failed";
  if (t === "arrived") {
    w.storehouse.food += (v.inventory.food ?? 0) * FISH_FOOD;
    v.inventory.food = 0;
    return "done";
  }
  return "running";
}
