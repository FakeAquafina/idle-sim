import { describe, expect, it } from "vitest";
import { canPlace, createWorld, findPlacement, isWalkable, placeStructure, structureAt } from "../src/sim/world.ts";

describe("world generation", () => {
  it("creates a grid with starting structures and a clear center", () => {
    const w = createWorld(42);
    expect(w.tiles.length).toBe(48 * 48);
    expect(w.structures.map((s) => s.kind).sort()).toEqual(["campfire", "shrine", "storehouse"]);
    expect(w.structures.every((s) => s.built)).toBe(true);
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
    const w = createWorld(3);
    const store = w.structures.find((s) => s.kind === "storehouse")!;
    expect(canPlace(w, "house", store.x, store.y)).toBe(false);
    expect(canPlace(w, "house", store.x - 2, store.y)).toBe(false); // violates the 1-tile gap
    expect(canPlace(w, "house", -1, 5)).toBe(false);
    const water = w.tiles.findIndex((t) => t.kind === "water");
    expect(canPlace(w, "campfire", water % w.width, Math.floor(water / w.width))).toBe(false);
  });

  it("deducts resources and blocks walking", () => {
    const w = createWorld(3);
    const spot = findPlacement(w, "house", { x: 24, y: 24 })!;
    expect(spot).not.toBeNull();
    const woodBefore = w.storehouse.wood;
    const s = placeStructure(w, "house", spot.x, spot.y)!;
    expect(s).not.toBeNull();
    expect(w.storehouse.wood).toBe(woodBefore - 20);
    expect(structureAt(w, spot.x, spot.y)?.id).toBe(s.id);
    expect(isWalkable(w, spot.x, spot.y)).toBe(false);
  });

  it("refuses to place what the village cannot afford", () => {
    const w = createWorld(3);
    w.storehouse.wood = 0;
    const spot = findPlacement(w, "house", { x: 24, y: 24 })!;
    expect(placeStructure(w, "house", spot.x, spot.y)).toBeNull();
  });
});
