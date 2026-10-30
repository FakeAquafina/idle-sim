import { HUNT_YIELD, type Goal, type Villager, type WorldState } from "@idle-sim/shared";
import { emitEvent } from "../events.ts";
import { remember, villagerTile } from "../villager.ts";
import { adjacentToStructure, adjacentToTile, distance, structuresWithFunction } from "../world.ts";
import { travelTo, type StepResult } from "./helpers.ts";

const GIVE_UP_TICKS = 1800;

export function stepHunt(w: WorldState, v: Villager, g: Extract<Goal, { type: "hunt" }>): StepResult {
  if (g.phase === "chasing") {
    const prey = w.animals.find((a) => a.id === g.animalId && a.alive && !a.tame);
    if (!prey) return "failed";
    if (w.clock.tick - v.goalStartedTick > GIVE_UP_TICKS) return "failed";
    if (distance(v.pos, prey.pos) <= 1.4) {
      prey.alive = false;
      v.inventory.food = (v.inventory.food ?? 0) + HUNT_YIELD[prey.kind];
      emitEvent(w, "hunt", `${v.name} brought down a ${prey.kind}.`, { villagerIds: [v.id], pos: villagerTile(v) });
      remember(v, `I hunted a ${prey.kind}.`);
      g.phase = "to_storehouse";
      v.path = [];
      return "running";
    }
    if (w.clock.tick % 10 === 0) v.path = [];
    const preyTile = { x: Math.floor(prey.pos.x), y: Math.floor(prey.pos.y) };
    const t = travelTo(w, v, [preyTile, ...adjacentToTile(w, preyTile)]);
    if (t === "unreachable") return "failed";
    return "running";
  }

  const store = structuresWithFunction(w, "storage")[0];
  if (!store) return "failed";
  const t = travelTo(w, v, adjacentToStructure(w, store));
  if (t === "unreachable") return "failed";
  if (t === "arrived") {
    w.storehouse.food += v.inventory.food ?? 0;
    v.inventory.food = 0;
    return "done";
  }
  return "running";
}
