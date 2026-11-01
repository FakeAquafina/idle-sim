import { FARM_YIELD, type Goal, type Villager, type WorldState } from "@idle-sim/shared";
import { emitEvent } from "../events.ts";
import { addTo, hasStorehouse, takeFromHousehold } from "../stock.ts";
import { adjacentToStructure } from "../world.ts";
import { remember } from "../villager.ts";
import { travelTo, type StepResult } from "./helpers.ts";

const TEND_TICKS = 300;

export function stepFarm(w: WorldState, v: Villager, g: Extract<Goal, { type: "farm" }>): StepResult {
  const s = w.structures.find((s) => s.id === g.structureId);
  if (!s || !s.built || s.kind !== "farm") return "failed";
  const t = travelTo(w, v, adjacentToStructure(w, s));
  if (t === "unreachable") return "failed";
  if (t !== "arrived") return "running";

  if (s.growth === undefined) {
    if (w.clock.season === "winter") return "failed";
    // A seed from one's own pocket, the household's, or the common store.
    let seed = takeFromHousehold(w, v, "seeds", 1);
    if (!seed && hasStorehouse(w) && w.storehouse.seeds > 0) {
      w.storehouse.seeds -= 1;
      seed = 1;
    }
    if (!seed) return "failed";
    s.growth = 0;
    return "done";
  }
  if (s.growth >= 1) {
    // The harvest belongs to whoever brings it in.
    const bonus = v.skill === "farmer" ? 2 : 0;
    addTo(v.stock, "food", FARM_YIELD + bonus);
    addTo(v.stock, "seeds", 1);
    s.growth = undefined;
    emitEvent(w, "harvest", `${v.name} harvested ${FARM_YIELD + bonus} food.`, { villagerIds: [v.id], pos: { x: s.x, y: s.y } });
    remember(v, "I brought in a harvest.");
    return "done";
  }
  g.tendTicks++;
  s.growth = Math.min(1, s.growth + 0.00002);
  return g.tendTicks >= TEND_TICKS ? "done" : "running";
}
