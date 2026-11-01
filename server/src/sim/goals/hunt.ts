import { HUNT_YIELD, type Goal, type Villager, type WorldState } from "@idle-sim/shared";
import { emitEvent } from "../events.ts";
import { addTo, depositInventory, homeSpot } from "../stock.ts";
import { remember, villagerTile } from "../villager.ts";
import { adjacentToTile, distance, inBounds } from "../world.ts";
import { travelTo, type StepResult } from "./helpers.ts";

const GIVE_UP_TICKS = 1800;

export function stepHunt(w: WorldState, v: Villager, g: Extract<Goal, { type: "hunt" }>): StepResult {
  if (g.phase === "chasing") {
    const prey = w.animals.find((a) => a.id === g.animalId && a.alive && !a.tame);
    if (!prey || !inBounds(w, Math.floor(prey.pos.x), Math.floor(prey.pos.y))) return "failed"; // got away over the edge
    if (w.clock.tick - v.goalStartedTick > GIVE_UP_TICKS) return "failed";
    if (distance(v.pos, prey.pos) <= 1.4) {
      prey.alive = false;
      addTo(v.inventory, "food", HUNT_YIELD[prey.kind]);
      emitEvent(w, "hunt", `${v.name} brought down a ${prey.kind}.`, { villagerIds: [v.id], pos: villagerTile(v) });
      remember(v, `I hunted a ${prey.kind}.`);
      g.phase = "returning";
      v.path = [];
      return "running";
    }
    if (w.clock.tick % 10 === 0) v.path = [];
    const preyTile = { x: Math.floor(prey.pos.x), y: Math.floor(prey.pos.y) };
    const t = travelTo(w, v, [preyTile, ...adjacentToTile(w, preyTile)]);
    if (t === "unreachable") return "failed";
    return "running";
  }

  // returning: the meat is the hunter's.
  const t = travelTo(w, v, homeSpot(w, v));
  if (t === "unreachable") {
    depositInventory(v);
    return "done";
  }
  if (t !== "arrived") return "running";
  depositInventory(v);
  return "done";
}
