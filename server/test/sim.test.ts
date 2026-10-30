import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DAYS_PER_SEASON, TICKS_PER_DAY, type WorldState } from "@idle-sim/shared";
import { seedVillagers } from "../src/sim/seed.ts";
import { tickWorld } from "../src/sim/tick.ts";
import type { Persona } from "../src/sim/villager.ts";
import { createWorld } from "../src/sim/world.ts";

const personas = JSON.parse(readFileSync(new URL("../data/villagers.json", import.meta.url), "utf8")) as Persona[];

function makeWorld(seed: number): WorldState {
  const w = createWorld(seed);
  seedVillagers(w, personas);
  return w;
}

function run(w: WorldState, ticks: number) {
  for (let i = 0; i < ticks; i++) tickWorld(w);
}

describe("simulation", () => {
  it("is deterministic over many ticks", () => {
    const a = makeWorld(99);
    const b = makeWorld(99);
    run(a, 5000);
    run(b, 5000);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("villagers pick goals and move", () => {
    const w = makeWorld(5);
    const start = w.villagers.map((v) => ({ ...v.pos }));
    run(w, 600);
    expect(w.villagers.every((v) => v.goal !== null || v.cooldowns)).toBe(true);
    const moved = w.villagers.filter((v, i) => v.pos.x !== start[i].x || v.pos.y !== start[i].y);
    expect(moved.length).toBeGreaterThan(0);
  });

  it("village builds something within the first sim day", () => {
    const w = makeWorld(11);
    run(w, TICKS_PER_DAY);
    const built = w.structures.filter((s) => s.built && !["storehouse", "campfire", "shrine"].includes(s.kind));
    expect(built.length).toBeGreaterThan(0);
    expect(w.villagers.every((v) => v.alive && v.needs.hunger > 0)).toBe(true);
  }, 60_000);

  it("rolls the season over after seven days", () => {
    const w = createWorld(1);
    w.clock.tick = TICKS_PER_DAY * DAYS_PER_SEASON - 2;
    run(w, 3);
    expect(w.clock.season).toBe("summer");
    expect(w.clock.dayOfSeason).toBe(0);
    expect(w.events.some((e) => e.kind === "season")).toBe(true);
  });

  it("round-trips through JSON (save/load)", () => {
    const w = makeWorld(3);
    run(w, 1000);
    const copy = JSON.parse(JSON.stringify({ ...w, dirtyTiles: [] })) as WorldState;
    run(w, 1000);
    run(copy, 1000);
    expect(JSON.stringify({ ...copy, dirtyTiles: [] })).toBe(JSON.stringify({ ...w, dirtyTiles: [] }));
  });
});
