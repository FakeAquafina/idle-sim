import { CARRY_LIMIT, FISH_FOOD, type Goal, type Villager, type WorldState } from "@idle-sim/shared";
import { addTo, depositInventory, homeSpot } from "../stock.ts";
import { adjacentToStructure, discoveryBonus, shoreTiles, structuresWithFunction, workBonus } from "../world.ts";
import { villagerTile } from "../villager.ts";
import { travelTo, type StepResult } from "./helpers.ts";

const TICKS_PER_FISH_BEACH = 70;
const TICKS_PER_FISH_DOCK = 35;

export function stepFish(w: WorldState, v: Villager, g: Extract<Goal, { type: "fish" }>): StepResult {
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
    let needed = (dock ? TICKS_PER_FISH_DOCK : TICKS_PER_FISH_BEACH) / workBonus(w) / discoveryBonus(w, "fish_nets");
    if (w.clock.season === "winter") needed *= 1.8;
    if (v.skill === "fisher") needed *= 0.7;
    if (g.timer >= needed) {
      g.timer = 0;
      addTo(v.inventory, "food", FISH_FOOD); // a fish is a couple of meals
      if ((v.inventory.food ?? 0) >= CARRY_LIMIT * FISH_FOOD) {
        g.phase = "returning";
        v.path = [];
      }
    }
    return "running";
  }

  // returning: the catch goes into the fisher's own stock at home.
  const t = travelTo(w, v, homeSpot(w, v));
  if (t === "unreachable") {
    depositInventory(v);
    return "done";
  }
  if (t !== "arrived") return "running";
  depositInventory(v);
  return "done";
}
