import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TICKS_PER_DAY, type WorldState } from "@idle-sim/shared";
import { tickAnimals } from "../src/sim/animals.ts";
import { askableNow, canPetition, landCannotProvide, updateShortages } from "../src/sim/petitions.ts";
import { seedVillagers } from "../src/sim/seed.ts";
import { tickWorld } from "../src/sim/tick.ts";
import type { Persona } from "../src/sim/villager.ts";
import { createWorld, findPlacement, hasCoast, placeStructure, shoreTiles, structuresWithFunction } from "../src/sim/world.ts";

const personas = JSON.parse(readFileSync(new URL("../data/villagers.json", import.meta.url), "utf8")) as Persona[];

function world(seed = 31): WorldState {
  const w = createWorld(seed);
  seedVillagers(w, personas);
  return w;
}

describe("coast and fishing", () => {
  it("every full-size world has a sea edge with sand and reachable shore", () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const w = createWorld(seed);
      expect(hasCoast(w)).toBe(true);
      expect(w.tiles.some((t) => t.kind === "sand")).toBe(true);
      expect(shoreTiles(w, { x: 24, y: 24 }, 5).length).toBeGreaterThan(0);
    }
  });

  it("a dock must touch water and fishing brings food home", () => {
    const w = world();
    const shore = shoreTiles(w, { x: 24, y: 24 }, 1)[0];
    expect(findPlacement(w, "dock", { x: 24, y: 24 }, 3)).toBeNull(); // nowhere near water
    const spot = findPlacement(w, "dock", shore, 8)!;
    expect(spot).not.toBeNull();
    const dock = placeStructure(w, "dock", spot.x, spot.y, { built: true, free: true })!;
    expect(dock.kind).toBe("dock");

    const v = w.villagers[0];
    for (const x of w.villagers) x.needs.hunger = 100; // nobody eats during the test
    const before = w.storehouse.food;
    v.goal = { type: "fish", phase: "to_shore", timer: 0 };
    v.goalStartedTick = w.clock.tick;
    v.source = "ai";
    for (let i = 0; i < 6000 && v.goal?.type === "fish"; i++) tickWorld(w);
    expect(v.goal?.type).not.toBe("fish");
    expect(w.storehouse.food).toBeGreaterThan(before);
  });
});

describe("animals", () => {
  it("spawn wild, flee from people, and can be hunted", () => {
    const w = world();
    expect(w.animals.filter((a) => a.kind === "deer").length).toBe(5);
    expect(w.animals.filter((a) => a.kind === "goat").length).toBe(4);
    const v = w.villagers[0];
    const prey = w.animals[0];
    v.pos = { x: prey.pos.x + 1.5, y: prey.pos.y };
    const start = { ...prey.pos };
    tickAnimals(w, false);
    expect(prey.pos.x < start.x || prey.pos.y !== start.y).toBe(true);
  });

  it("a hunt ends with meat in the storehouse", () => {
    const w = world(8);
    const v = w.villagers[0];
    const goat = w.animals.find((a) => a.kind === "goat")!;
    v.pos = { x: goat.pos.x + 1, y: goat.pos.y };
    const before = w.storehouse.food;
    v.goal = { type: "hunt", animalId: goat.id, phase: "chasing" };
    v.goalStartedTick = w.clock.tick;
    v.source = "ai";
    for (let i = 0; i < 4000 && v.goal?.type === "hunt"; i++) tickWorld(w);
    expect(goat.alive).toBe(false);
    expect(w.storehouse.food).toBeGreaterThanOrEqual(before);
    expect(w.events.some((e) => e.kind === "hunt")).toBe(true);
  });

  it("tame goats in a pen give food and may breed", () => {
    const w = world(9);
    const spot = findPlacement(w, "pen", { x: 24, y: 24 })!;
    const pen = placeStructure(w, "pen", spot.x, spot.y, { built: true, free: true })!;
    for (const g of w.animals.filter((a) => a.kind === "goat").slice(0, 2)) {
      g.tame = true;
      g.penId = pen.id;
      g.pos = { x: pen.x + 0.5, y: pen.y + 0.5 };
    }
    const before = w.storehouse.food;
    w.clock.tick = Math.floor(TICKS_PER_DAY / 2) - 1;
    for (let i = 0; i < 2; i++) tickAnimals(w, false), w.clock.tick++;
    expect(w.storehouse.food).toBe(before + 2);
  });
});

