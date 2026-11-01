// Cutting wood, quarrying stone by hand, or foraging food in the forest. The
// haul is carried home into the villager's own stock, or straight to a
// blueprint that needs it.

import { CARRY_LIMIT, FORAGE_SEED_CHANCE, FORAGE_TICKS, STRUCTURES, type Goal, type Villager, type WorldState } from "@idle-sim/shared";
import { chance } from "../rng.ts";
import { addTo, deliverMaterials, depositInventory, homeSpot, remainingCost } from "../stock.ts";
import { villagerTile } from "../villager.ts";
import { adjacentToStructure, adjacentToTile, nearestResourceTile, setTile, tileAt, workBonus } from "../world.ts";
import { travelTo, type StepResult } from "./helpers.ts";

const TICKS_PER_UNIT = 20;

export function stepGather(w: WorldState, v: Villager, g: Extract<Goal, { type: "gather" }>): StepResult {
  const tileKind = g.resource === "stone" ? "rock" : "forest";
  const carried = v.inventory[g.resource] ?? 0;

  if (g.phase === "to_resource") {
    if (!g.target || tileAt(w, g.target.x, g.target.y).kind !== tileKind) {
      const next = nearestResourceTile(w, villagerTile(v), tileKind);
      if (!next) return carried > 0 ? switchToReturn(g, v) : "failed";
      g.target = next;
      v.path = [];
    }
    const t = travelTo(w, v, adjacentToTile(w, g.target));
    if (t === "unreachable") {
      g.target = undefined;
      return "running";
    }
    if (t === "arrived") g.phase = "collecting";
    return "running";
  }

  if (g.phase === "collecting") {
    const target = g.target!;
    const tile = tileAt(w, target.x, target.y);
    if (tile.kind !== tileKind || (g.resource !== "food" && tile.amount <= 0)) {
      g.phase = "to_resource";
      g.target = undefined;
      return "running";
    }
    g.collectTimer++;
    if (g.resource === "food") {
      // Berries and nuts: the forest is not thinned by it.
      const skilled = v.skill === "forager" || v.skill === "cook";
      if (g.collectTimer >= FORAGE_TICKS / workBonus(w) / (skilled ? 1.4 : 1)) {
        g.collectTimer = 0;
        addTo(v.inventory, "food", 1);
        if (chance(w, FORAGE_SEED_CHANCE)) addTo(v.inventory, "seeds", 1);
        if ((v.inventory.food ?? 0) >= CARRY_LIMIT) return switchToReturn(g, v);
      }
      return "running";
    }
    const skilled = (g.resource === "wood" && v.skill === "woodcutter") || (g.resource === "stone" && v.skill === "mason");
    if (g.collectTimer >= TICKS_PER_UNIT / workBonus(w) / (skilled ? 1.4 : 1)) {
      g.collectTimer = 0;
      tile.amount -= 1;
      v.inventory[g.resource] = carried + 1;
      if (tile.amount <= 0) setTile(w, target.x, target.y, { kind: tileKind === "forest" ? "grass" : "dirt", amount: 0 });
      else setTile(w, target.x, target.y, tile);
      if ((v.inventory[g.resource] ?? 0) >= CARRY_LIMIT) return switchToReturn(g, v);
    }
    return "running";
  }

  // returning: to the blueprint that wanted it, or home.
  const blueprint = g.deliverTo ? w.structures.find((s) => s.id === g.deliverTo && !s.built) : undefined;
  if (g.deliverTo && !blueprint) {
    g.deliverTo = undefined; // finished or cancelled while we were away
    v.path = [];
  }
  const targets = blueprint ? adjacentToStructure(w, blueprint) : homeSpot(w, v);
  const t = travelTo(w, v, targets);
  if (t === "unreachable") {
    if (blueprint) {
      g.deliverTo = undefined;
      v.path = [];
      return "running";
    }
    depositInventory(v); // nowhere to walk to; keep it anyway
    return "done";
  }
  if (t !== "arrived") return "running";
  if (blueprint) {
    const left = remainingCost(blueprint, STRUCTURES[blueprint.kind].cost);
    if ((left[g.resource] ?? 0) > 0) deliverMaterials(blueprint, STRUCTURES[blueprint.kind].cost, v);
  }
  depositInventory(v);
  return "done";
}

function switchToReturn(g: Extract<Goal, { type: "gather" }>, v: Villager): StepResult {
  g.phase = "returning";
  v.path = [];
  return "running";
}
