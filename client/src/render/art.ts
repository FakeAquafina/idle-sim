// Code-drawn stand-in art for the top-down view, drawn with rectangles so the
// viewer works with no image files. A pixel-art pack (see atlas.ts, once it
// exists) replaces these piece by piece; whatever the pack lacks stays here.
//
// Conventions: ground tiles draw at their top-left corner; buildings draw
// relative to the top-left of their footprint and may rise above it (roofs);
// villagers, animals and trees draw relative to the point where they touch the
// ground. Screen y grows downward, so things that stand up have negative y.

import { Graphics, type Renderer, Sprite, type Texture } from "pixi.js";
import type { Season, Structure, StructureDef, Tile } from "@idle-sim/shared";
import { TILE } from "./projection.ts";

const OUTLINE = 0x1a1a24;

// ---- Seasons --------------------------------------------------------------------

export interface Palette {
  grass: [number, number];
  forestFloor: [number, number];
  dirt: [number, number];
  sand: [number, number];
  water: [number, number];
  /** Broadleaf canopy: main, light, shade. null = bare branches (winter). */
  leaf: [number, number, number] | null;
  conifer: [number, number];
  /** Small flowers on grass; empty = none this season. */
  flowers: number[];
  snow: boolean;
}

export const PALETTES: Record<Season, Palette> = {
  spring: {
    grass: [0x6fb24c, 0x67aa46],
    forestFloor: [0x56953d, 0x508e39],
    dirt: [0x9c7549, 0x936e44],
    sand: [0xdccb8c, 0xd4c385],
    water: [0x3f78b8, 0x3b70ae],
    leaf: [0x4f9a3a, 0x7fc15a, 0x2f6b28],
    conifer: [0x2f7a40, 0x58a85f],
    flowers: [0xf2f2f2, 0xf4a7c0, 0xf6d76b],
    snow: false,
  },
  summer: {
    grass: [0x5f9f42, 0x58973c],
    forestFloor: [0x4a8336, 0x447c32],
    dirt: [0x9c7549, 0x936e44],
    sand: [0xdccb8c, 0xd4c385],
    water: [0x3f78b8, 0x3b70ae],
    leaf: [0x2f7a2c, 0x4c9a3d, 0x1f5a1f],
    conifer: [0x2a6b36, 0x4c9a3d],
    flowers: [0xf6d76b, 0xe8743b],
    snow: false,
  },
  autumn: {
    grass: [0xa3a649, 0x999c43],
    forestFloor: [0x8a7a36, 0x817232],
    dirt: [0x946c45, 0x8b6540],
    sand: [0xd4c28a, 0xccba83],
    water: [0x3d6ea6, 0x39679d],
    leaf: [0xd2772a, 0xe8a23c, 0x9c4a1a],
    conifer: [0x2a6b36, 0x4c9a3d],
    flowers: [],
    snow: false,
  },
  winter: {
    grass: [0xe3e9ee, 0xdae2e9],
    forestFloor: [0xd0d8e0, 0xc8d1da],
    dirt: [0xbdb5aa, 0xb5ada2],
    sand: [0xe3dfcb, 0xdbd7c3],
    water: [0x4a6f98, 0x466a92],
    leaf: null,
    conifer: [0x27553a, 0xffffff],
    flowers: [],
    snow: true,
  },
};

