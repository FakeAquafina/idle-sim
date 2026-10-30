// Placeholder pixel art, drawn with rectangles so there are no image files to
// ship. Every function draws relative to a "ground point": for trees, animals
// and villagers that is where they touch the ground; for buildings it is the
// top corner of their footprint diamond. Screen y grows downward, so things
// that stand up have negative y.

import { Graphics, type Renderer, Sprite, type Texture } from "pixi.js";
import type { Structure, StructureDef, Tile } from "@idle-sim/shared";
import { TILE_H, TILE_W, footprint } from "./projection.ts";

const OUTLINE = 0x1a1a24;

export const GROUND_COLORS: Record<Tile["kind"], [number, number]> = {
  grass: [0x5a9a3f, 0x549238],
  dirt: [0x8e6b43, 0x86643e],
  water: [0x3a6fb0, 0x3769a8],
  sand: [0xd9c98a, 0xd1c183],
  forest: [0x4a8336, 0x447c32],
  rock: [0x7b7f84, 0x74787d],
  ore: [0x6d6378, 0x665c71],
  farmland: [0x6e4b2a, 0x684626],
};

/** Cheap deterministic hash so the same tile always gets the same variant. */
export function hash(x: number, y: number, salt = 0): number {
  let h = (x * 374761393 + y * 668265263 + salt * 2246822519) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

// ---- Ground ---------------------------------------------------------------

/** One ground tile: a 32×16 diamond centred on (cx, cy) with a little texture. */
export function drawGroundTile(g: Graphics, cx: number, cy: number, tile: Tile, x: number, y: number): void {
  const h = hash(x, y);
  const [a, b] = GROUND_COLORS[tile.kind];
  const base = h & 1 ? a : b;
  g.poly([cx, cy - TILE_H / 2, cx + TILE_W / 2, cy, cx, cy + TILE_H / 2, cx - TILE_W / 2, cy]).fill(base);
  // A faint edge on the two lower sides reads as a grid without shouting.
  g.moveTo(cx - TILE_W / 2, cy).lineTo(cx, cy + TILE_H / 2).lineTo(cx + TILE_W / 2, cy).stroke({ color: 0x000000, alpha: 0.12, width: 1 });

  switch (tile.kind) {
    case "grass":
    case "forest":
      if ((h >> 3) % 3 === 0) g.rect(cx - 6 + ((h >> 5) % 10), cy - 2 + ((h >> 9) % 4), 1, 2).fill({ color: 0x3f7a2a, alpha: 0.7 });
      break;
    case "dirt":
      g.rect(cx - 5 + ((h >> 5) % 8), cy - 2 + ((h >> 9) % 4), 2, 1).fill({ color: 0x6f5232, alpha: 0.6 });
      break;
    case "sand":
      if ((h >> 3) % 2 === 0) g.rect(cx - 6 + ((h >> 5) % 10), cy - 2 + ((h >> 9) % 4), 1, 1).fill(0xbfae72);
      break;
    case "water":
      if ((h >> 3) % 3 === 0) g.rect(cx - 7 + ((h >> 5) % 8), cy - 3 + ((h >> 9) % 5), 5, 1).fill({ color: 0x8fb6e0, alpha: 0.6 });
      break;
    case "farmland":
      g.moveTo(cx - 8, cy - 4).lineTo(cx + 8, cy + 4).stroke({ color: 0x3f2d16, alpha: 0.35, width: 1 });
      break;
    default:
      break;
  }
}

// ---- Shadows ---------------------------------------------------------------

/** A flat pixel ellipse on the ground plane. */
function shadow(g: Graphics, cx: number, cy: number, w: number): void {
  const rows = [0.5, 0.85, 1, 0.85, 0.5];
  for (let i = 0; i < rows.length; i++) {
    const rw = Math.max(2, Math.round(w * rows[i]));
    g.rect(cx - rw / 2, cy - 2 + i, rw, 1).fill({ color: 0x000000, alpha: 0.22 });
  }
}

// ---- Trees, rocks, ore ------------------------------------------------------

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

export function drawTree(g: Graphics, variant: number, big: boolean): void {
  const s = big ? 1 : 0.7;
  shadow(g, 0, 0, 12 * s);
  const trunk = 0x5a3a1e;
  const px: Px[] = [{ x: -1, y: -Math.round(6 * s), w: 2, h: Math.round(6 * s), c: trunk }];
  if (variant % 2 === 0) {
    // Round broadleaf: stacked rows widening then narrowing.
    const rows: [number, number][] = [
      [10, 3],
      [12, 4],
      [10, 3],
      [6, 3],
      [2, 2],
    ];
    let y = -Math.round(5 * s);
    for (const [w, h] of rows) {
      const hh = Math.max(1, Math.round(h * s));
      const ww = Math.round(w * s);
      y -= hh;
      px.push({ x: -Math.floor(ww / 2), y, w: ww, h: hh, c: 0x2f7a2c });
    }
    // Light catches the upper left, shade sits lower right.
    px.push({ x: -Math.round(4 * s), y: -Math.round(13 * s), w: Math.round(3 * s), h: Math.round(3 * s), c: 0x4c9a3d });
    px.push({ x: Math.round(1 * s), y: -Math.round(8 * s), w: Math.round(3 * s), h: Math.round(2 * s), c: 0x1f5a1f });
  } else {
    // Conifer: layered triangles.
    const layers: number[] = [12, 10, 8, 6, 3];
    let y = -Math.round(5 * s);
    for (const w of layers) {
      const hh = Math.max(1, Math.round(3 * s));
      const ww = Math.round(w * s);
      y -= hh;
      px.push({ x: -Math.floor(ww / 2), y, w: ww, h: hh, c: 0x2a6b36 });
    }
    px.push({ x: -Math.round(3 * s), y: -Math.round(14 * s), w: Math.round(2 * s), h: Math.round(2 * s), c: 0x4c9a3d });
  }
  blocks(g, px);
}

export function drawRock(g: Graphics, ore: boolean, big: boolean): void {
  const s = big ? 1 : 0.75;
  shadow(g, 0, 1, 12 * s);
  const base = ore ? 0x7d6f93 : 0x8a8e93;
  const light = ore ? 0x9a8cb0 : 0xa7abb0;
  const dark = ore ? 0x564a6a : 0x5c6064;
  const px: Px[] = [
    { x: -Math.round(6 * s), y: -Math.round(4 * s), w: Math.round(12 * s), h: Math.round(4 * s), c: base },
    { x: -Math.round(4 * s), y: -Math.round(7 * s), w: Math.round(7 * s), h: Math.round(3 * s), c: base },
    { x: -Math.round(3 * s), y: -Math.round(7 * s), w: Math.round(3 * s), h: Math.round(2 * s), c: light },
    { x: Math.round(1 * s), y: -Math.round(2 * s), w: Math.round(5 * s), h: Math.round(2 * s), c: dark },
  ];
  blocks(g, px);
  if (ore) {
    g.rect(-3, -3, 2, 1).fill(0xe6c86a);
    g.rect(1, -5, 1, 1).fill(0xe6c86a);
    g.rect(3, -2, 1, 1).fill(0xe6c86a);
  }
}

// ---- Villagers and animals ----------------------------------------------------

const HAIR = [0x2b1d12, 0x5a3a1e, 0x9a6a3a, 0xd9a066, 0x1a1a1a, 0xb04a2a, 0x3b2a4a];
const SKIN = [0xf1c9a5, 0xe0b48c, 0xc98f63, 0x8d5a3b, 0x6b4328];

export interface VillagerLookOpts {
  stage: "child" | "adult" | "elder";
  shirt: number;
  hairIndex: number;
  skinIndex: number;
  resting: boolean;
}

export function lookFor(id: string, stage: "child" | "adult" | "elder", resting: boolean): VillagerLookOpts {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) | 0;
  const hue = Math.abs(h) % 360;
  return { stage, shirt: hslToHex(hue, 0.55, 0.5), hairIndex: Math.abs(h >> 4) % HAIR.length, skinIndex: Math.abs(h >> 8) % SKIN.length, resting };
}

