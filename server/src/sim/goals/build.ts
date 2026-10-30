import { STRUCTURES, type Goal, type Villager, type WorldState } from "@idle-sim/shared";
import { emitEvent } from "../events.ts";
import { adjacentToStructure, assignHomes, onStructureBuilt, workBonus } from "../world.ts";
import { remember } from "../villager.ts";
import { travelTo, type StepResult } from "./helpers.ts";

export function stepBuild(w: WorldState, v: Villager, g: Extract<Goal, { type: "build" }>): StepResult {
  const s = w.structures.find((s) => s.id === g.structureId);
  if (!s || s.built) return "done";
  const def = STRUCTURES[s.kind];
  const t = travelTo(w, v, adjacentToStructure(w, s));
  if (t === "unreachable") return "failed";
  if (t !== "arrived") return "running";
  if (w.clock.weather === "storm") return "running"; // wait it out

  const skillBonus = v.skill === "builder" ? 1.5 : 1;
  s.progress = Math.min(1, s.progress + (skillBonus * workBonus(w)) / def.buildTicks);
  if (s.progress >= 1) {
    onStructureBuilt(w, s);
    emitEvent(w, "built", `${v.name} finished building a ${def.label.toLowerCase()}.`, {
      villagerIds: [v.id],
      pos: { x: s.x, y: s.y },
    });
    remember(v, `I finished building the ${def.label.toLowerCase()}.`);
    if (def.function === "shelter") assignHomes(w);
    return "done";
  }
  return "running";
}