/** Cheap deterministic hash so the same tile always gets the same variant. */
export function hash(x: number, y: number, salt = 0): number {
  let h = (x * 374761393 + y * 668265263 + salt * 2246822519) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Blend toward black (f<1) or white (f>1) by a small amount. */
function shade(c: number, f: number): number {
  return f < 1 ? lerpColor(0x000000, c, f) : lerpColor(c, 0xffffff, f - 1);
}

// ---- Ground ---------------------------------------------------------------------

export interface Shore {
  /** Land on the -y, +x, +y, -x sides of a water tile. */
  n: boolean;
  e: boolean;
  s: boolean;
  w: boolean;
}

/**
 * One 16×16 ground tile with its top-left at (px, py). Natural ground gets an
 * irregular shade from a hash and a few speckles so it reads as turf, not a grid.
 */
export function drawGroundTile(g: Graphics, px: number, py: number, tile: Tile, x: number, y: number, pal: Palette, shore?: Shore): void {
  const h = hash(x, y);
  const pair =
    tile.kind === "grass" ? pal.grass
    : tile.kind === "forest" ? pal.forestFloor
    : tile.kind === "dirt" ? pal.dirt
    : tile.kind === "sand" ? pal.sand
    : tile.kind === "water" ? pal.water
    : tile.kind === "rock" ? (pal.snow ? [0xc9ced4, 0xc1c7cd] : [0x8a8e93, 0x82868b])
    : tile.kind === "ore" ? (pal.snow ? [0xbdb6c8, 0xb5aec0] : [0x7a6f88, 0x726780])
    : pal.snow ? [0xcdc6bc, 0xc5beb4] : [0x7a5533, 0x72502f]; // farmland
  const blob = hash(Math.floor((x + 1) / 3), Math.floor((y + 1) / 3), 11) % 5;
  const fine = (h >> 2) % 3;
  const base = shade(pair[0], 0.96 + blob * 0.015 + fine * 0.012);
  g.rect(px, py, TILE, TILE).fill(base);
  const sx = px + 2 + ((h >> 5) % 11);
  const sy = py + 2 + ((h >> 9) % 11);
  switch (tile.kind) {
    case "grass":
    case "forest":
      if (pal.snow) {
        if ((h >> 3) % 4 === 0) g.rect(sx, sy, 2, 1).fill({ color: 0xffffff, alpha: 0.7 });
      } else {
        // Blades of grass: a couple of darker ticks per tile.
        if ((h >> 3) % 2 === 0) g.rect(sx, sy, 1, 2).fill({ color: 0x000000, alpha: 0.16 });
        if ((h >> 7) % 3 === 0) g.rect(px + 2 + ((h >> 13) % 11), py + 2 + ((h >> 17) % 11), 1, 2).fill({ color: 0x000000, alpha: 0.12 });
        if ((h >> 15) % 5 === 0) g.rect(sx - 3, sy + 3, 2, 1).fill({ color: 0xffffff, alpha: 0.12 });
        if (pal.flowers.length && tile.kind === "grass" && (h >> 11) % 8 === 0) {
          const c = pal.flowers[(h >> 11) % pal.flowers.length];
          g.rect(sx, sy, 1, 1).fill(c).rect(sx + 3, sy + 2, 1, 1).fill(pal.flowers[(h >> 13) % pal.flowers.length]);
        }
      }
      break;
    case "dirt":
      g.rect(sx, sy, 2, 1).fill({ color: 0x000000, alpha: 0.14 });
      if ((h >> 12) % 3 === 0) g.rect(sx + 4, sy + 4, 1, 1).fill({ color: 0xffffff, alpha: 0.12 });
      break;
    case "sand":
      if ((h >> 3) % 2 === 0) g.rect(sx, sy, 1, 1).fill({ color: 0x000000, alpha: 0.1 });
      break;
    case "rock":
    case "ore":
      g.rect(sx, sy, 3, 1).fill({ color: 0x000000, alpha: 0.18 }).rect(sx + 1, sy - 2, 1, 1).fill({ color: 0xffffff, alpha: 0.18 });
      break;
    case "water": {
      if ((h >> 3) % 3 === 0) g.rect(px + 2 + ((h >> 5) % 8), py + 3 + ((h >> 9) % 9), 5, 1).fill({ color: 0x8fb6e0, alpha: 0.45 });
      if (shore) {
        // Pale foam along each edge that touches land.
        const foam = { color: 0xcfe3f5, alpha: 0.85 };
        if (shore.n) g.rect(px, py, TILE, 1).fill(foam);
        if (shore.s) g.rect(px, py + TILE - 1, TILE, 1).fill(foam);
        if (shore.w) g.rect(px, py, 1, TILE).fill(foam);
        if (shore.e) g.rect(px + TILE - 1, py, 1, TILE).fill(foam);
      }
      break;
    }
    case "farmland":
      for (let i = 2; i < TILE; i += 4) g.rect(px, py + i, TILE, 1).fill({ color: 0x3f2d16, alpha: 0.3 });
      break;
    default:
      break;
  }
}

/** The land beyond the map edge: darker turf and a scatter of tree tops, so the world doesn't float in black. */
export function drawSurroundings(g: Graphics, width: number, height: number, pal: Palette, coast?: "north" | "south" | "east" | "west"): void {
  const R = 14;
  const land = shade(pal.grass[1], 0.74);
  g.rect(-R * TILE, -R * TILE, (width + 2 * R) * TILE, (height + 2 * R) * TILE).fill(land);
  if (coast) {
    const sea = shade(pal.water[1], 0.85);
    if (coast === "north") g.rect(-R * TILE, -R * TILE, (width + 2 * R) * TILE, R * TILE).fill(sea);
    if (coast === "south") g.rect(-R * TILE, height * TILE, (width + 2 * R) * TILE, R * TILE).fill(sea);
    if (coast === "west") g.rect(-R * TILE, -R * TILE, R * TILE, (height + 2 * R) * TILE).fill(sea);
    if (coast === "east") g.rect(width * TILE, -R * TILE, R * TILE, (height + 2 * R) * TILE).fill(sea);
  }
  const dark = shade(pal.conifer[0], 0.65);
  for (let y = -R + 1; y < height + R - 1; y++) {
    for (let x = -R + 1; x < width + R - 1; x++) {
      const inside = x >= 0 && y >= 0 && x < width && y < height;
      if (inside) continue;
      if ((coast === "north" && y < 0) || (coast === "south" && y >= height) || (coast === "west" && x < 0) || (coast === "east" && x >= width)) continue;
      const h = hash(x, y, 5);
      if (h % 3 !== 0) continue;
      const cx = x * TILE + 8 + ((h >> 4) % 5) - 2;
      const cy = y * TILE + 8 + ((h >> 8) % 5) - 2;
      g.circle(cx, cy, 6).fill(dark);
      g.circle(cx - 2, cy - 2, 3).fill(shade(dark, 1.12));
    }
  }
}

// ---- Shadows and blocks ------------------------------------------------------------

/** A flat pixel ellipse on the ground under something that stands. */
function shadow(g: Graphics, cx: number, cy: number, w: number): void {
  const rows = [0.55, 0.9, 1, 0.9, 0.55];
  for (let i = 0; i < rows.length; i++) {
    const rw = Math.max(2, Math.round(w * rows[i]));
    g.rect(cx - rw / 2, cy - 2 + i, rw, 1).fill({ color: 0x000000, alpha: 0.2 });
  }
}

interface Px {
  x: number;
  y: number;
  w: number;
  h: number;
  c: number;
}

/** Draw a set of blocks with a one-pixel dark outline behind them. */
function blocks(g: Graphics, px: Px[], outline = OUTLINE): void {
  for (const p of px) g.rect(p.x - 1, p.y - 1, p.w + 2, p.h + 2).fill({ color: outline, alpha: 0.85 });
  for (const p of px) g.rect(p.x, p.y, p.w, p.h).fill(p.c);
}

// ---- Trees, rocks, bushes ----------------------------------------------------------------

/** A tree seen from above and a little in front: round canopy, trunk foot at the ground point. */
export function drawTree(g: Graphics, variant: number, big: boolean, pal: Palette): void {
  const s = big ? 1 : 0.65;
  shadow(g, 0, 0, 14 * s);
  const trunk = 0x5a3a1e;
  g.rect(-1.5 * s, -8 * s, 3 * s, 8 * s).fill(trunk).stroke({ color: OUTLINE, width: 1, alpha: 0.6 });
  if (variant % 2 === 0) {
    if (pal.leaf) {
      const [main, light, dark] = pal.leaf;
      g.circle(0, -16 * s, 10 * s).fill(dark).stroke({ color: OUTLINE, width: 1, alpha: 0.6 });
      g.circle(-1 * s, -17 * s, 8 * s).fill(main);
      g.circle(-4 * s, -20 * s, 4 * s).fill(light);
      g.rect(2 * s, -14 * s, 3 * s, 2 * s).fill(dark);
    } else {
      // Bare winter branches with snow.
      g.rect(-1, -16 * s, 2, 10 * s).fill(trunk);
      g.rect(-7 * s, -14 * s, 6 * s, 1).fill(trunk).rect(1, -18 * s, 6 * s, 1).fill(trunk).rect(-4 * s, -20 * s, 4 * s, 1).fill(trunk);
      g.rect(-7 * s, -15 * s, 5 * s, 1).fill(0xffffff).rect(2, -19 * s, 5 * s, 1).fill(0xffffff);
    }
  } else {
    const [main, light] = pal.conifer;
    // Three stacked triangles, narrowing upward.
    const tiers: [number, number][] = [
      [11, -6],
      [9, -14],
      [6, -21],
    ];
    for (const [w, top] of tiers) {
      g.poly([0, top * s - 7 * s, w * s, top * s, -w * s, top * s]).fill(main).stroke({ color: OUTLINE, width: 1, alpha: 0.6 });
      if (pal.snow) g.poly([0, top * s - 7 * s, (w - 3) * s, top * s - 3 * s, -(w - 3) * s, top * s - 3 * s]).fill(light);
    }
    if (!pal.snow) g.rect(-2 * s, -24 * s, 2 * s, 3 * s).fill(light);
  }
}

export function drawRock(g: Graphics, ore: boolean, big: boolean, pal: Palette): void {
  const s = big ? 1 : 0.7;
  shadow(g, 0, 1, 12 * s);
  const base = ore ? 0x7d6f93 : 0x8a8e93;
  const light = pal.snow ? 0xf4f7fa : ore ? 0x9a8cb0 : 0xa7abb0;
  const dark = ore ? 0x564a6a : 0x5c6064;
  blocks(g, [
    { x: -6 * s, y: -6 * s, w: 12 * s, h: 6 * s, c: base },
    { x: -4 * s, y: -9 * s, w: 7 * s, h: 3 * s, c: base },
    { x: -3 * s, y: -9 * s, w: 3 * s, h: 2 * s, c: light },
    { x: 1 * s, y: -3 * s, w: 5 * s, h: 2 * s, c: dark },
  ]);
  if (ore) g.rect(-3, -5, 2, 1).fill(0xe6c86a).rect(1, -7, 1, 1).fill(0xe6c86a).rect(3, -3, 1, 1).fill(0xe6c86a);
}

export function drawBush(g: Graphics, pal: Palette): void {
  shadow(g, 0, 0, 8);
  const c = pal.leaf ? pal.leaf[0] : 0x6b5a48;
  const light = pal.leaf ? pal.leaf[1] : pal.snow ? 0xffffff : 0x8a7a66;
  g.circle(0, -4, 5).fill(c).stroke({ color: OUTLINE, width: 1, alpha: 0.6 });
  g.circle(-2, -6, 2).fill(light);
}

export function drawReeds(g: Graphics, pal: Palette): void {
  const c = pal.snow ? 0xb9ad8a : 0x6b8a3b;
  const head = pal.snow ? 0x8a7a5a : 0x7a5a2e;
  for (const [x, h] of [
    [-3, 8],
    [0, 11],
    [3, 7],
  ] as const) {
    g.rect(x, -h, 1, h).fill(c);
    g.rect(x, -h - 2, 1, 2).fill(head);
  }
}

// ---- Villagers and animals --------------------------------------------------------------

const HAIR = [0x2b1d12, 0x5a3a1e, 0x9a6a3a, 0xd9a066, 0x1a1a1a, 0xb04a2a, 0x3b2a4a];
const SKIN = [0xf1c9a5, 0xe0b48c, 0xc98f63, 0x8d5a3b, 0x6b4328];

export type Facing = "down" | "up" | "side";

export interface VillagerLookOpts {
  stage: "child" | "adult" | "elder";
  shirt: number;
  hairIndex: number;
  skinIndex: number;
  resting: boolean;
  /** Something slung on the back: a sack of whatever they gathered. */
  carrying: boolean;
  facing: Facing;
}

export function lookFor(id: string, stage: "child" | "adult" | "elder", resting: boolean, carrying: boolean, facing: Facing): VillagerLookOpts {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) | 0;
  const hue = Math.abs(h) % 360;
  return { stage, shirt: hslToHex(hue, 0.55, 0.5), hairIndex: Math.abs(h >> 4) % HAIR.length, skinIndex: Math.abs(h >> 8) % SKIN.length, resting, carrying, facing };
}

