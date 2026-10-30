import { STRUCTURES, type Goal, type Villager, type WorldState } from "@idle-sim/shared";
import { emitEvent } from "../events.ts";
import { remember } from "../villager.ts";
import { adjacentToStructure, adjacentToTile, distance } from "../world.ts";
import { travelTo, type StepResult } from "./helpers.ts";

const GIVE_UP_TICKS = 2400;

export function stepTame(w: WorldState, v: Villager, g: Extract<Goal, { type: "tame" }>): StepResult {
  const animal = w.animals.find((a) => a.id === g.animalId && a.alive);
  const pen = w.structures.find((s) => s.id === g.penId && s.built);
  if (!animal || !pen) return "failed";
  const herd = w.animals.filter((a) => a.alive && a.penId === pen.id).length;
  if (herd >= (STRUCTURES[pen.kind].capacity ?? 4)) return "failed";

  if (g.phase === "approach") {
    if (animal.tame || animal.leaderId) return "failed";
    if (w.clock.tick - v.goalStartedTick > GIVE_UP_TICKS) return "failed";
    if (distance(v.pos, animal.pos) <= 1.4) {
      animal.leaderId = v.id;
      animal.target = undefined;
      g.phase = "leading";
      v.path = [];
      return "running";
    }
    if (w.clock.tick % 10 === 0) v.path = [];
    const tile = { x: Math.floor(animal.pos.x), y: Math.floor(animal.pos.y) };
    const t = travelTo(w, v, [tile, ...adjacentToTile(w, tile)]);
    if (t === "unreachable") return "failed";
    return "running";
  }

  // leading
  if (animal.leaderId !== v.id) return "failed";
  const t = travelTo(w, v, adjacentToStructure(w, pen));
  if (t === "unreachable") {
    animal.leaderId = undefined;
    return "failed";
  }
  if (t !== "arrived") return "running";
  animal.leaderId = undefined;
  animal.tame = true;
  animal.penId = pen.id;
  animal.pos = { x: pen.x + 0.5, y: pen.y + 0.5 };
  animal.target = undefined;
  emitEvent(w, "tame", `${v.name} led a ${animal.kind} into the pen.`, { villagerIds: [v.id], pos: { x: pen.x, y: pen.y } });
  remember(v, `I tamed a ${animal.kind} and brought it to the pen.`);
  return "done";
}
