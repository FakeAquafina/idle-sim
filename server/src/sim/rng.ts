// Deterministic random numbers. The state lives inside WorldState so a saved
// world resumes with the exact same random sequence.

import type { WorldState } from "@idle-sim/shared";

/** mulberry32: returns a float in [0, 1). */
export function nextRandom(w: WorldState): number {
  w.rngState = (w.rngState + 0x6d2b79f5) | 0;
  let t = w.rngState;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Integer in [min, max] inclusive. */
export function randInt(w: WorldState, min: number, max: number): number {
  return min + Math.floor(nextRandom(w) * (max - min + 1));
}

export function pick<T>(w: WorldState, items: readonly T[]): T {
  return items[Math.floor(nextRandom(w) * items.length)];
}

export function chance(w: WorldState, p: number): boolean {
  return nextRandom(w) < p;
}
