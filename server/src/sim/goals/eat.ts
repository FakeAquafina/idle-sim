// Eating: from the hand if carrying food, else from one's own (or the
// household's) stock at home, else the common store, else the market stall.

import { MARKET_MARGIN, PRICES, type Goal, type Villager, type WorldState } from "@idle-sim/shared";
import { hasStorehouse, homeSpot, householdStock, takeFrom, takeFromHousehold } from "../stock.ts";
import { adjacentToStructure, structuresWithFunction } from "../world.ts";
import { travelTo, type StepResult } from "./helpers.ts";

const MEAL = 40;

export function stepEat(w: WorldState, v: Villager, g: Extract<Goal, { type: "eat" }>): StepResult {
  if ((v.inventory.food ?? 0) > 0) {
    takeFrom(v.inventory, "food", 1);
    return eat(v);
  }
  if (!g.from) {
    g.from = pickSource(w, v);
    if (!g.from) return "failed";
    v.path = [];
  }
  const store = structuresWithFunction(w, "storage")[0];
  const market = structuresWithFunction(w, "market")[0];
  const targets = g.from === "home" ? homeSpot(w, v) : g.from === "store" && store ? adjacentToStructure(w, store) : market ? adjacentToStructure(w, market) : [];
  const t = travelTo(w, v, targets);
  if (t === "unreachable") return "failed";
  if (t !== "arrived") return "running";

  if (g.from === "home" && takeFromHousehold(w, v, "food", 1) === 1) return eat(v);
  if (g.from === "store" && store && w.storehouse.food > 0) {
    w.storehouse.food -= 1;
    return eat(v);
  }
  if (g.from === "market" && market && (market.goods?.food ?? 0) > 0) {
    const price = PRICES.food + MARKET_MARGIN;
    if (v.coins >= price) {
      v.coins -= price;
      market.till = (market.till ?? 0) + price;
      takeFrom(market.goods!, "food", 1);
      return eat(v);
    }
  }
  // Gone by the time we got there: try the next source once, then give up.
  const next = pickSource(w, v);
  if (!next || next === g.from) return "failed";
  g.from = next;
  v.path = [];
  return "running";
}

function eat(v: Villager): StepResult {
  v.needs.hunger = Math.min(100, v.needs.hunger + MEAL);
  return "done";
}

function pickSource(w: WorldState, v: Villager): "home" | "store" | "market" | undefined {
  if (householdStock(w, v).food > 0) return "home";
  if (hasStorehouse(w) && w.storehouse.food > 0) return "store";
  const market = structuresWithFunction(w, "market")[0];
  if (market && (market.goods?.food ?? 0) > 0 && v.coins >= PRICES.food + MARKET_MARGIN) return "market";
  return undefined;
}