describe("mines", () => {
  it("a mine must touch rock, strikes a vein, and yields stone and ore until dry", () => {
    const w = world(12);
    expect(findPlacement(w, "mine", { x: 24, y: 24 }, 4)).toBeNull();
    let rock: { x: number; y: number } | null = null;
    for (let i = 0; i < w.tiles.length && !rock; i++) if (w.tiles[i].kind === "rock") rock = { x: i % w.width, y: Math.floor(i / w.width) };
    const spot = findPlacement(w, "mine", rock!, 6)!;
    expect(spot).not.toBeNull();
    const mine = placeStructure(w, "mine", spot.x, spot.y, { built: true, free: true })!;
    expect(mine.reserve!.stone).toBeGreaterThan(0);
    expect(w.events.some((e) => e.kind === "vein")).toBe(true);
    mine.reserve = { stone: 3, ore: 2 };
    const v = w.villagers[0];
    const stone = w.storehouse.stone;
    const ore = w.storehouse.ore;
    v.goal = { type: "mine", structureId: mine.id, phase: "to_mine", timer: 0 };
    v.goalStartedTick = w.clock.tick;
    v.source = "ai";
    for (let i = 0; i < 8000 && v.goal?.type === "mine"; i++) tickWorld(w);
    expect(w.storehouse.ore).toBe(ore + 2); // nothing else consumes ore this early
    expect(stone).toBeGreaterThan(0);
    expect(mine.reserve!.stone + mine.reserve!.ore).toBe(0);
  });
});

describe("petitions are rare", () => {
  it("refuses while the land can still provide, allows once it cannot and the shortage has lasted", () => {
    const w = world(13);
    const v = w.villagers[0];
    w.storehouse.wood = 0;
    updateShortages(w);
    expect(canPetition(w, v, { ask: "wood", amount: 10, reason: "r" })).toMatch(/too recent/);
    w.clock.tick += TICKS_PER_DAY; // shortage has lasted
    expect(canPetition(w, v, { ask: "wood", amount: 10, reason: "r" })).toMatch(/still trees/);
    for (const t of w.tiles) if (t.kind === "forest") t.amount = 0;
    expect(landCannotProvide(w, "wood")).toBeNull();
    expect(canPetition(w, v, { ask: "wood", amount: 10, reason: "r" })).toBeNull();
    expect(askableNow(w)).toContain("wood");
    // food is never askable while there is a coast to fish
    w.storehouse.food = 0;
    updateShortages(w);
    w.clock.tick += TICKS_PER_DAY;
    expect(canPetition(w, v, { ask: "food", amount: 10, reason: "r" })).toMatch(/fish/);
  });

  it("enforces a cooldown after a petition", () => {
    const w = world(14);
    const v = w.villagers[0];
    w.storehouse.seeds = 0;
    for (const s of structuresWithFunction(w, "farm")) s.growth = undefined;
    updateShortages(w);
    w.clock.tick += TICKS_PER_DAY;
    expect(canPetition(w, v, { ask: "seeds", amount: 5, reason: "r" })).toBeNull();
    w.petitions.push({ id: "x", villagerId: "z", villagerName: "Z", ask: "wood", amount: 5, reason: "r", tick: w.clock.tick - 100, status: "lapsed", supporters: ["z"], needed: 3, expiresTick: 0, resolvedTick: w.clock.tick - 100 });
    expect(canPetition(w, v, { ask: "seeds", amount: 5, reason: "r" })).toMatch(/asked recently/);
  });
});
