// A travelling merchant comes down the north road every few days. If the
// village has a market stall he buys what is piled on it and leaves his own
// wares (seeds, ore, sometimes food) for sale; if not, he passes through and
// drops a hint. Coin enters the village through him and nowhere else.

import { PRICES, TICKS_PER_DAY, type Inventory, type Merchant, type ResourceKind, type Vec2, type WorldState } from "@idle-sim/shared";
import { emitEvent } from "./events.ts";
import { findPathToAny } from "./pathfind.ts";
import { chance, randInt } from "./rng.ts";
import { RESOURCES, addTo, takeFrom } from "./stock.ts";
import { WALK_SPEED } from "./villager.ts";
import { adjacentToStructure, isWalkable, structuresWithFunction, tileCenter, toTileSet, villageCenter } from "./world.ts";

export const MERCHANT_GAP_DAYS = 3;
/** First visit is not before this many sim days. */
const FIRST_VISIT_DAYS = 1.5;
const STAY_TICKS = Math.floor(TICKS_PER_DAY / 3);

/** A walkable tile on the north edge: the road in and out. */
function roadTile(w: WorldState): Vec2 {
  for (let i = 0; i < 60; i++) {
    const t = { x: randInt(w, 2, w.width - 3), y: randInt(w, 0, 2) };
    if (isWalkable(w, t.x, t.y)) return t;
  }
  return { x: Math.floor(w.width / 2), y: 0 };
}

function destination(w: WorldState): Vec2[] {
  const market = structuresWithFunction(w, "market")[0];
  if (market) return adjacentToStructure(w, market);
  const c = villageCenter(w);
  const ring: Vec2[] = [];
  for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 2; dy++) if (isWalkable(w, c.x + dx, c.y + dy)) ring.push({ x: c.x + dx, y: c.y + dy });
  return ring;
}

function pathTo(w: WorldState, m: Merchant, targets: Vec2[]): boolean {
  const from = { x: Math.floor(m.pos.x), y: Math.floor(m.pos.y) };
  const path = findPathToAny(w, from, toTileSet(w, targets), 20000);
  if (!path) return false;
  m.path = path;
  return true;
}

function wares(w: WorldState): Inventory {
  const goods: Inventory = { seeds: randInt(w, 4, 8) };
  if (chance(w, 0.7)) goods.ore = randInt(w, 2, 5);
  if (w.clock.season === "autumn" || w.clock.season === "winter" || chance(w, 0.3)) goods.food = randInt(w, 6, 12);
  return goods;
}

export function tickMerchant(w: WorldState): void {
  const m = w.merchant;
  if (!m) {
    const since = w.clock.tick - (w.lastMerchantTick ?? -Infinity);
    const due = w.clock.tick >= FIRST_VISIT_DAYS * TICKS_PER_DAY && since >= MERCHANT_GAP_DAYS * TICKS_PER_DAY;
    if (!due || w.clock.isNight || w.clock.weather === "storm") return;
    const start = roadTile(w);
    const merchant: Merchant = { pos: tileCenter(start), path: [], phase: "arriving", untilTick: 0, goods: wares(w), coins: randInt(w, 40, 80) };
    if (!pathTo(w, merchant, destination(w))) return; // try again next tick
    w.merchant = merchant;
    w.lastMerchantTick = w.clock.tick;
    emitEvent(w, "merchant", "A travelling merchant comes down the north road, pack creaking.", { pos: start });
    return;
  }

  if (m.path.length) {
    step(m);
    return;
  }

  if (m.phase === "arriving") {
    const market = structuresWithFunction(w, "market")[0];
    if (market) {
      trade(w, m, market);
      m.phase = "trading";
      m.untilTick = w.clock.tick + STAY_TICKS;
    } else {
      if (!w.merchantHinted) {
        w.merchantHinted = true;
        emitEvent(w, "merchant", `The merchant looks the camp over. "Put up a market stall," he says, "and I'll trade with you next time I pass."`, { pos: { x: Math.floor(m.pos.x), y: Math.floor(m.pos.y) } });
      } else {
        emitEvent(w, "merchant", "The merchant passes through; with no stall to trade at, he does not stop long.");
      }
      leave(w, m);
    }
    return;
  }
  if (m.phase === "trading") {
    if (w.clock.tick >= m.untilTick) leave(w, m);
    return;
  }
  // leaving, and arrived at the road
  w.merchant = undefined;
}

function leave(w: WorldState, m: Merchant): void {
  m.phase = "leaving";
  if (!pathTo(w, m, [roadTile(w), roadTile(w), roadTile(w)])) w.merchant = undefined;
  else emitEvent(w, "merchant", "The merchant shoulders his pack and takes the north road.");
}

function step(m: Merchant): void {
  const target = tileCenter(m.path[0]);
  const dx = target.x - m.pos.x;
  const dy = target.y - m.pos.y;
  const d = Math.hypot(dx, dy);
  const speed = WALK_SPEED * 0.9;
  if (d <= speed) {
    m.pos = target;
    m.path.shift();
  } else {
    m.pos = { x: m.pos.x + (dx / d) * speed, y: m.pos.y + (dy / d) * speed };
  }
}

/** Buy what the stall has piled up, then set out wares for sale; both limited by coin. */
function trade(w: WorldState, m: Merchant, market: { goods?: Inventory; till?: number; x: number; y: number }): void {
  market.goods ??= {};
  market.till ??= 0;
  const bought: string[] = [];
  for (const k of RESOURCES) {
    if (k === "seeds") continue; // he came to sell those
    const price = PRICES[k];
    const n = Math.min(market.goods[k] ?? 0, Math.floor(m.coins / price));
    if (n <= 0) continue;
    takeFrom(market.goods, k, n);
    m.coins -= n * price;
    market.till += n * price;
    bought.push(`${n} ${k}`);
  }
  const sold: string[] = [];
  for (const k of Object.keys(m.goods) as ResourceKind[]) {
    const price = PRICES[k];
    const n = Math.min(m.goods[k] ?? 0, Math.floor(market.till / price));
    if (n <= 0) continue;
    takeFrom(m.goods, k, n);
    market.till -= n * price;
    m.coins += n * price;
    addTo(market.goods, k, n);
    sold.push(`${n} ${k}`);
  }
  const parts = [bought.length ? `buys ${bought.join(", ")}` : "", sold.length ? `sets out ${sold.join(", ")} for sale` : ""].filter(Boolean);
  emitEvent(w, "merchant", parts.length ? `At the stall the merchant ${parts.join(" and ")}.` : "The merchant finds nothing worth trading at the stall.", { pos: { x: market.x, y: market.y } });
}