/** Height in pixels of a villager sprite, for hit testing and bubbles. */
export function villagerHeight(stage: "child" | "adult" | "elder"): number {
  return stage === "child" ? 14 : 20;
}

/**
 * A villager at the ground point (feet). Faces down (toward the viewer) by
 * default; `up` shows the back, `side` faces screen-right and the scene flips
 * it to face left. `step` 0 is standing, 1 and 2 are the two walking poses.
 */
export function drawVillager(g: Graphics, o: VillagerLookOpts, step: 0 | 1 | 2 = 0): void {
  const skin = SKIN[o.skinIndex];
  const hair = o.stage === "elder" ? 0xd8d8d8 : HAIR[o.hairIndex];
  const trousers = 0x3b3350;
  const child = o.stage === "child";
  const k = child ? 0.7 : 1; // children are shorter
  const legA = step === 1 ? 1 : 0;
  const legB = step === 2 ? 1 : 0;
  const px: Px[] = [];
  shadow(g, 0, 0, child ? 7 : 9);
  const legH = Math.round(4 * k);
  const torsoH = Math.round(7 * k);
  const headH = Math.round(7 * k);
  const torsoY = -legH - torsoH;
  const headY = torsoY - headH + 1;
  // Legs: the walking leg lifts a pixel.
  px.push({ x: -3, y: -legH - legA, w: 2, h: legH, c: trousers }, { x: 1, y: -legH - legB, w: 2, h: legH, c: trousers });
  // Sack on the back shows when seen from behind or the side.
  if (o.carrying && o.facing !== "down") px.push({ x: o.facing === "up" ? -3 : -6, y: torsoY - 1, w: o.facing === "up" ? 6 : 4, h: 5, c: 0x8a6a3a });
  px.push({ x: -4, y: torsoY, w: 8, h: torsoH, c: o.shirt });
  // Arms.
  px.push({ x: -5, y: torsoY + 1 + legB, w: 1, h: torsoH - 2, c: skin }, { x: 4, y: torsoY + 1 + legA, w: 1, h: torsoH - 2, c: skin });
  px.push({ x: -4, y: headY, w: 8, h: headH, c: skin });
  // Hair: a cap from the front, a full back of the head from behind.
  px.push({ x: -4, y: headY - 1, w: 8, h: o.facing === "up" ? headH - 1 : 3, c: hair });
  if (o.facing === "side") px.push({ x: -4, y: headY - 1, w: 3, h: headH - 2, c: hair });
  if (o.carrying && o.facing === "down") px.push({ x: -2, y: torsoY + 2, w: 5, h: 4, c: 0x8a6a3a });
  if (o.stage === "elder") px.push({ x: 6, y: -11 * k, w: 1, h: 11 * k, c: 0x7a5a2e });
  blocks(g, px);
  // Eyes.
  if (o.facing === "down") g.rect(-2, headY + 3, 1, 1).fill(OUTLINE).rect(1, headY + 3, 1, 1).fill(OUTLINE);
  else if (o.facing === "side") g.rect(2, headY + 3, 1, 1).fill(OUTLINE);
  if (o.resting) {
    const top = headY - 6;
    g.rect(5, top, 3, 1).fill({ color: 0xffffff, alpha: 0.8 }).rect(6, top + 1, 1, 1).fill({ color: 0xffffff, alpha: 0.8 }).rect(5, top + 2, 3, 1).fill({ color: 0xffffff, alpha: 0.8 });
  }
}

