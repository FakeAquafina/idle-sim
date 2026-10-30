import type { Goal, Villager, WorldState } from "@idle-sim/shared";
import { beginConversation, inConversation } from "../conversation.ts";
import { adjacentToTile, distance } from "../world.ts";
import { villagerTile } from "../villager.ts";
import { travelTo, type StepResult } from "./helpers.ts";

export function stepTalkTo(w: WorldState, v: Villager, g: Extract<Goal, { type: "talk_to" }>): StepResult {
  const other = w.villagers.find((o) => o.id === g.villagerId && o.alive);
  if (!other) return "failed";

  // Once the chat has begun, stand here until the conversation is over.
  if (g.chatted) return inConversation(w, v.id) ? "running" : "done";

  if (distance(v.pos, other.pos) <= 1.6) {
    v.path = [];
    g.chatted = true;
    if (inConversation(w, other.id)) return "done"; // they're already talking to someone else
    beginConversation(w, v, other);
    return "running";
  }

  // The other villager moves, so re-path every so often.
  if (w.clock.tick % 15 === 0) v.path = [];
  const t = travelTo(w, v, adjacentToTile(w, villagerTile(other)));
  if (t === "unreachable") return "failed";
  if (w.clock.tick - v.goalStartedTick > 1200) return "failed"; // gave up chasing
  return "running";
}
