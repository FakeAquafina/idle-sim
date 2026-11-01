// Maps world tile coordinates to screen pixels and back. The view is top-down
// with a slight three-quarter feel (things that stand up are drawn taller than
// their footprint and overlap what is behind them), like Stardew Valley.
//
// World coordinates are continuous: tile (i, j) covers [i, i+1) × [j, j+1) and
// a villager standing in its middle is at (i + 0.5, j + 0.5).

/** Pixels per tile at zoom 1. Pixel-art packs for this look are drawn on a 16px grid. */
export const TILE = 16;

export interface Projection {
  toScreen(x: number, y: number): { x: number; y: number };
  toWorld(sx: number, sy: number): { x: number; y: number };
  /** Larger = drawn on top of smaller. Top-down sorts by how far down the screen a thing's feet are. */
  depth(x: number, y: number): number;
  /** Pixel box the whole map occupies, for fitting the camera. */
  bounds(width: number, height: number): { minX: number; minY: number; maxX: number; maxY: number };
}

export const topDown: Projection = {
  toScreen: (x, y) => ({ x: x * TILE, y: y * TILE }),
  toWorld: (sx, sy) => ({ x: sx / TILE, y: sy / TILE }),
  depth: (_x, y) => y,
  bounds: (w, h) => ({ minX: 0, minY: 0, maxX: w * TILE, maxY: h * TILE }),
};

export const projection: Projection = topDown;

/** Screen-space rectangle of a w×h block of tiles whose top-left tile is (x, y). */
export function footprintRect(x: number, y: number, w: number, h: number) {
  const p = projection.toScreen(x, y);
  return { x: p.x, y: p.y, w: w * TILE, h: h * TILE };
}