/** Faces screen-right; `step` alternates the legs while moving. */
export function drawAnimal(g: Graphics, kind: "deer" | "goat", tame: boolean, step: 0 | 1 | 2 = 0): void {
  const d = step === 1 ? 1 : step === 2 ? -1 : 0;
  shadow(g, 0, 0, kind === "deer" ? 12 : 9);
  if (kind === "deer") {
    const body = 0x9a6a3a;
    blocks(g, [
      { x: -5 + d, y: -4, w: 1, h: 4, c: 0x6b4a2a },
      { x: 3 - d, y: -4, w: 1, h: 4, c: 0x6b4a2a },
      { x: -6, y: -9, w: 11, h: 5, c: body },
      { x: 4, y: -13, w: 4, h: 5, c: body },
      { x: -7, y: -10, w: 2, h: 2, c: 0xf0e6d6 },
    ]);
    g.rect(5, -15, 1, 2).fill(0x5a3a1e).rect(7, -15, 1, 2).fill(0x5a3a1e).rect(5, -16, 3, 1).fill(0x5a3a1e);
    g.rect(7, -11, 1, 1).fill(OUTLINE);
  } else {
    const body = tame ? 0xe8e4dc : 0xc9c2b4;
    blocks(g, [
      { x: -4 + d, y: -3, w: 1, h: 3, c: 0x4a4038 },
      { x: 2 - d, y: -3, w: 1, h: 3, c: 0x4a4038 },
      { x: -5, y: -7, w: 9, h: 4, c: body },
      { x: 3, y: -10, w: 3, h: 4, c: body },
    ]);
    g.rect(4, -11, 1, 1).fill(0x6b5a48).rect(5, -11, 1, 1).fill(0x6b5a48);
    g.rect(5, -8, 1, 1).fill(OUTLINE);
    g.rect(4, -6, 1, 2).fill(0xd0c8b8);
    if (tame) g.rect(2, -8, 1, 1).fill(0xc0504d);
  }
}