/** Height in pixels of a villager sprite, for hit testing and bubbles. */
export function villagerHeight(stage: "child" | "adult" | "elder"): number {
  return stage === "child" ? 11 : 16;
}

export function drawVillager(g: Graphics, o: VillagerLookOpts): void {
  const skin = SKIN[o.skinIndex];
  const hair = o.stage === "elder" ? 0xd8d8d8 : HAIR[o.hairIndex];
  const trousers = 0x3b3350;
  const px: Px[] = [];
  if (o.stage === "child") {
    shadow(g, 0, 0, 7);
    px.push({ x: -2, y: -2, w: 2, h: 2, c: trousers }, { x: 0, y: -2, w: 2, h: 2, c: trousers });
    px.push({ x: -2, y: -6, w: 4, h: 4, c: o.shirt });
    px.push({ x: -2, y: -10, w: 4, h: 4, c: skin });
    px.push({ x: -2, y: -11, w: 4, h: 1, c: hair });
    blocks(g, px);
    g.rect(-1, -9, 1, 1).fill(OUTLINE).rect(0, -9, 1, 1).fill(OUTLINE);
  } else {
    shadow(g, 0, 0, 9);
    px.push({ x: -3, y: -3, w: 2, h: 3, c: trousers }, { x: 1, y: -3, w: 2, h: 3, c: trousers });
    px.push({ x: -3, y: -9, w: 6, h: 6, c: o.shirt });
    px.push({ x: -4, y: -8, w: 1, h: 3, c: skin }, { x: 3, y: -8, w: 1, h: 3, c: skin });
    px.push({ x: -2, y: -14, w: 5, h: 5, c: skin });
    px.push({ x: -2, y: -16, w: 5, h: 2, c: hair }, { x: -2, y: -14, w: 1, h: 2, c: hair }, { x: 2, y: -14, w: 1, h: 2, c: hair });
    if (o.stage === "elder") px.push({ x: 5, y: -13, w: 1, h: 13, c: 0x7a5a2e });
    blocks(g, px);
    g.rect(-1, -12, 1, 1).fill(OUTLINE).rect(1, -12, 1, 1).fill(OUTLINE);
  }
  if (o.resting) {
    // A little "z" floating above the head.
    const top = o.stage === "child" ? -15 : -21;
    g.rect(4, top, 3, 1).fill({ color: 0xffffff, alpha: 0.8 });
    g.rect(5, top + 1, 1, 1).fill({ color: 0xffffff, alpha: 0.8 });
    g.rect(4, top + 2, 3, 1).fill({ color: 0xffffff, alpha: 0.8 });
  }
}

