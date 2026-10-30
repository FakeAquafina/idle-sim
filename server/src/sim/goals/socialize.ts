import { TICKS_PER_DAY, type Goal, type Villager, type WorldState } from "@idle-sim/shared";
import { adjacentToStructure, distance } from "../world.ts";
import { travelTo, type StepResult } from "./helpers.ts";

export function stepSocializeAt(w: WorldState, v: Villager, g: Extract<Goal, { type: "socialize_at" }>): StepResult {
  const s = w.structures.find((s) => s.id === g.structureId);
  if (!s || !s.built) return "failed";
  const t = travelTo(w, v, adjacentToStructure(w, s));
  if (t === "unreachable") return "failed";
  if (t !== "arrived") return "running";

  v.needs.social = Math.min(100, v.needs.social + 100 / (0.15 * TICKS_PER_DAY));
  for (const other of w.villagers) {
    if (other.id === v.id || !other.alive) continue;
    if (distance(other.pos, v.pos) < 2.5) {
      v.relationships[other.id] = Math.min(100, (v.relationships[other.id] ?? 0) + 0.01);
    }
  }
  return w.clock.tick >= g.untilTick ? "done" : "running";
}