// ---- Buildings ------------------------------------------------------------------------

/** How far each kind rises above the top of its footprint, in pixels. Used for labels, hit tests and sorting. */
export function structureRise(kind: string, built: boolean): number {
  if (!built) return 0;
  return { house: 26, storehouse: 22, workshop: 24, mine: 14, shrine: 14, well: 12, campfire: 4, dock: 0, pen: 6, farm: 0, market: 16 }[kind] ?? 12;
}

interface Pt {
  x: number;
  y: number;
}

/** Where a house's chimney top is, relative to the footprint's top-left (for smoke). */
export function chimneyPoint(s: Structure): Pt | null {
  if (s.kind !== "house" && s.kind !== "workshop") return null;
  const rise = structureRise(s.kind, true);
  return { x: s.w * TILE - 10, y: -rise + 2 };
}

/** Centre of the footprint relative to its top-left. */
export function footprintCenter(w: number, h: number): Pt {
  return { x: (w * TILE) / 2, y: (h * TILE) / 2 };
}

/**
 * A building with a roof: the front wall takes the bottom of the footprint,
 * the roof covers the rest and rises above it, overlapping what stands behind.
 */
function roofedBox(g: Graphics, w: number, h: number, rise: number, wallH: number, wall: number, roofA: number, roofB: number, snow: boolean): void {
  const W = w * TILE;
  const H = h * TILE;
  // Wall.
  g.rect(0, H - wallH, W, wallH).fill(wall).stroke({ color: OUTLINE, width: 1, alpha: 0.7 });
  g.rect(0, H - wallH, W, 1).fill({ color: 0x000000, alpha: 0.25 }); // eave shadow
  // Roof: two slopes, ridge across the middle.
  const roofTop = -rise;
  const roofBottom = H - wallH;
  const ridge = Math.round((roofTop + roofBottom) / 2);
  g.rect(0, roofTop, W, ridge - roofTop).fill(snow ? 0xeef2f6 : roofA).stroke({ color: OUTLINE, width: 1, alpha: 0.7 });
  g.rect(0, ridge, W, roofBottom - ridge).fill(snow ? 0xdde4ea : roofB).stroke({ color: OUTLINE, width: 1, alpha: 0.7 });
  g.rect(0, ridge, W, 1).fill({ color: 0x000000, alpha: 0.25 });
  if (!snow) {
    for (let yy = roofTop + 3; yy < roofBottom - 1; yy += 4) g.rect(1, yy, W - 2, 1).fill({ color: 0x000000, alpha: 0.12 });
  }
}

function plainBox(g: Graphics, w: number, h: number, rise: number, wallH: number, wall: number, top: number, snow: boolean): void {
  const W = w * TILE;
  const H = h * TILE;
  g.rect(0, H - wallH, W, wallH).fill(wall).stroke({ color: OUTLINE, width: 1, alpha: 0.7 });
  g.rect(0, -rise, W, H - wallH + rise).fill(snow ? 0xe4eaf0 : top).stroke({ color: OUTLINE, width: 1, alpha: 0.7 });
  g.rect(0, H - wallH, W, 1).fill({ color: 0x000000, alpha: 0.25 });
}

