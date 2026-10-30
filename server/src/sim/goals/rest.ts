import { TICKS_PER_DAY, type Goal, type Villager, type WorldState } from "@idle-sim/shared";
import { adjacentToStructure } from "../world.ts";
import { travelTo, type StepResult } from "./helpers.ts";

export function stepRest(w: WorldState, v: Villager, g: Extract<Goal, { type: "rest" }>): StepResult {
  const s = g.structureId ? w.structures.find((s) => s.id === g.structureId) : undefined;
  if (s) {
    const t = travelTo(w, v, adjacentToStructure(w, s));
    if (t === "unreachable") g.structureId = undefined;
    else if (t !== "arrived") return "running";
  }
  const indoors = !!s && s.kind === "house";
  const rate = (indoors ? 100 : 60) / (0.3 * TICKS_PER_DAY);
  v.needs.energy = Math.min(100, v.needs.energy + rate);
  return v.needs.energy >= 100 ? "done" : "running";
}
