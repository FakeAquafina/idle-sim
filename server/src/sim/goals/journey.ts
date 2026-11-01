import type { Goal, Villager, WorldState } from "@idle-sim/shared";
import { cannotJourney, depart } from "../journey.ts";
import { travelTo, type StepResult } from "./helpers.ts";

/** Walk to where the road leaves the map, then go. */
export function stepJourney(w: WorldState, v: Villager, g: Extract<Goal, { type: "journey" }>): StepResult {
  if (v.away) return "done";
  const why = cannotJourney(w, v);
  if (why && !why.startsWith("someone set out")) return "failed";
  const t = travelTo(w, v, [g.target]);
  if (t === "unreachable") return "failed";
  if (t !== "arrived") return "running";
  depart(w, v);
  return "done";
}
