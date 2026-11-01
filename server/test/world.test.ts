import { describe, expect, it } from "vitest";
import { DEFAULT_SIZE, canPlace, createWorld, findPlacement, isWalkable, placeStructure, structureAt, structuresWithFunction } from "../src/sim/world.ts";
import { establish } from "./helpers.ts";

describe("world generation", () => {
  it("starts with nothing but a hidden shrine a fair walk from a clear camp", () => {
    const w = createWorld(42);
    expect(w.tiles.length).toBe(DEFAULT_SIZE * DEFAULT_SIZE);
    expect(w.structures.map((s) => s.kind)).toEqual(["shrine"]);
    const shrine = w.structures[0];
    expect(shrine.built).toBe(true);
    expect(shrine.hidden).toBe(true);
    expect(structuresWithFunction(w, "petition")).toEqual([]); // unusable until found
    const d = Math.hypot(shrine.x - w.camp.x, shrine.y - w.camp.y);
    expect(d).toBeGreaterThanOrEqual(10);
    expect(isWalkable(w, w.camp.x, w.camp.y)).toBe(true);
    // Wood and rock within a short walk of the camp: the settlers own nothing else.
    const near = (kind: string, r: number) => w.tiles.some((t, i) => t.kind === kind && Math.hypot((i % w.width) - w.camp.x, Math.floor(i / w.width) - w.camp.y) <= r);
    expect(near("forest", 12)).toBe(true);
    expect(near("rock", 13)).toBe(true);
    expect(w.storehouse).toEqual({ wood: 0, stone: 0, food: 0, seeds: 0, ore: 0 });
  });

  it("is deterministic for a given seed", () => {
    const a = createWorld(7);
    const b = createWorld(7);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(createWorld(8))).not.toBe(JSON.stringify(a));
  });
});

describe("placement", () => {
  it("rejects overlap, water, and off-map spots", () => {
    const w = establish(createWorld(3));
    const store = w.structures.find((s) => s.kind === "storehouse")!;
    expect(canPlace(w, "house", store.x, store.y)).toBe(false);
    expect(canPlace(w, "house", store.x - 2, store.y)).toBe(false); // violates the 1-tile gap
    expect(canPlace(w, "house", -1, 5)).toBe(false);
    const water = w.tiles.findIndex((t) => t.kind === "water");
    expect(canPlace(w, "campfire", water % w.width, Math.floor(water / w.width))).toBe(false);
  });

  it("lays out a blueprint without taking anyone's materials, and blocks walking", () => {
    const w = establish(createWorld(3));
    const spot = findPlacement(w, "house", w.camp)!;
    expect(spot).not.toBeNull();
    const woodBefore = w.storehouse.wood;
    const s = placeStructure(w, "house", spot.x, spot.y)!;
    expect(s).not.toBeNull();
    expect(w.storehouse.wood).toBe(woodBefore); // materials are brought to the blueprint later
    expect(s.delivered).toEqual({});
    expect(structureAt(w, spot.x, spot.y)?.id).toBe(s.id);
    expect(isWalkable(w, spot.x, spot.y)).toBe(false);
  });

  it("refuses to lay out what the village, all together, cannot afford", () => {
    const w = establish(createWorld(3));
    w.storehouse.wood = 0;
    const spot = findPlacement(w, "house", w.camp)!;
    expect(placeStructure(w, "house", spot.x, spot.y)).toBeNull();
  });
});
