// Building is in two parts: bringing materials to the blueprint (from one's
// own or the household's stock, or the common store), then the work itself
// once everything needed is on site. Anyone may help with either.

import { STRUCTURES, type Goal, type Villager, type WorldState } from "@idle-sim/shared";
import { emitEvent } from "../events.ts";
import { deliverMaterials, depositInventory, hasStorehouse, homeSpot, householdStock, loadFor, remainingCost, totalUnits, householdOf } from "../stock.ts";
import { adjacentToStructure, assignHomes, onStructureBuilt, structuresWithFunction, workBonus } from "../world.ts";
import { remember } from "../villager.ts";
import { travelTo, type StepResult } from "./helpers.ts";

export function stepBuild(w: WorldState, v: Villager, g: Extract<Goal, { type: "build" }>): StepResult {
  const s = w.structures.find((s) => s.id === g.structureId);
  if (!s || s.built) return "done";
  const def = STRUCTURES[s.kind];
  const need = remainingCost(s, def.cost);
  const needsMore = Object.keys(need).length > 0;

  if (needsMore && g.phase !== "working") {
    // Carrying something the blueprint wants: bring it over.
    const carryingUseful = Object.entries(need).some(([k, n]) => n > 0 && (v.inventory[k as keyof typeof v.inventory] ?? 0) > 0);
    if (carryingUseful) g.phase = "delivering";
    if (g.phase === "delivering") {
      const t = travelTo(w, v, adjacentToStructure(w, s));
      if (t === "unreachable") return "failed";
      if (t !== "arrived") return "running";
      deliverMaterials(s, def.cost, v);
      g.phase = undefined;
      v.path = [];
      return "running";
    }
    // Nothing useful in hand: go and fetch some, from home or the common store.
    if (g.phase !== "fetching") {
      g.from = pickSource(w, v, need);
      if (!g.from) return "failed"; // nobody near me has what it needs; gather instead
      g.phase = "fetching";
      v.path = [];
    }
    const store = structuresWithFunction(w, "storage")[0];
    const targets = g.from === "store" && store ? adjacentToStructure(w, store) : homeSpot(w, v);
    const t = travelTo(w, v, targets);
    if (t === "unreachable") return "failed";
    if (t !== "arrived") return "running";
    let loaded = 0;
    if (g.from === "store") loaded = loadFor(v, need, w.storehouse);
    else for (const m of householdOf(w, v)) loaded += loadFor(v, need, m.stock);
    if (loaded === 0) return "failed"; // someone used it up meanwhile
    g.phase = "delivering";
    v.path = [];
    return "running";
  }
  if (needsMore) {
    g.phase = undefined;
    return "running";
  }

  // Everything is on site: build.
  g.phase = "working";
  if (totalUnits(v.inventory) > 0) depositInventory(v);
  const t = travelTo(w, v, adjacentToStructure(w, s));
  if (t === "unreachable") return "failed";
  if (t !== "arrived") return "running";
  if (w.clock.weather === "storm") return "running"; // wait it out

  const skillBonus = v.skill === "builder" ? 1.5 : 1;
  s.progress = Math.min(1, s.progress + (skillBonus * workBonus(w)) / def.buildTicks);
  if (s.progress >= 1) {
    s.keeperId = v.id;
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

/** Where this villager can get something the blueprint still needs. */
function pickSource(w: WorldState, v: Villager, need: ReturnType<typeof remainingCost>): "home" | "store" | undefined {
  const mine = householdStock(w, v);
  if (Object.entries(need).some(([k, n]) => n > 0 && mine[k as keyof typeof mine] > 0)) return "home";
  if (hasStorehouse(w) && Object.entries(need).some(([k, n]) => n > 0 && (w.storehouse[k as keyof typeof w.storehouse] ?? 0) > 0)) return "store";
  return undefined;
}
