// World creation, terrain generation, and spatial helpers.

import {
  STRUCTURES,
  tileIndex,
  type Inventory,
  type ResourceKind,
  type Structure,
  type StructureFunction,
  type Tile,
  type TileKind,
  type Vec2,
  type WorldState,
} from "@idle-sim/shared";
import { makeClock } from "./clock.ts";
import { nextRandom, randInt } from "./rng.ts";

export const DEFAULT_SIZE = 48;

export function createWorld(seed: number, width = DEFAULT_SIZE, height = DEFAULT_SIZE): WorldState {
  const w: WorldState = {
    seed,
    rngState: seed | 0,
    width,
    height,
    tiles: [],
    structures: [],
    villagers: [],
    storehouse: { wood: 30, stone: 10, food: 40, seeds: 6 },
    clock: makeClock(),
    events: [],
    nextId: 1,
    paused: false,
    speed: 1,
    dirtyTiles: [],
  };
  generateTerrain(w);
  placeStartingStructures(w);
  w.dirtyTiles = [];
  return w;
}

// ---- Terrain ---------------------------------------------------------------

function fill(w: WorldState, kind: TileKind) {
  w.tiles = Array.from({ length: w.width * w.height }, () => ({ kind, amount: 0 }));
}

/** Paint an irregular blob by random-walking from a center. */
function blob(w: WorldState, cx: number, cy: number, steps: number, kind: TileKind, amount: () => number) {
  let x = cx;
  let y = cy;
  for (let i = 0; i < steps; i++) {
    if (inBounds(w, x, y)) {
      const t = w.tiles[tileIndex(w.width, x, y)];
      if (t.kind !== "water") w.tiles[tileIndex(w.width, x, y)] = { kind, amount: amount() };
    }
    const dir = randInt(w, 0, 3);
    if (dir === 0) x++;
    else if (dir === 1) x--;
    else if (dir === 2) y++;
    else y--;
    // Pull back toward the center so blobs stay compact.
    if (Math.abs(x - cx) > 6) x += x > cx ? -2 : 2;
    if (Math.abs(y - cy) > 6) y += y > cy ? -2 : 2;
  }
}

function generateTerrain(w: WorldState) {
  fill(w, "grass");
  const cx = Math.floor(w.width / 2);
  const cy = Math.floor(w.height / 2);

  // Keep lakes/forests/rocks away from the village center (scaled for small test maps).
  const minDist = Math.min(14, Math.floor(Math.min(w.width, w.height) / 3.5));
  const farFromCenter = (): Vec2 => {
    for (let attempt = 0; attempt < 200; attempt++) {
      const x = randInt(w, 2, w.width - 3);
      const y = randInt(w, 2, w.height - 3);
      if (Math.abs(x - cx) + Math.abs(y - cy) > minDist) return { x, y };
    }
    return { x: 2, y: 2 };
  };

  // Dirt patches
  for (let i = 0; i < 6; i++) {
    const p = { x: randInt(w, 2, w.width - 3), y: randInt(w, 2, w.height - 3) };
    blob(w, p.x, p.y, 25, "dirt", () => 0);
  }
  // One lake, sometimes two
  const lakes = nextRandom(w) < 0.4 ? 2 : 1;
  for (let i = 0; i < lakes; i++) {
    const p = farFromCenter();
    blob(w, p.x, p.y, 120, "water", () => 0);
  }
  // Forests
  for (let i = 0; i < 6; i++) {
    const p = farFromCenter();
    blob(w, p.x, p.y, 90, "forest", () => randInt(w, 8, 15));
  }
  // Rock outcrops
  for (let i = 0; i < 4; i++) {
    const p = farFromCenter();
    blob(w, p.x, p.y, 30, "rock", () => randInt(w, 10, 20));
  }
  // Clear the village center
  for (let y = cy - 7; y <= cy + 7; y++) {
    for (let x = x0(cx); x <= cx + 7; x++) {
      if (!inBounds(w, x, y)) continue;
      if (Math.hypot(x - cx, y - cy) <= 7) w.tiles[tileIndex(w.width, x, y)] = { kind: "grass", amount: 0 };
    }
  }
  function x0(c: number) {
    return c - 7;
  }
}

