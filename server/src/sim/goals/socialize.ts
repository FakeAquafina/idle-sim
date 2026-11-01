import { TICKS_PER_DAY, type Goal, type Villager, type WorldState } from "@idle-sim/shared";
import { chance, pick } from "../rng.ts";
import { villagerTile } from "../villager.ts";
import { adjacentToStructure, distance } from "../world.ts";
import { travelTo, type StepResult } from "./helpers.ts";

export function stepSocializeAt(w: WorldState, v: Villager, g: Extract<Goal, { type: "socialize_at" }>): StepResult {
  const s = w.structures.find((s) => s.id === g.structureId);
  if (!s || !s.built) return "failed";
  const t = travelTo(w, v, adjacentToStructure(w, s));
  if (t === "unreachable") return "failed";
  if (t !== "arrived") return "running";

  // Every so often shift to another spot around the fire, so a long evening doesn't look frozen.
  if (w.clock.tick % 150 === 0 && chance(w, 0.5)) {
    const here = villagerTile(v);
    const spots = adjacentToStructure(w, s).filter((p) => (p.x !== here.x || p.y !== here.y) && distance(p, here) <= 2.3);
    if (spots.length) v.path = [pick(w, spots)];
  }

  v.needs.social = Math.min(100, v.needs.social + 100 / (0.15 * TICKS_PER_DAY));
  for (const other of w.villagers) {
    if (other.id === v.id || !other.alive) continue;
    if (distance(other.pos, v.pos) < 2.5) {
      v.relationships[other.id] = Math.min(100, (v.relationships[other.id] ?? 0) + 0.01);
    }
  }
  return w.clock.tick >= g.untilTick ? "done" : "running";
}
