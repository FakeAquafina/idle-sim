import type { Goal, Villager, WorldState } from "@idle-sim/shared";
import { openPetition } from "../petitions.ts";
import { say } from "../villager.ts";
import { adjacentToStructure, structuresWithFunction } from "../world.ts";
import { travelTo, type StepResult } from "./helpers.ts";

export function stepPetition(w: WorldState, v: Villager, g: Extract<Goal, { type: "petition" }>): StepResult {
  const shrine = structuresWithFunction(w, "petition")[0];
  if (!shrine) return "failed";
  const t = travelTo(w, v, adjacentToStructure(w, shrine));
  if (t === "unreachable") return "failed";
  if (t !== "arrived") return "running";
  openPetition(w, v, { ask: g.ask as Parameters<typeof openPetition>[2]["ask"], amount: g.amount, reason: g.reason });
  say(w, v, g.reason.slice(0, 120), 10);
  return "done";
}