export function drawAnimal(g: Graphics, kind: "deer" | "goat", tame: boolean): void {
  const px: Px[] = [];
  if (kind === "deer") {
    shadow(g, 0, 0, 10);
    const body = 0x9a6a3a;
    px.push({ x: -3, y: -2, w: 1, h: 2, c: 0x5a3a1e }, { x: -1, y: -2, w: 1, h: 2, c: 0x5a3a1e }, { x: 2, y: -2, w: 1, h: 2, c: 0x5a3a1e }, { x: 4, y: -2, w: 1, h: 2, c: 0x5a3a1e });
    px.push({ x: -4, y: -6, w: 9, h: 4, c: body });
    px.push({ x: 4, y: -9, w: 3, h: 3, c: body });
    px.push({ x: 4, y: -11, w: 1, h: 2, c: 0x4a3015 }, { x: 6, y: -11, w: 1, h: 2, c: 0x4a3015 });
    px.push({ x: -5, y: -6, w: 1, h: 1, c: 0xf3ecd8 });
    blocks(g, px);
    g.rect(6, -8, 1, 1).fill(OUTLINE);
  } else {
    shadow(g, 0, 0, 8);
    const body = tame ? 0xe9e1cc : 0xcdc3a6;
    px.push({ x: -3, y: -2, w: 1, h: 2, c: 0x4a4030 }, { x: -1, y: -2, w: 1, h: 2, c: 0x4a4030 }, { x: 1, y: -2, w: 1, h: 2, c: 0x4a4030 });
    px.push({ x: -3, y: -5, w: 6, h: 3, c: body });
    px.push({ x: 3, y: -8, w: 3, h: 3, c: body });
    px.push({ x: 3, y: -9, w: 1, h: 1, c: 0x4a4030 }, { x: 5, y: -9, w: 1, h: 1, c: 0x4a4030 });
    px.push({ x: 5, y: -5, w: 1, h: 1, c: 0xd9cfb4 });
    blocks(g, px);
    g.rect(5, -7, 1, 1).fill(OUTLINE);
  }
}

// ---- Buildings ----------------------------------------------------------------

/** How tall each kind stands above its footprint, in pixels (0 = flat). Used for sorting and hit tests. */
export function structureHeight(kind: string, built: boolean): number {
  if (!built) return 0;
  return { house: 14, storehouse: 12, workshop: 13, mine: 9, shrine: 14, well: 10, campfire: 6, dock: 3, pen: 5, farm: 0 }[kind] ?? 8;
}

interface Pt {
  x: number;
  y: number;
}
const rel = (o: Pt, p: Pt): Pt => ({ x: p.x - o.x, y: p.y - o.y });
const up = (p: Pt, dy: number): Pt => ({ x: p.x, y: p.y - dy });
const pts = (...p: Pt[]): number[] => p.flatMap((q) => [q.x, q.y]);

