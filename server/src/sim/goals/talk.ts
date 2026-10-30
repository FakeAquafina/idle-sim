import type { Goal, Villager, WorldState } from "@idle-sim/shared";
import { pick } from "../rng.ts";
import { adjacentToTile, distance } from "../world.ts";
import { say, villagerTile } from "../villager.ts";
import { travelTo, type StepResult } from "./helpers.ts";

// Placeholder small talk until Claude takes over conversations in Phase 3.
const LINES = [
  "Fine weather for it.",
  "The storehouse looked a little bare.",
  "My back aches from all that hauling.",
  "Did you hear the wind last night?",
  "We could use another pair of hands.",
  "I had the strangest dream.",
];

export function stepTalkTo(w: WorldState, v: Villager, g: Extract<Goal, { type: "talk_to" }>): StepResult {
  const other = w.villagers.find((o) => o.id === g.villagerId && o.alive);
  if (!other) return "failed";

  if (g.chatted) return !v.speech || w.clock.tick > v.speech.untilTick ? "done" : "running";

  if (distance(v.pos, other.pos) <= 1.6) {
    v.path = [];
    say(w, v, pick(w, LINES));
    say(w, other, pick(w, LINES));
    v.needs.social = Math.min(100, v.needs.social + 20);
    other.needs.social = Math.min(100, other.needs.social + 20);
    v.relationships[other.id] = Math.min(100, (v.relationships[other.id] ?? 0) + 2);
    other.relationships[v.id] = Math.min(100, (other.relationships[v.id] ?? 0) + 2);
    g.chatted = true;
    return "running";
  }

  // The other villager moves, so re-path every so often.
  if (w.clock.tick % 15 === 0) v.path = [];
  const t = travelTo(w, v, adjacentToTile(w, villagerTile(other)));
  if (t === "unreachable") return "failed";
  if (w.clock.tick - v.goalStartedTick > 1200) return "failed"; // gave up chasing
  return "running";
}
