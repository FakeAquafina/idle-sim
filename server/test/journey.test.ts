// Journeys: leaving by the north road, coming home with something new, or not at all.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { JOURNEY_GIVE_UP_DAYS, TICKS_PER_DAY, type WorldState } from "@idle-sim/shared";
import { planToGoal } from "../src/brain/apply.ts";
import { cannotJourney, depart, tickJourneys } from "../src/sim/journey.ts";
import { seedVillagers } from "../src/sim/seed.ts";
import { tickWorld } from "../src/sim/tick.ts";
import type { Persona } from "../src/sim/villager.ts";
import { createWorld, discoveryBonus } from "../src/sim/world.ts";
import { establish } from "./helpers.ts";

const personas = JSON.parse(readFileSync(new URL("../data/villagers.json", import.meta.url), "utf8")) as Persona[];

function world(seed = 61): WorldState {
  const w = createWorld(seed);
  seedVillagers(w, personas);
  establish(w);
  for (const v of w.villagers) v.needs = { hunger: 100, energy: 100, social: 100, warmth: 100 };
  return w;
}

describe("journeys", () => {
  it("one grown villager at a time may go, and the planner refuses while a blueprint waits", () => {
    const w = world();
    const [a, b] = w.villagers;
    expect(cannotJourney(w, a)).toBeNull();
    a.stage = "child";
    expect(cannotJourney(w, a)).toMatch(/grown/);
    a.stage = "adult";
    depart(w, a);
    expect(a.away).toBeDefined();
    expect(cannotJourney(w, b)).toMatch(/already away/);
    expect(w.events.some((e) => e.kind === "journey" && e.villagerIds?.[0] === a.id)).toBe(true);
    expect(b.memory.some((m) => m.includes("journey"))).toBe(true);
  });

  it("a traveller is off the map, then comes home with coin, goods and something the village did not know", () => {
    const w = world(62);
    const v = w.villagers[0];
    depart(w, v);
    // Make sure this one is coming back.
    v.away = { sinceTick: w.clock.tick, returnTick: w.clock.tick + TICKS_PER_DAY };
    const hungerBefore = v.needs.hunger;
    for (let i = 0; i < 100; i++) tickWorld(w, { populationMax: 20 });
    expect(v.needs.hunger).toBe(hungerBefore); // needs don't run while away
    w.clock.tick = v.away!.returnTick! - 1;
    tickJourneys(w);
    expect(v.away).toBeDefined();
    w.clock.tick++;
    tickJourneys(w);
    expect(v.away).toBeUndefined();
    expect(v.coins).toBeGreaterThan(0);
    expect((v.stock.seeds ?? 0) + (v.stock.ore ?? 0)).toBeGreaterThan(0);
    expect(w.discoveries.length + w.events.filter((e) => e.text.includes("lot of stories")).length).toBeGreaterThan(0);
    if (w.discoveries.length) expect(discoveryBonus(w, w.discoveries[0].effect)).toBeGreaterThan(1);
  });

  it("a traveller nobody hears from is given up on, and is gone but not dead", () => {
    const w = world(63);
    const v = w.villagers[1];
    const partner = w.villagers[2];
    v.partnerId = partner.id;
    partner.partnerId = v.id;
    depart(w, v);
    v.away = { sinceTick: w.clock.tick, returnTick: null };
    w.clock.tick += JOURNEY_GIVE_UP_DAYS * TICKS_PER_DAY;
    tickJourneys(w);
    expect(v.alive).toBe(false);
    expect(v.departed).toBe(true);
    expect(v.deathCause).toBeUndefined();
    expect(partner.partnerId).toBeUndefined();
    expect(partner.memory.some((m) => m.includes(v.name))).toBe(true);
    expect(w.events.some((e) => e.kind === "journey_lost")).toBe(true);
  });

  it("Claude may send someone journeying only when the village can spare them", () => {
    const w = world(64);
    const v = w.villagers[0];
    const plan = { thought: "t", say: null, action: "journey" as const, target: null, petition: null, memory_note: null };
    expect(planToGoal(w, v, plan).goal?.type).toBe("journey");
    v.needs.hunger = 20;
    expect(planToGoal(w, v, plan).reason).toMatch(/hungry/);
  });
});