/** Footprint corners relative to the top corner. */
function corners(w: number, h: number) {
  const f = footprint(0, 0, w, h);
  const o = f.top;
  return { top: rel(o, f.top), right: rel(o, f.right), bottom: rel(o, f.bottom), left: rel(o, f.left) };
}

/** A box standing on the footprint: two visible walls and a flat top. */
function isoBox(g: Graphics, w: number, h: number, height: number, leftWall: number, rightWall: number, top: number): void {
  const c = corners(w, h);
  g.poly(pts(c.left, c.bottom, up(c.bottom, height), up(c.left, height))).fill(leftWall).stroke({ color: OUTLINE, width: 1, alpha: 0.6 });
  g.poly(pts(c.bottom, c.right, up(c.right, height), up(c.bottom, height))).fill(rightWall).stroke({ color: OUTLINE, width: 1, alpha: 0.6 });
  g.poly(pts(up(c.top, height), up(c.right, height), up(c.bottom, height), up(c.left, height))).fill(top).stroke({ color: OUTLINE, width: 1, alpha: 0.6 });
}

/** A pitched roof on top of a box, ridge running along world x (top → right). */
function gableRoof(g: Graphics, w: number, h: number, height: number, rise: number, front: number, back: number, gable: number): void {
  const c = corners(w, h);
  const T = up(c.top, height), R = up(c.right, height), B = up(c.bottom, height), L = up(c.left, height);
  const ridgeA = up({ x: (T.x + L.x) / 2, y: (T.y + L.y) / 2 }, rise);
  const ridgeB = up({ x: (R.x + B.x) / 2, y: (R.y + B.y) / 2 }, rise);
  g.poly(pts(T, R, ridgeB, ridgeA)).fill(back).stroke({ color: OUTLINE, width: 1, alpha: 0.6 });
  g.poly(pts(L, B, ridgeB, ridgeA)).fill(front).stroke({ color: OUTLINE, width: 1, alpha: 0.6 });
  g.poly(pts(R, B, ridgeB)).fill(gable).stroke({ color: OUTLINE, width: 1, alpha: 0.6 });
}

function floorDiamond(g: Graphics, w: number, h: number, color: number, alpha = 1): void {
  const c = corners(w, h);
  g.poly(pts(c.top, c.right, c.bottom, c.left)).fill({ color, alpha });
}

/** Centre of the footprint relative to the top corner. */
export function footprintCenter(w: number, h: number): Pt {
  return { x: ((w - h) * TILE_W) / 4, y: ((w + h) * TILE_H) / 4 };
}

