import { CARRY_LIMIT, type Goal, type Villager, type WorldState } from "@idle-sim/shared";
import { emitEvent } from "../events.ts";
import { adjacentToStructure, structuresWithFunction, workBonus } from "../world.ts";
import { travelTo, type StepResult } from "./helpers.ts";

const TICKS_PER_UNIT = 25;

export function stepMine(w: WorldState, v: Villager, g: Extract<Goal, { type: "mine" }>): StepResult {
  const mine = w.structures.find((s) => s.id === g.structureId && s.built && s.kind === "mine");
  const carried = (v.inventory.stone ?? 0) + (v.inventory.ore ?? 0);

  if (g.phase === "to_mine") {
    if (!mine || mine.depleted) return "failed";
    const t = travelTo(w, v, adjacentToStructure(w, mine));
    if (t === "unreachable") return "failed";
    if (t === "arrived") g.phase = "digging";
    return "running";
  }

  if (g.phase === "digging") {
    if (!mine || !mine.reserve) return "failed";
    if (mine.reserve.stone <= 0 && mine.reserve.ore <= 0) {
      if (!mine.depleted) {
        mine.depleted = true;
        emitEvent(w, "depleted", "The mine's vein has run dry.", { pos: { x: mine.x, y: mine.y } });
      }
      return carried > 0 ? toStore(g, v) : "failed";
    }
    g.timer++;
    const needed = TICKS_PER_UNIT / workBonus(w) / (v.skill === "mason" || v.skill === "miner" ? 1.4 : 1);
    if (g.timer >= needed) {
      g.timer = 0;
      // Every fourth unit is ore while the vein has any.
      const takeOre = mine.reserve.ore > 0 && (carried % 4 === 3 || mine.reserve.stone <= 0);
      if (takeOre) {
        mine.reserve.ore--;
        v.inventory.ore = (v.inventory.ore ?? 0) + 1;
      } else {
        mine.reserve.stone--;
        v.inventory.stone = (v.inventory.stone ?? 0) + 1;
      }
      if (carried + 1 >= CARRY_LIMIT) return toStore(g, v);
    }
    return "running";
  }

  const store = structuresWithFunction(w, "storage")[0];
  if (!store) return "failed";
  const t = travelTo(w, v, adjacentToStructure(w, store));
  if (t === "unreachable") return "failed";
  if (t === "arrived") {
    w.storehouse.stone += v.inventory.stone ?? 0;
    w.storehouse.ore += v.inventory.ore ?? 0;
    v.inventory.stone = 0;
    v.inventory.ore = 0;
    return "done";
  }
  return "running";
}

function toStore(g: Extract<Goal, { type: "mine" }>, v: Villager): StepResult {
  g.phase = "to_storehouse";
  v.path = [];
  return "running";
}
