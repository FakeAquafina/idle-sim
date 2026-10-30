import type { Goal, Villager, WorldState } from "@idle-sim/shared";
import { travelTo, type StepResult } from "./helpers.ts";

export function stepWander(w: WorldState, v: Villager, g: Extract<Goal, { type: "wander" }>): StepResult {
  const t = travelTo(w, v, [g.target]);
  if (t === "arrived") return "done";
  if (t === "unreachable") return "failed";
  return "running";
}
