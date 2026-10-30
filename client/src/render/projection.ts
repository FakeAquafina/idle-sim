// Maps world tile coordinates to screen pixels. Everything in the renderer goes
// through this so switching to isometric later is a one-file change.

export const TILE = 16;

export interface Projection {
  toScreen(x: number, y: number): { x: number; y: number };
  /** Larger = drawn on top. */
  depth(x: number, y: number): number;
}

export const topDown: Projection = {
  toScreen: (x, y) => ({ x: x * TILE, y: y * TILE }),
  depth: (_x, y) => y,
};

export const projection: Projection = topDown;