function placeStartingStructures(w: WorldState) {
  const cx = Math.floor(w.width / 2);
  const cy = Math.floor(w.height / 2);
  placeStructure(w, "storehouse", cx - 1, cy - 4, { built: true, free: true });
  placeStructure(w, "campfire", cx, cy + 1, { built: true, free: true });
  placeStructure(w, "shrine", cx + 4, cy + 1, { built: true, free: true });
}

// ---- Tiles -----------------------------------------------------------------

export function inBounds(w: WorldState, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < w.width && y < w.height;
}

export function tileAt(w: WorldState, x: number, y: number): Tile {
  return w.tiles[tileIndex(w.width, x, y)];
}

export function setTile(w: WorldState, x: number, y: number, tile: Tile): void {
  const i = tileIndex(w.width, x, y);
  w.tiles[i] = tile;
  w.dirtyTiles.push(i);
}

export function structureAt(w: WorldState, x: number, y: number): Structure | undefined {
  return w.structures.find((s) => x >= s.x && x < s.x + s.w && y >= s.y && y < s.y + s.h);
}

export function isWalkable(w: WorldState, x: number, y: number): boolean {
  if (!inBounds(w, x, y)) return false;
  const kind = tileAt(w, x, y).kind;
  if (kind === "water" || kind === "rock") return false;
  return structureAt(w, x, y) === undefined;
}

export function tileCenter(t: Vec2): Vec2 {
  return { x: t.x + 0.5, y: t.y + 0.5 };
}

export function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Walkable tiles in the ring around a rectangle. */
export function ringAround(w: WorldState, x: number, y: number, width: number, height: number): Vec2[] {
  const out: Vec2[] = [];
  for (let yy = y - 1; yy <= y + height; yy++) {
    for (let xx = x - 1; xx <= x + width; xx++) {
      const onRing = yy === y - 1 || yy === y + height || xx === x - 1 || xx === x + width;
      if (onRing && isWalkable(w, xx, yy)) out.push({ x: xx, y: yy });
    }
  }
  return out;
}

export function adjacentToStructure(w: WorldState, s: Structure): Vec2[] {
  return ringAround(w, s.x, s.y, s.w, s.h);
}

export function adjacentToTile(w: WorldState, t: Vec2): Vec2[] {
  return ringAround(w, t.x, t.y, 1, 1).filter((p) => Math.abs(p.x - t.x) + Math.abs(p.y - t.y) === 1);
}

export function toTileSet(w: WorldState, tiles: Vec2[]): Set<number> {
  return new Set(tiles.map((t) => tileIndex(w.width, t.x, t.y)));
}

/** Nearest forest/rock tile with resources left that can be reached from a neighbouring tile. */
export function nearestResourceTile(w: WorldState, from: Vec2, kind: "forest" | "rock"): Vec2 | null {
  let best: Vec2 | null = null;
  let bestD = Infinity;
  for (let y = 0; y < w.height; y++) {
    for (let x = 0; x < w.width; x++) {
      const t = w.tiles[tileIndex(w.width, x, y)];
      if (t.kind !== kind || t.amount <= 0) continue;
      const d = Math.abs(x - from.x) + Math.abs(y - from.y);
      if (d >= bestD) continue;
      if (adjacentToTile(w, { x, y }).length === 0) continue;
      best = { x, y };
      bestD = d;
    }
  }
  return best;
}

export function countResourceTiles(w: WorldState, kind: "forest" | "rock"): number {
  let n = 0;
  for (const t of w.tiles) if (t.kind === kind && t.amount > 0) n++;
  return n;
}

// ---- Structures ------------------------------------------------------------

export function canAfford(w: WorldState, cost: Inventory): boolean {
  return (Object.entries(cost) as [ResourceKind, number][]).every(([k, n]) => w.storehouse[k] >= n);
}

