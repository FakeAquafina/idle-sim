// The fresh start: nothing but clothes, a hidden shrine, personal bundles,
// blueprints fed by whoever helps, a market, and the travelling merchant.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MARKET_FLOAT, PRICES, TICKS_PER_DAY, type WorldState } from "@idle-sim/shared";
import { tickMerchant } from "../src/sim/merchant.ts";
import { seedVillagers } from "../src/sim/seed.ts";
import { tickWorld } from "../src/sim/tick.ts";
import { tileCenter } from "../src/sim/world.ts";
import type { Persona } from "../src/sim/villager.ts";
import { createWorld, findPlacement, placeStructure, structuresWithFunction, villageStock } from "../src/sim/world.ts";

const personas = JSON.parse(readFileSync(new URL("../data/villagers.json", import.meta.url), "utf8")) as Persona[];

function fresh(seed = 2026): WorldState {
  const w = createWorld(seed);
  seedVillagers(w, personas);
  return w;
}

describe("the fresh start", () => {
  it("settlers own nothing, there is no common store, and a fire goes up before anything else", () => {
    const w = fresh();
    expect(w.villagers.every((v) => Object.keys(v.stock).length === 0 && v.coins === 0)).toBe(true);
    expect(w.structures.filter((s) => s.kind !== "shrine")).toEqual([]);
    for (let i = 0; i < 1500 && !w.structures.some((s) => s.built && s.kind === "campfire"); i++) tickWorld(w, { populationMax: 20 });
    const builtKinds = w.structures.filter((s) => s.built && s.kind !== "shrine").map((s) => s.kind);
    expect(builtKinds[0]).toBe("campfire");
    expect(w.villagers.every((v) => v.alive)).toBe(true);
  }, 60_000);

  it("a village survives its first two days on what it gathers, and the harvest belongs to the harvester", () => {
    const w = fresh(7);
    for (let i = 0; i < 2 * TICKS_PER_DAY; i++) tickWorld(w, { populationMax: 20 });
    expect(w.villagers.every((v) => v.alive)).toBe(true);
    expect(villageStock(w).food).toBeGreaterThan(0);
    expect(w.villagers.some((v) => Object.values(v.stock).some((n) => (n ?? 0) > 0))).toBe(true);
  }, 120_000);
});

describe("blueprints are fed by whoever helps", () => {
  it("materials come from a helper's own bundle and work starts once everything is on site", () => {
    const w = fresh(3);
    const spot = findPlacement(w, "campfire", w.camp, 4)!;
    const v = w.villagers[0];
    for (const o of w.villagers) o.needs = { hunger: 100, energy: 100, social: 100, warmth: 100 };
    v.stock = { wood: 5, stone: 3 };
    const s = placeStructure(w, "campfire", spot.x, spot.y)!;
    expect(s.delivered).toEqual({});
    v.goal = { type: "build", structureId: s.id };
    v.goalStartedTick = w.clock.tick;
    v.source = "ai";
    for (let i = 0; i < 4000 && !s.built; i++) tickWorld(w, { populationMax: 20 });
    expect(s.built).toBe(true);
    expect(s.delivered).toEqual({ wood: 5, stone: 3 });
    expect(villageStock(w).wood).toBeLessThan(5 + 40); // what was handed over is gone; others may have gathered meanwhile
    expect(s.keeperId).toBeDefined();
  }, 60_000);
});

describe("the hidden shrine", () => {
  it("is found by whoever walks close, and only then can anyone petition", () => {
    const w = fresh(5);
    const shrine = w.structures.find((s) => s.kind === "shrine")!;
    expect(shrine.hidden).toBe(true);
    expect(structuresWithFunction(w, "petition")).toEqual([]);
    const v = w.villagers[0];
    v.pos = tileCenter({ x: shrine.x + 1, y: shrine.y + 1 });
    for (let i = 0; i < 25; i++) tickWorld(w, { populationMax: 20 });
    expect(shrine.hidden).toBe(false);
    expect(structuresWithFunction(w, "petition").length).toBe(1);
    expect(w.events.some((e) => e.kind === "discovery" && e.villagerIds?.[0] === v.id)).toBe(true);
    expect(w.villagers.every((o) => o.memory.some((m) => m.includes("shrine")))).toBe(true);
  });
});

