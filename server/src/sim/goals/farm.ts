import { FARM_YIELD, type Goal, type Villager, type WorldState } from "@idle-sim/shared";
import { emitEvent } from "../events.ts";
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
    if (w.storehouse.seeds <= 0 || w.clock.season === "winter") return "failed";
    w.storehouse.seeds -= 1;
    s.growth = 0;
    return "done";
  }
  if (s.growth >= 1) {
    const bonus = v.skill === "farmer" ? 2 : 0;
    w.storehouse.food += FARM_YIELD + bonus;
    w.storehouse.seeds += 1;
    s.growth = undefined;
    emitEvent(w, "harvest", `${v.name} harvested ${FARM_YIELD + bonus} food.`, { villagerIds: [v.id], pos: { x: s.x, y: s.y } });
    remember(v, "I brought in a harvest.");
    return "done";
  }
  g.tendTicks++;
  s.growth = Math.min(1, s.growth + 0.00002);
  return g.tendTicks >= TEND_TICKS ? "done" : "running";
}
