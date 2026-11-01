// Trading at the market stall. Sellers fetch goods from home and sell them to
// the stall for coin from the till; buyers pay coin and take goods from the
// stall. The travelling merchant keeps the stall stocked and the till topped up.

import { MARKET_MARGIN, PRICES, type Goal, type Villager, type WorldState } from "@idle-sim/shared";
import { emitEvent } from "../events.ts";
import { addTo, depositInventory, homeSpot, takeFrom } from "../stock.ts";
import { remember } from "../villager.ts";
import { adjacentToStructure, structuresWithFunction } from "../world.ts";
import { travelTo, type StepResult } from "./helpers.ts";

export function stepTrade(w: WorldState, v: Villager, g: Extract<Goal, { type: "trade" }>): StepResult {
  const market = structuresWithFunction(w, "market")[0];
  if (!market) return "failed";
  market.goods ??= {};
  market.till ??= 0;

  if (g.side === "sell" && g.phase === "fetching") {
    const t = travelTo(w, v, homeSpot(w, v));
    if (t === "unreachable") return "failed";
    if (t !== "arrived") return "running";
    const n = takeFrom(v.stock, g.resource, g.amount);
    if (n === 0) return "failed";
    addTo(v.inventory, g.resource, n);
    g.phase = "to_market";
    v.path = [];
    return "running";
  }

  const t = travelTo(w, v, adjacentToStructure(w, market));
  if (t === "unreachable") {
    depositInventory(v);
    return "failed";
  }
  if (t !== "arrived") return "running";

  if (g.side === "sell") {
    const have = v.inventory[g.resource] ?? 0;
    const price = PRICES[g.resource];
    const n = Math.min(have, Math.floor(market.till / price));
    if (n <= 0) {
      depositInventory(v);
      remember(v, `The stall had no coin for my ${g.resource} today.`);
      return "failed";
    }
    v.inventory[g.resource] = have - n;
    addTo(market.goods, g.resource, n);
    market.till -= n * price;
    v.coins += n * price;
    depositInventory(v);
    remember(v, `I sold ${n} ${g.resource} at the stall for ${n * price} coin.`);
    emitEvent(w, "trade", `${v.name} sells ${n} ${g.resource} at the market for ${n * price} coin.`, { villagerIds: [v.id], pos: { x: market.x, y: market.y } });
    return "done";
  }

  const price = PRICES[g.resource] + MARKET_MARGIN;
  const n = Math.min(g.amount, market.goods[g.resource] ?? 0, Math.floor(v.coins / price));
  if (n <= 0) return "failed";
  takeFrom(market.goods, g.resource, n);
  v.coins -= n * price;
  market.till += n * price;
  addTo(v.stock, g.resource, n);
  remember(v, `I bought ${n} ${g.resource} at the stall for ${n * price} coin.`);
  emitEvent(w, "trade", `${v.name} buys ${n} ${g.resource} at the market for ${n * price} coin.`, { villagerIds: [v.id], pos: { x: market.x, y: market.y } });
  return "done";
}
