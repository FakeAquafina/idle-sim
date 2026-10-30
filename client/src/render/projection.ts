// Maps world tile coordinates to screen pixels and back. Everything in the
// renderer goes through this, so the view can be swapped in one place.
//
// World coordinates are continuous: tile (i, j) covers [i, i+1) × [j, j+1) and
// a villager standing in its middle is at (i + 0.5, j + 0.5).

export const TILE_W = 32;
export const TILE_H = 16;

export interface Projection {
  toScreen(x: number, y: number): { x: number; y: number };
  toWorld(sx: number, sy: number): { x: number; y: number };
  /** Larger = drawn on top of smaller. */
  depth(x: number, y: number): number;
  /** Pixel box the whole map occupies, for fitting the camera. */
  bounds(width: number, height: number): { minX: number; minY: number; maxX: number; maxY: number };
}

/**
 * Classic 2:1 isometric. World +x runs down-right on screen, +y runs down-left,
 * so a tile is a 32×16 diamond and the map is a big diamond with its top at (0,0).
 */
export const isometric: Projection = {
  toScreen: (x, y) => ({ x: (x - y) * (TILE_W / 2), y: (x + y) * (TILE_H / 2) }),
  toWorld: (sx, sy) => ({ x: sy / TILE_H + sx / TILE_W, y: sy / TILE_H - sx / TILE_W }),
  depth: (x, y) => x + y,
  bounds: (w, h) => ({
    minX: -h * (TILE_W / 2),
    minY: 0,
    maxX: w * (TILE_W / 2),
    maxY: (w + h) * (TILE_H / 2),
  }),
};

/** The Phase 1 view, kept for reference and debugging. */
export const topDown: Projection = {
  toScreen: (x, y) => ({ x: x * TILE_W, y: y * TILE_W }),
  toWorld: (sx, sy) => ({ x: sx / TILE_W, y: sy / TILE_W }),
  depth: (_x, y) => y,
  bounds: (w, h) => ({ minX: 0, minY: 0, maxX: w * TILE_W, maxY: h * TILE_W }),
};

export const projection: Projection = isometric;

/** Screen-space corners of the footprint of a w×h block of tiles whose top tile is (x, y). */
export function footprint(x: number, y: number, w: number, h: number) {
  return {
    top: projection.toScreen(x, y),
    right: projection.toScreen(x + w, y),
    bottom: projection.toScreen(x + w, y + h),
    left: projection.toScreen(x, y + h),
  };
}
