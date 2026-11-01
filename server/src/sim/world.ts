// World creation, terrain generation, and spatial helpers.

import {
  MARKET_FLOAT,
  STRUCTURES,
  tileIndex,
  type Animal,
  type DiscoveryEffect,
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
import { emitEvent } from "./events.ts";
import { chance, nextRandom, pick, randInt } from "./rng.ts";

export const DEFAULT_SIZE = 64;

export function createWorld(seed: number, width = DEFAULT_SIZE, height = DEFAULT_SIZE): WorldState {
  const w: WorldState = {
    seed,
    rngState: seed | 0,
    width,
    height,
    tiles: [],
    structures: [],
    villagers: [],
    animals: [],
    camp: { x: Math.floor(width / 2), y: Math.floor(height / 2) },
    storehouse: { wood: 0, stone: 0, food: 0, seeds: 0, ore: 0 },
    shortageSince: {},
    clock: makeClock(),
    events: [],
    nextId: 1,
    paused: false,
    speed: 1,
    dirtyTiles: [],
    petitions: [],
    rumors: [],
    conversations: [],
    chronicle: [],
    discoveries: [],
  };
  generateTerrain(w);
  placeShrine(w);
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
      if (t.kind !== "water" && t.kind !== "sand") w.tiles[tileIndex(w.width, x, y)] = { kind, amount: amount() };
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

/** Sea along one edge with a wandering shoreline and a sandy beach. */
function paintCoast(w: WorldState) {
  const edges = ["north", "south", "east", "west"] as const;
  const edge = pick(w, edges);
  w.coast = edge;
  const along = edge === "north" || edge === "south" ? w.width : w.height;
  let depth = randInt(w, 3, 5);
  for (let i = 0; i < along; i++) {
    depth = Math.max(2, Math.min(7, depth + randInt(w, -1, 1)));
    const beach = depth + randInt(w, 1, 2);
    for (let d = 0; d < beach; d++) {
      const kind: TileKind = d < depth ? "water" : "sand";
      let x: number;
      let y: number;
      if (edge === "north") [x, y] = [i, d];
      else if (edge === "south") [x, y] = [i, w.height - 1 - d];
      else if (edge === "west") [x, y] = [d, i];
      else [x, y] = [w.width - 1 - d, i];
      if (inBounds(w, x, y)) w.tiles[tileIndex(w.width, x, y)] = { kind, amount: 0 };
    }
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

  if (w.width >= 24 && w.height >= 24) paintCoast(w);

  // Feature counts were tuned on a 48×48 map; scale them with the area.
  const scale = (w.width * w.height) / (48 * 48);
  const n = (base: number) => Math.max(1, Math.round(base * scale));
  for (let i = 0; i < n(6); i++) {
    const p = { x: randInt(w, 2, w.width - 3), y: randInt(w, 2, w.height - 3) };
    blob(w, p.x, p.y, 25, "dirt", () => 0);
  }
  const lakes = nextRandom(w) < 0.4 ? 2 : 1;
  for (let i = 0; i < lakes; i++) {
    const p = farFromCenter();
    blob(w, p.x, p.y, 100, "water", () => 0);
  }
  for (let i = 0; i < n(6); i++) {
    const p = farFromCenter();
    blob(w, p.x, p.y, 90, "forest", () => randInt(w, 8, 15));
  }
  for (let i = 0; i < n(4); i++) {
    const p = farFromCenter();
    blob(w, p.x, p.y, 30, "rock", () => randInt(w, 10, 20));
  }
  // Ore veins hide inside some rock.
  for (let i = 0; i < w.tiles.length; i++) {
    if (w.tiles[i].kind === "rock" && chance(w, 0.2)) w.tiles[i] = { kind: "ore", amount: randInt(w, 6, 12) };
  }
  // The settlers arrive with nothing, so the land right around the camp is
  // generous: a wood and a rocky outcrop within a short walk, then a clearing.
  if (w.width >= 24 && w.height >= 24) {
    const angle = nextRandom(w) * Math.PI * 2;
    const at = (a: number, d: number): Vec2 => ({ x: Math.round(cx + Math.cos(a) * d), y: Math.round(cy + Math.sin(a) * d) });
    const wood = at(angle, 8);
    blob(w, wood.x, wood.y, 70, "forest", () => randInt(w, 8, 14));
    const wood2 = at(angle + 2.4, 9);
    blob(w, wood2.x, wood2.y, 40, "forest", () => randInt(w, 6, 12));
    const rock = at(angle + Math.PI * 0.9, 9);
    blob(w, rock.x, rock.y, 22, "rock", () => randInt(w, 10, 18));
  }
  // Clear the camp itself.
  for (let y = cy - 5; y <= cy + 5; y++) {
    for (let x = cx - 5; x <= cx + 5; x++) {
      if (!inBounds(w, x, y)) continue;
      if (Math.hypot(x - cx, y - cy) <= 4.5) w.tiles[tileIndex(w.width, x, y)] = { kind: "grass", amount: 0 };
    }
  }
}

/**
 * An old shrine already stands somewhere on the land, a fair walk from the camp.
 * Nobody knows it is there until someone wanders close; see discoverLandmarks.
 */
function placeShrine(w: WorldState) {
  const c = w.camp;
  const far = Math.min(22, Math.floor(Math.min(w.width, w.height) / 3));
  const near = Math.max(6, Math.floor(far * 0.65));
  for (let attempt = 0; attempt < 300; attempt++) {
    const x = randInt(w, 2, w.width - 3);
    const y = randInt(w, 2, w.height - 3);
    const d = Math.hypot(x - c.x, y - c.y);
    if (d < near || d > far) continue;
    if (placeStructure(w, "shrine", x, y, { built: true, free: true, hidden: true })) return;
  }
  // Cramped test maps: anywhere legal will do.
  const spot = findPlacement(w, "shrine", c, Math.max(w.width, w.height));
  if (spot) placeStructure(w, "shrine", spot.x, spot.y, { built: true, free: true, hidden: true });
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
  if (kind === "water" || kind === "rock" || kind === "ore") return false;
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

/** Does the footprint touch at least one tile of these kinds (4-neighbourhood ring)? */
function footprintTouches(w: WorldState, x: number, y: number, width: number, height: number, kinds: TileKind[]): boolean {
  for (let yy = y - 1; yy <= y + height; yy++) {
    for (let xx = x - 1; xx <= x + width; xx++) {
      const onRing = yy === y - 1 || yy === y + height || xx === x - 1 || xx === x + width;
      const corner = (yy === y - 1 || yy === y + height) && (xx === x - 1 || xx === x + width);
      if (!onRing || corner || !inBounds(w, xx, yy)) continue;
      if (kinds.includes(tileAt(w, xx, yy).kind)) return true;
    }
  }
  return false;
}

/** A forest tile this thin is a sapling: nobody cuts it, it is left to grow. */
export const SAPLING_MAX = 2;

/** Nearest forest/rock tile with resources left that can be reached from a neighbouring tile. */
export function nearestResourceTile(w: WorldState, from: Vec2, kind: "forest" | "rock"): Vec2 | null {
  let best: Vec2 | null = null;
  let bestD = Infinity;
  for (let y = 0; y < w.height; y++) {
    for (let x = 0; x < w.width; x++) {
      const t = w.tiles[tileIndex(w.width, x, y)];
      if (t.kind !== kind || t.amount <= 0) continue;
      if (kind === "forest" && t.amount <= SAPLING_MAX) continue;
      const d = Math.abs(x - from.x) + Math.abs(y - from.y);
      if (d >= bestD) continue;
      if (adjacentToTile(w, { x, y }).length === 0) continue;
      best = { x, y };
      bestD = d;
    }
  }
  return best;
}

export function countResourceTiles(w: WorldState, kind: "forest" | "rock" | "ore"): number {
  let n = 0;
  for (const t of w.tiles) if (t.kind === kind && t.amount > 0) n++;
  return n;
}

export function hasCoast(w: WorldState): boolean {
  return w.coast !== undefined;
}

/** Walkable tiles next to water: where one can fish from the beach. */
export function shoreTiles(w: WorldState, near?: Vec2, limit = 24): Vec2[] {
  const out: { t: Vec2; d: number }[] = [];
  for (let y = 0; y < w.height; y++) {
    for (let x = 0; x < w.width; x++) {
      if (!isWalkable(w, x, y)) continue;
      if (!footprintTouches(w, x, y, 1, 1, ["water"])) continue;
      out.push({ t: { x, y }, d: near ? Math.abs(x - near.x) + Math.abs(y - near.y) : 0 });
    }
  }
  out.sort((a, b) => a.d - b.d);
  return out.slice(0, limit).map((o) => o.t);
}

export function nearestWildAnimal(w: WorldState, from: Vec2, kind?: Animal["kind"]): Animal | undefined {
  let best: Animal | undefined;
  let bestD = Infinity;
  for (const a of w.animals) {
    if (!a.alive || a.tame || a.leaderId) continue;
    if (kind && a.kind !== kind) continue;
    if (!inBounds(w, Math.floor(a.pos.x), Math.floor(a.pos.y))) continue; // beyond the edge, out of reach
    const d = distance(a.pos, from);
    if (d < bestD) {
      best = a;
      bestD = d;
    }
  }
  return best;
}

// ---- Structures ------------------------------------------------------------

/** Everything the village owns between them: every villager's stock plus the common store. */
export function villageStock(w: WorldState): Record<ResourceKind, number> {
  const out = { ...w.storehouse };
  for (const v of w.villagers) {
    if (!v.alive) continue;
    for (const k of Object.keys(out) as ResourceKind[]) out[k] += (v.stock[k] ?? 0) + (v.inventory[k] ?? 0);
  }
  return out;
}

/** Could the village, pooling what everyone owns, pay for this? Materials still have to be brought to the blueprint. */
export function canAfford(w: WorldState, cost: Inventory): boolean {
  const have = villageStock(w);
  return (Object.entries(cost) as [ResourceKind, number][]).every(([k, n]) => (have[k] ?? 0) >= n);
}

export function canPlace(w: WorldState, kind: string, x: number, y: number): boolean {
  const def = STRUCTURES[kind];
  if (!def) return false;
  const m = def.margin ?? 1;
  if (x < 1 || y < 1 || x + def.w > w.width - 1 || y + def.h > w.height - 1) return false;
  for (let yy = y - m; yy <= y + def.h + m - 1; yy++) {
    for (let xx = x - m; xx <= x + def.w + m - 1; xx++) {
      if (structureAt(w, xx, yy)) return false; // keep a gap between buildings (wider for cottages)
      const inside = xx >= x && xx < x + def.w && yy >= y && yy < y + def.h;
      if (inside) {
        const k = tileAt(w, xx, yy).kind;
        if (k !== "grass" && k !== "dirt" && !(k === "sand" && def.function === "fishing")) return false;
      }
    }
  }
  if (def.mustTouch === "water" && !footprintTouches(w, x, y, def.w, def.h, ["water"])) return false;
  if (def.mustTouch === "rock" && !footprintTouches(w, x, y, def.w, def.h, ["rock", "ore"])) return false;
  return true;
}

export function placeStructure(
  w: WorldState,
  kind: string,
  x: number,
  y: number,
  opts: { built?: boolean; free?: boolean; hidden?: boolean } = {},
): Structure | null {
  const def = STRUCTURES[kind];
  if (!def || !canPlace(w, kind, x, y)) return null;
  // A blueprint costs nothing to lay out; the materials are brought to it by whoever helps build.
  if (!opts.free && !canAfford(w, def.cost)) return null;
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
    ...(opts.built ? {} : { delivered: {} }),
    ...(opts.hidden ? { hidden: true } : {}),
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
  if (s.kind === "mine") strikeVein(w, s);
  if (s.kind === "market") {
    s.goods ??= {};
    s.till ??= MARKET_FLOAT;
  }
}

/** A new mine finds whatever the surrounding rock holds. */
function strikeVein(w: WorldState, s: Structure): void {
  let rock = 0;
  let ore = 0;
  for (let yy = s.y - 2; yy <= s.y + s.h + 1; yy++) {
    for (let xx = s.x - 2; xx <= s.x + s.w + 1; xx++) {
      if (!inBounds(w, xx, yy)) continue;
      const k = tileAt(w, xx, yy).kind;
      if (k === "rock") rock++;
      if (k === "ore") ore++;
    }
  }
  const rich = chance(w, 0.25);
  s.reserve = {
    stone: 30 + rock * 6 + randInt(w, 0, 20),
    ore: ore * 6 + randInt(w, 0, 6) + (rich ? 20 : 0),
  };
  s.depleted = false;
  const text =
    s.reserve.ore >= 20
      ? "The new mine strikes a rich vein of ore!"
      : s.reserve.ore > 0
        ? "The new mine finds good stone and a thread of ore."
        : "The new mine finds plenty of stone but no ore.";
  emitEvent(w, "vein", text, { pos: { x: s.x, y: s.y } });
}

/** 1.25 once a workshop stands: everyone works faster. */
export function workBonus(w: WorldState): number {
  return structuresWithFunction(w, "crafting").length > 0 ? 1.25 : 1;
}

/** Speed-up from something a traveller brought home (see DISCOVERIES). */
export function discoveryBonus(w: WorldState, effect: DiscoveryEffect): number {
  return (w.discoveries ?? []).some((d) => d.effect === effect) ? 1.35 : 1;
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

/** Structures serving a purpose. With builtOnly (the default) a hidden, undiscovered one does not count. */
export function structuresWithFunction(w: WorldState, fn: StructureFunction, builtOnly = true): Structure[] {
  return w.structures.filter((s) => STRUCTURES[s.kind]?.function === fn && (!builtOnly || (s.built && !s.hidden)));
}

export function structureCenter(s: Structure): Vec2 {
  return { x: s.x + s.w / 2, y: s.y + s.h / 2 };
}

export function villageCenter(w: WorldState): Vec2 {
  const fire = structuresWithFunction(w, "social")[0];
  if (fire) return { x: fire.x, y: fire.y };
  return w.camp ?? { x: Math.floor(w.width / 2), y: Math.floor(w.height / 2) };
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