export function canPlace(w: WorldState, kind: string, x: number, y: number): boolean {
  const def = STRUCTURES[kind];
  if (!def) return false;
  if (x < 1 || y < 1 || x + def.w > w.width - 1 || y + def.h > w.height - 1) return false;
  for (let yy = y - 1; yy <= y + def.h; yy++) {
    for (let xx = x - 1; xx <= x + def.w; xx++) {
      if (structureAt(w, xx, yy)) return false; // keep a 1-tile gap between buildings
      const inside = xx >= x && xx < x + def.w && yy >= y && yy < y + def.h;
      if (inside) {
        const k = tileAt(w, xx, yy).kind;
        if (k !== "grass" && k !== "dirt") return false;
      }
    }
  }
  return true;
}

export function placeStructure(
  w: WorldState,
  kind: string,
  x: number,
  y: number,
  opts: { built?: boolean; free?: boolean } = {},
): Structure | null {
  const def = STRUCTURES[kind];
  if (!def || !canPlace(w, kind, x, y)) return null;
  if (!opts.free) {
    if (!canAfford(w, def.cost)) return null;
    for (const [k, n] of Object.entries(def.cost) as [ResourceKind, number][]) w.storehouse[k] -= n;
  }
  const s: Structure = {
    id: `s${w.nextId++}`,
    kind,
    x,
    y,
    w: def.w,
    h: def.h,
    progress: opts.built ? 1 : 0,
    built: !!opts.built,
    ownerIds: [],
  };
  w.structures.push(s);
  if (s.built) onStructureBuilt(w, s);
  return s;
}

/** Side effects of a structure becoming built (also called when construction finishes). */
export function onStructureBuilt(w: WorldState, s: Structure): void {
  s.built = true;
  s.progress = 1;
  if (s.kind === "farm") {
    for (let yy = s.y; yy < s.y + s.h; yy++)
      for (let xx = s.x; xx < s.x + s.w; xx++) setTile(w, xx, yy, { kind: "farmland", amount: 0 });
  }
}

/** Spiral outward from `near` looking for a legal spot. */
export function findPlacement(w: WorldState, kind: string, near: Vec2, maxRadius = 18): Vec2 | null {
  const def = STRUCTURES[kind];
  if (!def) return null;
  for (let r = 1; r <= maxRadius; r++) {
    const ring: Vec2[] = [];
    for (let dx = -r; dx <= r; dx++) {
      ring.push({ x: near.x + dx, y: near.y - r }, { x: near.x + dx, y: near.y + r });
    }
    for (let dy = -r + 1; dy <= r - 1; dy++) {
      ring.push({ x: near.x - r, y: near.y + dy }, { x: near.x + r, y: near.y + dy });
    }
    // Shuffle so villages don't grow in a perfectly predictable order.
    for (let i = ring.length - 1; i > 0; i--) {
      const j = Math.floor(nextRandom(w) * (i + 1));
      [ring[i], ring[j]] = [ring[j], ring[i]];
    }
    for (const p of ring) {
      const x = p.x - Math.floor(def.w / 2);
      const y = p.y - Math.floor(def.h / 2);
      if (canPlace(w, kind, x, y)) return { x, y };
    }
  }
  return null;
}

export function structuresWithFunction(w: WorldState, fn: StructureFunction, builtOnly = true): Structure[] {
  return w.structures.filter((s) => STRUCTURES[s.kind]?.function === fn && (!builtOnly || s.built));
}

export function structureCenter(s: Structure): Vec2 {
  return { x: s.x + s.w / 2, y: s.y + s.h / 2 };
}

export function villageCenter(w: WorldState): Vec2 {
  const fire = structuresWithFunction(w, "social")[0];
  if (fire) return { x: fire.x, y: fire.y };
  return { x: Math.floor(w.width / 2), y: Math.floor(w.height / 2) };
}

/** Give homeless villagers a bed in any house with room. */
export function assignHomes(w: WorldState): void {
  const houses = structuresWithFunction(w, "shelter");
  for (const h of houses) h.ownerIds = h.ownerIds.filter((id) => w.villagers.some((v) => v.id === id && v.alive));
  for (const v of w.villagers) {
    if (!v.alive) continue;
    if (v.homeId && houses.some((h) => h.id === v.homeId)) continue;
    v.homeId = undefined;
    const house = houses.find((h) => h.ownerIds.length < (STRUCTURES[h.kind].capacity ?? 0));
    if (house) {
      house.ownerIds.push(v.id);
      v.homeId = house.id;
    }
  }
}
