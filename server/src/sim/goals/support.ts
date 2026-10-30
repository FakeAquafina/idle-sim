import type { Goal, Villager, WorldState } from "@idle-sim/shared";
import { supportPetition } from "../petitions.ts";
import { say } from "../villager.ts";
import { adjacentToStructure, structuresWithFunction } from "../world.ts";
import { travelTo, type StepResult } from "./helpers.ts";

/** Walk to the shrine and add this villager's voice to a proposed petition. */
export function stepSupport(w: WorldState, v: Villager, g: Extract<Goal, { type: "support" }>): StepResult {
  const p = w.petitions.find((x) => x.id === g.petitionId);
  if (!p || p.status !== "proposed" || p.supporters.includes(v.id)) return "done";
  const shrine = structuresWithFunction(w, "petition")[0];
  if (!shrine) return "failed";
  const t = travelTo(w, v, adjacentToStructure(w, shrine));
  if (t === "unreachable") return "failed";
  if (t !== "arrived") return "running";
  const opened = supportPetition(w, v, p.id);
  if (!v.speech) say(w, v, opened ? "Hear us." : "I stand with you.", 6);
  return "done";
}