/** Draws the static part of a structure. Flames and other animation are drawn separately. */
export function drawStructure(g: Graphics, s: Structure, def: StructureDef): void {
  const { w, h } = s;
  const c = corners(w, h);
  if (!s.built) {
    floorDiamond(g, w, h, def.color, 0.3);
    g.poly(pts(c.top, c.right, c.bottom, c.left)).stroke({ color: def.color, width: 1, alpha: 0.9 });
    const post = Math.round(10 * s.progress);
    if (post > 0) for (const p of [c.left, c.bottom, c.right]) g.rect(p.x, p.y - post, 1, post).fill(0x8a6a3a);
    g.rect(c.top.x - 10, c.top.y - 10, 20, 3).fill({ color: 0x000000, alpha: 0.5 });
    g.rect(c.top.x - 10, c.top.y - 10, Math.round(20 * s.progress), 3).fill(0xe0a458);
    return;
  }
  switch (s.kind) {
    case "house": {
      isoBox(g, w, h, 10, 0xdcc39a, 0xc0a67e, 0xb59a74);
      gableRoof(g, w, h, 10, 6, 0x7c3326, 0x9a4232, 0xdcc39a);
      // Door on the right wall, window on the left wall.
      const dm = { x: (c.bottom.x + c.right.x) / 2, y: (c.bottom.y + c.right.y) / 2 };
      g.rect(dm.x - 2, dm.y - 7, 4, 7).fill(0x4a3018);
      const wm = { x: (c.left.x + c.bottom.x) / 2, y: (c.left.y + c.bottom.y) / 2 };
      g.rect(wm.x - 2, wm.y - 8, 3, 3).fill(0x6f9bd1).stroke({ color: 0x4a3018, width: 1 });
      break;
    }
    case "storehouse": {
      isoBox(g, w, h, 12, 0x9a6b3a, 0x7e5630, 0x5a4634);
      // Plank lines on the roof and a wide door.
      for (let i = 1; i < 4; i++) {
        const t = i / 4;
        const a = { x: c.top.x + (c.left.x - c.top.x) * t, y: c.top.y + (c.left.y - c.top.y) * t - 12 };
        const b = { x: c.right.x + (c.bottom.x - c.right.x) * t, y: c.right.y + (c.bottom.y - c.right.y) * t - 12 };
        g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ color: 0x3f2f22, width: 1, alpha: 0.7 });
      }
      const dm = { x: (c.bottom.x + c.right.x) / 2, y: (c.bottom.y + c.right.y) / 2 };
      g.rect(dm.x - 3, dm.y - 8, 6, 8).fill(0x4a3018);
      break;
    }
    case "workshop": {
      isoBox(g, w, h, 13, 0x8a7a6a, 0x6e6052, 0x4a4a52);
      g.rect(c.right.x - 10, c.right.y - 13 - 7, 3, 8).fill(0x2f2f36).stroke({ color: OUTLINE, width: 1, alpha: 0.6 });
      const dm = { x: (c.bottom.x + c.right.x) / 2, y: (c.bottom.y + c.right.y) / 2 };
      g.rect(dm.x - 2, dm.y - 7, 4, 7).fill(0x2a2018);
      break;
    }
    case "shrine": {
      isoBox(g, w, h, 4, 0xb5b5c5, 0x9494a6, 0xcfcfdc);
      const m = footprintCenter(w, h);
      g.rect(m.x - 3, m.y - 4 - 10, 6, 10).fill(0xe8e8f4).stroke({ color: OUTLINE, width: 1, alpha: 0.7 });
      g.rect(m.x - 1, m.y - 4 - 8, 2, 2).fill(0xfff6c0);
      break;
    }
    case "well": {
      isoBox(g, w, h, 5, 0x8a8e93, 0x6a6e73, 0x5c6064);
      const m = footprintCenter(w, h);
      g.poly([m.x, m.y - 5 - 3, m.x + 8, m.y - 5, m.x, m.y - 5 + 3, m.x - 8, m.y - 5]).fill(0x1d3b5c);
      g.rect(m.x - 9, m.y - 15, 1, 10).fill(0x7a5a2e).rect(m.x + 8, m.y - 15, 1, 10).fill(0x7a5a2e);
      g.rect(m.x - 9, m.y - 15, 18, 1).fill(0x7a5a2e);
      g.rect(m.x - 1, m.y - 12, 2, 2).fill(0x5a3a1e);
      break;
    }
    case "campfire": {
      const m = footprintCenter(w, h);
      const ring = [
        [-6, 0],
        [-4, -2],
        [0, -3],
        [4, -2],
        [6, 0],
        [4, 2],
        [0, 3],
        [-4, 2],
      ];
      for (const [dx, dy] of ring) g.rect(m.x + dx - 1, m.y + dy - 1, 2, 2).fill(0x8a8e93);
      g.rect(m.x - 3, m.y - 1, 6, 2).fill(0x5a3a1e);
      g.rect(m.x - 1, m.y - 3, 2, 6).fill(0x4a2e14);
      break;
    }
    case "dock": {
      isoBox(g, w, h, 3, 0x7d5b32, 0x6a4c28, 0xa37d4e);
      for (let i = 1; i < w * 4; i++) {
        const t = i / (w * 4);
        const a = { x: c.top.x + (c.right.x - c.top.x) * t, y: c.top.y + (c.right.y - c.top.y) * t - 3 };
        const b = { x: c.left.x + (c.bottom.x - c.left.x) * t, y: c.left.y + (c.bottom.y - c.left.y) * t - 3 };
        g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ color: 0x4a3418, width: 1, alpha: 0.6 });
      }
      for (const p of [c.left, c.bottom, c.right]) g.rect(p.x - 1, p.y - 8, 2, 8).fill(0x4a3418);
      break;
    }
    case "mine": {
      isoBox(g, w, h, 9, 0x6e6a72, 0x55515c, 0x8a858f);
      const dm = { x: (c.bottom.x + c.right.x) / 2, y: (c.bottom.y + c.right.y) / 2 };
      g.rect(dm.x - 3, dm.y - 7, 6, 7).fill(0x161419);
      g.rect(dm.x - 4, dm.y - 8, 1, 8).fill(0x8a6a3a).rect(dm.x + 3, dm.y - 8, 1, 8).fill(0x8a6a3a).rect(dm.x - 4, dm.y - 8, 8, 1).fill(0x8a6a3a);
      if (s.depleted) g.rect(dm.x - 4, dm.y - 5, 8, 1).fill(0xb08a5a).rect(dm.x - 4, dm.y - 3, 8, 1).fill(0xb08a5a);
      break;
    }
    case "pen": {
      floorDiamond(g, w, h, 0x6f9140);
      const edges: [Pt, Pt][] = [
        [c.top, c.right],
        [c.right, c.bottom],
        [c.bottom, c.left],
        [c.left, c.top],
      ];
      for (const [a, b] of edges) {
        for (const dy of [2, 4]) g.moveTo(a.x, a.y - dy).lineTo(b.x, b.y - dy).stroke({ color: 0x7a5a2e, width: 1 });
        const n = Math.max(1, Math.round(Math.hypot(b.x - a.x, b.y - a.y) / 12));
        for (let i = 0; i <= n; i++) {
          const t = i / n;
          g.rect(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t - 5, 1, 5).fill(0x5a3f1e);
        }
      }
      break;
    }
    case "farm": {
      const growth = s.growth;
      const color = growth === undefined ? 0x6e4b2a : growth >= 1 ? 0xd4b24a : lerpColor(0x7a5c2e, 0x5aa83a, growth);
      floorDiamond(g, w, h, color);
      g.poly(pts(c.top, c.right, c.bottom, c.left)).stroke({ color: 0x3f2d16, width: 1, alpha: 0.5 });
      const rows = h * 4;
      for (let k = 1; k < rows; k++) {
        const t = k / rows;
        const a = { x: c.top.x + (c.left.x - c.top.x) * t, y: c.top.y + (c.left.y - c.top.y) * t };
        const b = { x: c.right.x + (c.bottom.x - c.right.x) * t, y: c.right.y + (c.bottom.y - c.right.y) * t };
        g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ color: 0x3f2d16, width: 1, alpha: 0.35 });
        if (growth !== undefined && growth > 0.1) {
          const sprouts = Math.round(1 + growth * 4);
          for (let i = 0; i < sprouts; i++) {
            const u = (i + 0.5) / sprouts;
            const sx = Math.round(a.x + (b.x - a.x) * u);
            const sy = Math.round(a.y + (b.y - a.y) * u);
            g.rect(sx, sy - 2, 1, 2).fill(growth >= 1 ? 0xf0d060 : 0x2f7a2c);
          }
        }
      }
      break;
    }
    default:
      isoBox(g, w, h, 8, def.color, darken(def.color, 0.8), darken(def.color, 0.65));
  }
}