/** Draws the static part of a structure. Flames and smoke are drawn separately. */
export function drawStructure(g: Graphics, s: Structure, def: StructureDef, pal: Palette): void {
  const W = s.w * TILE;
  const H = s.h * TILE;
  const snow = pal.snow;
  if (!s.built) {
    // Blueprint: pegs and string, with a pile of delivered materials growing in the middle.
    g.rect(0, 0, W, H).fill({ color: def.color, alpha: 0.18 }).stroke({ color: def.color, width: 1, alpha: 0.9 });
    for (const [x, y] of [
      [0, 0],
      [W - 2, 0],
      [0, H - 2],
      [W - 2, H - 2],
    ]) g.rect(x, y, 2, 2).fill(0x8a6a3a);
    const total = Object.values(def.cost).reduce((a, b) => a + (b ?? 0), 0) || 1;
    const got = Object.values(s.delivered ?? {}).reduce((a, b) => a + (b ?? 0), 0);
    const pile = Math.round(Math.min(1, got / total) * 4);
    const m = footprintCenter(s.w, s.h);
    for (let i = 0; i < pile; i++) g.rect(m.x - 5 + i, m.y - 1 - i, 10 - i * 2, 1).fill(0x8a6a3a);
    g.rect(1, -5, W - 2, 3).fill({ color: 0x000000, alpha: 0.5 });
    g.rect(1, -5, Math.round((W - 2) * s.progress), 3).fill(0xe0a458);
    return;
  }
  switch (s.kind) {
    case "house": {
      roofedBox(g, s.w, s.h, structureRise("house", true), 14, 0xdcc39a, 0x9a4232, 0x7c3326, snow);
      // Door in the middle of the wall, a window either side.
      const dx = Math.round(W / 2) - 3;
      g.rect(dx, H - 11, 6, 11).fill(0x4a3018).stroke({ color: OUTLINE, width: 1, alpha: 0.6 });
      g.rect(dx + 4, H - 6, 1, 1).fill(0xe0a458);
      for (const wx of [6, W - 11]) {
        g.rect(wx, H - 11, 5, 4).fill(0x6f9bd1).stroke({ color: 0x4a3018, width: 1 });
        g.rect(wx + 2, H - 11, 1, 4).fill(0x4a3018);
      }
      // Chimney on the roof.
      g.rect(W - 11, -structureRise("house", true) - 2, 3, 7).fill(0x6b6b70).stroke({ color: OUTLINE, width: 1, alpha: 0.6 });
      break;
    }
    case "storehouse": {
      roofedBox(g, s.w, s.h, structureRise("storehouse", true), 16, 0x9a6b3a, 0x6b5436, 0x5a4634, snow);
      // Wide barn door and plank lines.
      const dx = Math.round(W / 2) - 7;
      g.rect(dx, H - 13, 14, 13).fill(0x4a3018).stroke({ color: OUTLINE, width: 1, alpha: 0.6 });
      g.rect(dx + 7, H - 13, 1, 13).fill({ color: 0x000000, alpha: 0.3 });
      for (let x = 3; x < W; x += 6) g.rect(x, H - 15, 1, 15).fill({ color: 0x000000, alpha: 0.12 });
      // Barrels by the wall.
      blocks(g, [
        { x: 3, y: H - 6, w: 4, h: 5, c: 0x8a5a2b },
        { x: W - 8, y: H - 5, w: 4, h: 4, c: 0x8a5a2b },
      ]);
      break;
    }
    case "workshop": {
      roofedBox(g, s.w, s.h, structureRise("workshop", true), 14, 0x8a7a6a, 0x5a5a62, 0x4a4a52, snow);
      const dx = Math.round(W / 2) - 3;
      g.rect(dx, H - 10, 6, 10).fill(0x2a2018).stroke({ color: OUTLINE, width: 1, alpha: 0.6 });
      // Anvil outside and a chimney.
      blocks(g, [
        { x: 4, y: H - 5, w: 3, h: 3, c: 0x6b4a2a },
        { x: 3, y: H - 7, w: 6, h: 2, c: 0x3a3a42 },
      ]);
      g.rect(W - 11, -structureRise("workshop", true) - 3, 3, 8).fill(0x2f2f36).stroke({ color: OUTLINE, width: 1, alpha: 0.6 });
      break;
    }
    case "shrine": {
      // A stone plinth with a standing stone and two candles.
      g.rect(0, 0, W, H).fill(0xb5b5c5).stroke({ color: OUTLINE, width: 1, alpha: 0.6 });
      g.rect(2, 2, W - 4, H - 4).fill(0xcfcfdc);
      const m = footprintCenter(s.w, s.h);
      g.rect(m.x - 4, m.y - 14, 8, 16).fill(0xe8e8f4).stroke({ color: OUTLINE, width: 1, alpha: 0.7 });
      g.rect(m.x - 1, m.y - 11, 2, 2).fill(0xfff6c0);
      g.rect(m.x - 9, m.y + 1, 1, 3).fill(0xfff1c0).rect(m.x - 9, m.y, 1, 1).fill(0xffb347);
      g.rect(m.x + 8, m.y + 1, 1, 3).fill(0xfff1c0).rect(m.x + 8, m.y, 1, 1).fill(0xffb347);
      break;
    }
    case "well": {
      const m = footprintCenter(s.w, s.h);
      g.circle(m.x, m.y + 2, 7).fill(0x8a8e93).stroke({ color: OUTLINE, width: 1, alpha: 0.7 });
      g.circle(m.x, m.y + 2, 4).fill(0x1d3b5c);
      g.rect(m.x - 7, m.y - 10, 1, 10).fill(0x7a5a2e).rect(m.x + 6, m.y - 10, 1, 10).fill(0x7a5a2e);
      g.rect(m.x - 8, m.y - 13, 16, 3).fill(snow ? 0xeef2f6 : 0x7c3326).stroke({ color: OUTLINE, width: 1, alpha: 0.6 });
      g.rect(m.x - 1, m.y - 8, 2, 2).fill(0x5a3a1e);
      break;
    }
    case "campfire": {
      const m = footprintCenter(s.w, s.h);
      for (const [dx, dy] of [
        [-6, 0],
        [-4, -4],
        [0, -6],
        [4, -4],
        [6, 0],
        [4, 4],
        [0, 6],
        [-4, 4],
      ]) g.rect(m.x + dx - 1, m.y + dy - 1, 2, 2).fill(0x8a8e93);
      g.rect(m.x - 3, m.y - 1, 6, 2).fill(0x5a3a1e);
      g.rect(m.x - 1, m.y - 3, 2, 6).fill(0x4a2e14);
      // A log to sit on.
      g.rect(m.x - 13, m.y + 6, 8, 2).fill(0x6b4a2a).stroke({ color: OUTLINE, width: 1, alpha: 0.5 });
      break;
    }
    case "dock": {
      g.rect(0, 2, W, H - 4).fill(snow ? 0xe4eaf0 : 0xa37d4e).stroke({ color: OUTLINE, width: 1, alpha: 0.7 });
      for (let x = 4; x < W; x += 4) g.rect(x, 2, 1, H - 4).fill({ color: 0x4a3418, alpha: 0.5 });
      for (const x of [1, W - 3]) g.rect(x, 0, 2, 3).fill(0x4a3418).rect(x, H - 3, 2, 3).fill(0x4a3418);
      g.rect(W - 4, -6, 1, 7).fill(0x4a3418).rect(W - 5, -8, 3, 2).fill(0xffd166);
      break;
    }
    case "mine": {
      plainBox(g, s.w, s.h, structureRise("mine", true), 14, 0x55515c, 0x8a858f, snow);
      const dx = Math.round(W / 2) - 4;
      g.rect(dx, H - 11, 8, 11).fill(0x161419);
      g.rect(dx - 1, H - 12, 1, 12).fill(0x8a6a3a).rect(dx + 8, H - 12, 1, 12).fill(0x8a6a3a).rect(dx - 1, H - 12, 10, 1).fill(0x8a6a3a);
      if (s.depleted) g.rect(dx - 1, H - 8, 10, 1).fill(0xb08a5a).rect(dx - 1, H - 5, 10, 1).fill(0xb08a5a);
      // An ore cart and spoil heap by the entrance.
      blocks(g, [
        { x: W - 10, y: H - 5, w: 6, h: 3, c: 0x5a4a3a },
        { x: W - 9, y: H - 6, w: 4, h: 1, c: s.depleted ? 0x5a4a3a : 0x8d7fa6 },
      ]);
      for (let i = 0; i < 3; i++) g.rect(2 + i, H - 3 - i, 7 - i * 2, 1).fill(0x7b7f84);
      break;
    }
    case "pen": {
      g.rect(0, 0, W, H).fill(snow ? 0xd8dfe6 : 0x8da85a);
      // Fence posts and rails around the edge.
      for (let x = 0; x <= W; x += 8) g.rect(Math.min(x, W - 1), -4, 1, 6).fill(0x5a3f1e).rect(Math.min(x, W - 1), H - 6, 1, 6).fill(0x5a3f1e);
      for (let y = 0; y <= H; y += 8) g.rect(0, Math.min(y, H - 1) - 4, 1, 6).fill(0x5a3f1e).rect(W - 1, Math.min(y, H - 1) - 4, 1, 6).fill(0x5a3f1e);
      g.rect(0, -3, W, 1).fill(0x7a5a2e).rect(0, H - 4, W, 1).fill(0x7a5a2e);
      g.rect(0, -3, 1, H).fill(0x7a5a2e).rect(W - 1, -3, 1, H).fill(0x7a5a2e);
      const m = footprintCenter(s.w, s.h);
      for (let i = 0; i < 4; i++) g.rect(m.x - 5 + i, m.y - 2 - i, 10 - i * 2, 1).fill(0xd9b84a);
      g.rect(m.x + 8, m.y + 3, 7, 3).fill(0x6b4a2a).rect(m.x + 9, m.y + 4, 5, 1).fill(0x3a6fb0);
      break;
    }
    case "market": {
      // A counter under a striped awning on two poles.
      g.rect(0, H - 8, W, 8).fill(0x9c7a4a).stroke({ color: OUTLINE, width: 1, alpha: 0.7 });
      g.rect(1, -structureRise("market", true), 1, H + structureRise("market", true) - 8).fill(0x5a3a1e);
      g.rect(W - 2, -structureRise("market", true), 1, H + structureRise("market", true) - 8).fill(0x5a3a1e);
      const top = -structureRise("market", true);
      for (let x = 0; x < W; x += 4) g.rect(x, top, 4, 6).fill(Math.floor(x / 4) % 2 ? (snow ? 0xe8ecf0 : 0xf2efe6) : 0xc0504d);
      g.rect(0, top + 6, W, 1).fill({ color: 0x000000, alpha: 0.3 });
      g.rect(3, H - 11, 4, 3).fill(0xd9a441).rect(9, H - 12, 3, 4).fill(0x6b8e4e).rect(W - 8, H - 11, 4, 3).fill(0x8a8e93);
      break;
    }
    case "farm": {
      const growth = s.growth;
      const soil = snow ? 0xc5beb4 : 0x7a5533;
      g.rect(0, 0, W, H).fill(soil).stroke({ color: 0x3f2d16, width: 1, alpha: 0.5 });
      for (let y = 3; y < H; y += 4) {
        g.rect(1, y, W - 2, 1).fill({ color: 0x3f2d16, alpha: 0.35 });
        if (growth !== undefined && growth > 0.1) {
          const n = Math.round(2 + growth * 3);
          for (let i = 0; i < n; i++) {
            const sx = Math.round(2 + ((W - 4) * (i + 0.5)) / n);
            const hgt = growth >= 1 ? 4 : growth > 0.6 ? 3 : 2;
            g.rect(sx, y - hgt, 1, hgt).fill(growth >= 1 ? 0xf0d060 : 0x2f7a2c);
            if (growth >= 1) g.rect(sx - 1, y - hgt - 1, 3, 1).fill(0xd4b24a);
          }
        }
      }
      break;
    }
    default: {
      plainBox(g, s.w, s.h, 10, 10, shade(def.color, 0.8), def.color, snow);
    }
  }
}

