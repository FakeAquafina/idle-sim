import { describe, expect, it } from "vitest";
import { findPath, findPathToAny } from "../src/sim/pathfind.ts";
import { createWorld } from "../src/sim/world.ts";

function openWorld() {
  const w = createWorld(1, 12, 12);
  w.structures = [];
  w.tiles = w.tiles.map(() => ({ kind: "grass" as const, amount: 0 }));
  return w;
}

describe("pathfinding", () => {
  it("finds a straight path on open ground", () => {
    const w = openWorld();
    const path = findPath(w, { x: 0, y: 0 }, { x: 5, y: 0 });
    expect(path).not.toBeNull();
    expect(path!.length).toBe(5);
    expect(path![4]).toEqual({ x: 5, y: 0 });
  });

  it("routes around water", () => {
    const w = openWorld();
    for (let y = 0; y < 11; y++) w.tiles[y * w.width + 5] = { kind: "water", amount: 0 };
    const path = findPath(w, { x: 0, y: 0 }, { x: 10, y: 0 });
    expect(path).not.toBeNull();
    expect(path!.some((p) => p.y === 11)).toBe(true);
  });

  it("returns null when the target is sealed off", () => {
    const w = openWorld();
    for (let y = 0; y < 12; y++) w.tiles[y * w.width + 5] = { kind: "water", amount: 0 };
    expect(findPath(w, { x: 0, y: 0 }, { x: 10, y: 0 })).toBeNull();
  });

  it("returns an empty path when already at a goal", () => {
    const w = openWorld();
    expect(findPathToAny(w, { x: 3, y: 3 }, new Set([3 * 12 + 3]))).toEqual([]);
  });
});