describe("market and merchant", () => {
  function withMarket(seed = 11) {
    const w = fresh(seed);
    for (const o of w.villagers) o.needs = { hunger: 100, energy: 100, social: 100, warmth: 100 };
    const spot = findPlacement(w, "market", w.camp, 6)!;
    const market = placeStructure(w, "market", spot.x, spot.y, { built: true, free: true })!;
    return { w, market };
  }

  it("a seller gets coin from the till and a buyer pays coin for goods", () => {
    const { w, market } = withMarket();
    expect(market.till).toBe(MARKET_FLOAT);
    const [seller, buyer] = w.villagers;
    seller.stock = { wood: 20 };
    seller.goal = { type: "trade", side: "sell", resource: "wood", amount: 5, phase: "fetching" };
    seller.goalStartedTick = w.clock.tick;
    seller.source = "ai";
    for (let i = 0; i < 3000 && seller.goal?.type === "trade"; i++) tickWorld(w, { populationMax: 20 });
    expect(seller.coins).toBe(5 * PRICES.wood);
    expect(market.goods?.wood).toBe(5);
    expect(market.till).toBe(MARKET_FLOAT - 5 * PRICES.wood);

    buyer.coins = 10;
    buyer.goal = { type: "trade", side: "buy", resource: "wood", amount: 3, phase: "to_market" };
    buyer.goalStartedTick = w.clock.tick;
    buyer.source = "ai";
    for (let i = 0; i < 3000 && buyer.goal?.type === "trade"; i++) tickWorld(w, { populationMax: 20 });
    expect(buyer.stock.wood).toBe(3);
    expect(buyer.coins).toBe(10 - 3 * (PRICES.wood + 1));
    expect(market.goods?.wood).toBe(2);
  }, 60_000);

  it("the merchant comes down the north road, buys what is on the stall, leaves seeds, and goes", () => {
    const { w, market } = withMarket(13);
    market.goods = { wood: 10 };
    w.clock.tick = 2 * TICKS_PER_DAY; // past the first-visit delay
    w.clock.isNight = false;
    w.clock.weather = "clear";
    for (let i = 0; i < 20 && !w.merchant; i++) tickMerchant(w);
    expect(w.merchant).toBeDefined();
    expect(w.merchant!.phase).toBe("arriving");
    const tillBefore = market.till!;
    for (let i = 0; i < 20000 && w.merchant; i++) {
      tickMerchant(w);
      w.clock.tick++;
    }
    expect(w.merchant).toBeUndefined();
    const woodSold = 10 - market.goods!.wood!;
    const seedsBought = market.goods!.seeds ?? 0;
    expect(woodSold).toBeGreaterThan(0); // he bought some wood
    expect(seedsBought).toBeGreaterThan(0); // and left seeds on the stall
    // Coin is conserved: the till paid for the seeds with what he paid for the wood.
    expect(market.till).toBe(tillBefore + woodSold * PRICES.wood - seedsBought * PRICES.seeds);
    expect(market.till).toBeGreaterThanOrEqual(0);
    const texts = w.events.filter((e) => e.kind === "merchant").map((e) => e.text);
    expect(texts.some((t) => t.includes("comes down the north road"))).toBe(true);
    expect(texts.some((t) => t.includes("takes the north road"))).toBe(true);
  }, 60_000);

  it("without a stall the merchant only drops a hint", () => {
    const w = fresh(17);
    w.clock.tick = 2 * TICKS_PER_DAY;
    w.clock.isNight = false;
    for (let i = 0; i < 20 && !w.merchant; i++) tickMerchant(w);
    for (let i = 0; i < 20000 && w.merchant; i++) {
      tickMerchant(w);
      w.clock.tick++;
    }
    expect(w.merchantHinted).toBe(true);
    expect(w.events.some((e) => e.kind === "merchant" && e.text.includes("market stall"))).toBe(true);
  });
});