/** Animated flame for a campfire, drawn at the fire's centre. */
export function drawFlame(g: Graphics, cx: number, cy: number, t: number): void {
  g.clear();
  const flick = Math.sin(t * 9) * 1.5 + Math.sin(t * 23) * 0.8;
  const h = 7 + flick;
  g.poly([cx - 4, cy - 1, cx + 4, cy - 1, cx, cy - h]).fill(0xff9a3c);
  g.poly([cx - 2, cy - 1, cx + 2, cy - 1, cx, cy - h * 0.6]).fill(0xffe08a);
  g.rect(cx - 1 + Math.round(Math.sin(t * 5)), cy - h - 3, 1, 1).fill({ color: 0xffb060, alpha: 0.8 });
}

/** Rising smoke puffs; `strength` 0 draws nothing. */
export function drawSmoke(g: Graphics, cx: number, cy: number, t: number, strength: number): void {
  g.clear();
  if (strength <= 0) return;
  for (let i = 0; i < 3; i++) {
    const phase = (t * 0.35 + i / 3) % 1;
    const y = cy - phase * 16;
    const x = cx + Math.sin((t + i) * 1.3) * 2 * phase;
    g.circle(x, y, 1.5 + phase * 2.5).fill({ color: 0xd0d0d8, alpha: strength * (0.5 - phase * 0.45) });
  }
}