/** The campfire's flames, redrawn a few times a second for flicker. `t` is any changing number. */
export function drawFlame(g: Graphics, cx: number, cy: number, t: number): void {
  g.clear();
  const h1 = 3 + Math.round(2 * Math.abs(Math.sin(t * 7)));
  const h2 = 4 + Math.round(2 * Math.abs(Math.sin(t * 5 + 1)));
  const h3 = 2 + Math.round(2 * Math.abs(Math.sin(t * 9 + 2)));
  g.rect(cx - 3, cy - 1 - h1, 2, h1).fill(0xff8c2a);
  g.rect(cx - 1, cy - 1 - h2, 2, h2).fill(0xffb347);
  g.rect(cx + 1, cy - 1 - h3, 2, h3).fill(0xff8c2a);
  g.rect(cx - 1, cy - 1 - Math.max(1, h2 - 2), 2, Math.max(1, h2 - 2)).fill(0xfff1a8);
}

// ---- Textures for things that appear hundreds of times -------------------------

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
}

export function bakeDecor(renderer: Renderer): DecorSet {
  return {
    trees: [0, 1].map((v) => [bake(renderer, (g) => drawTree(g, v, false)), bake(renderer, (g) => drawTree(g, v, true))]),
    rock: [bake(renderer, (g) => drawRock(g, false, false)), bake(renderer, (g) => drawRock(g, false, true))],
    ore: [bake(renderer, (g) => drawRock(g, true, false)), bake(renderer, (g) => drawRock(g, true, true))],
  };
}

export function makeSprite(d: DecorTexture): Sprite {
  const sp = new Sprite(d.texture);
  sp.anchor.set(d.ax, d.ay);
  return sp;
}

// ---- Colour helpers ---------------------------------------------------------------

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

function darken(c: number, f: number): number {
  return lerpColor(0x000000, c, f);
}