// ---- Textures for things that appear hundreds of times --------------------------------

export interface DecorTexture {
  texture: Texture;
  /** Anchor so the sprite's ground point lands on its position. */
  ax: number;
  ay: number;
}

function bake(renderer: Renderer, draw: (g: Graphics) => void): DecorTexture {
  const g = new Graphics();
  draw(g);
  const b = g.getLocalBounds();
  const texture = renderer.generateTexture({ target: g, antialias: false, resolution: 1 });
  texture.source.scaleMode = "nearest";
  g.destroy();
  return { texture, ax: -b.minX / b.width, ay: -b.minY / b.height };
}

export interface DecorSet {
  trees: DecorTexture[][]; // [variant][big ? 1 : 0]
  rock: DecorTexture[]; // [big ? 1 : 0]
  ore: DecorTexture[];
  bush: DecorTexture;
  reeds: DecorTexture;
}

export function bakeDecor(renderer: Renderer, pal: Palette): DecorSet {
  return {
    trees: [0, 1].map((v) => [bake(renderer, (g) => drawTree(g, v, false, pal)), bake(renderer, (g) => drawTree(g, v, true, pal))]),
    rock: [bake(renderer, (g) => drawRock(g, false, false, pal)), bake(renderer, (g) => drawRock(g, false, true, pal))],
    ore: [bake(renderer, (g) => drawRock(g, true, false, pal)), bake(renderer, (g) => drawRock(g, true, true, pal))],
    bush: bake(renderer, (g) => drawBush(g, pal)),
    reeds: bake(renderer, (g) => drawReeds(g, pal)),
  };
}

export function destroyDecor(set: DecorSet): void {
  for (const d of [...set.trees.flat(), ...set.rock, ...set.ore, set.bush, set.reeds]) d.texture.destroy(true);
}

export function makeSprite(d: DecorTexture): Sprite {
  const sp = new Sprite(d.texture);
  sp.anchor.set(d.ax, d.ay);
  return sp;
}

// ---- Colour helpers -----------------------------------------------------------------------

export function hslToHex(h: number, s: number, l: number): number {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  r = Math.round((r + m) * 255);
  g = Math.round((g + m) * 255);
  b = Math.round((b + m) * 255);
  return (r << 16) | (g << 8) | b;
}

export function lerpColor(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  const r = Math.round(ar + (br - ar) * t), g = Math.round(ag + (bg - ag) * t), bl = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (g << 8) | bl;
}
