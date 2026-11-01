// The optional pixel-art pack (Cozy Isometric Exterior by Choco Ted). When
// client/public/pack/manifest.json exists, grass, paths, trees and houses come
// from its sheets; everything else, and everything when it is absent, stays
// drawn in code. The pack's grid is a 32×16 diamond, the same as ours.

import { Assets, Rectangle, Texture } from "pixi.js";

export interface Pack {
  name: string;
  credit: string;
  /** Flat grass variants: plain, blades, purple flowers, mixed flowers. */
  grass: Texture[];
  /** Grass top with earth faces below: for tiles on the map's near edges. 32×32, diamond in the top half. */
  cliff: Texture;
  /** Path tiles keyed by the 8-neighbour blob mask (see pathMaskKey). */
  path: Map<string, Texture>;
  treesGreen: Texture[];
  treesDry: Texture[];
  houses: Texture[];
}

interface Manifest {
  name: string;
  credit: string;
  files: Record<string, string>;
}

/**
 * The path autotile: 47 tiles for every way a path can meet its neighbours.
 * Key bits, in order: edges toward (x,y-1), (x+1,y), (x,y+1), (x-1,y), then
 * corners toward (x-1,y-1), (x+1,y-1), (x+1,y+1), (x-1,y+1). Measured from the sheet.
 */
const PATH_TABLE: [string, number, number][] = [
  ["01100010", 0, 0], ["01110011", 1, 0], ["00110001", 2, 0], ["00100000", 3, 0], ["01100000", 4, 0], ["01110001", 5, 0], ["01110010", 6, 0],
  ["00110000", 7, 0], ["11111100", 8, 0], ["01110000", 9, 0], ["11110110", 10, 0], ["11110101", 11, 0], ["11111010", 12, 0],
  ["11100110", 0, 1], ["11111111", 1, 1], ["10111001", 2, 1], ["10100000", 3, 1], ["11100100", 4, 1], ["11111101", 5, 1], ["11111110", 6, 1],
  ["10111000", 7, 1], ["11100000", 8, 1], ["11110000", 9, 1], ["10110000", 10, 1], ["11110010", 11, 1], ["11110001", 12, 1],
  ["11000100", 0, 2], ["11011100", 1, 2], ["10011000", 2, 2], ["10000000", 3, 2], ["11100010", 4, 2], ["11111011", 5, 2], ["11110111", 6, 2],
  ["10110001", 7, 2], ["11110011", 8, 2], ["11010000", 9, 2], ["11111001", 10, 2], ["11110100", 11, 2], ["11111000", 12, 2],
  ["01000000", 0, 3], ["01010000", 1, 3], ["00010000", 2, 3], ["00000000", 3, 3], ["11000000", 4, 3], ["11011000", 5, 3], ["11010100", 6, 3],
  ["10010000", 7, 3],
];

/**
 * Turn "is each of the 8 neighbours also path?" into a key for PATH_TABLE. A
 * corner only matters when both edges beside it are path too (the usual blob rule).
 */
export function pathMaskKey(n: { ne: boolean; se: boolean; sw: boolean; nw: boolean; top: boolean; right: boolean; bottom: boolean; left: boolean }): string {
  const b = (v: boolean) => (v ? "1" : "0");
  return (
    b(n.ne) + b(n.se) + b(n.sw) + b(n.nw) + b(n.top && n.nw && n.ne) + b(n.right && n.ne && n.se) + b(n.bottom && n.se && n.sw) + b(n.left && n.sw && n.nw)
  );
}

function frame(base: Texture, x: number, y: number, w: number, h: number): Texture {
  return new Texture({ source: base.source, frame: new Rectangle(x, y, w, h) });
}

async function sheet(url: string): Promise<Texture> {
  const t = await Assets.load<Texture>(url);
  t.source.scaleMode = "nearest"; // pixel art stays crisp at integer zoom
  return t;
}

/** Null when no pack is installed (see client/public/pack/README.md). */
export async function loadPack(): Promise<Pack | null> {
  let manifest: Manifest;
  try {
    const res = await fetch("/pack/manifest.json", { cache: "no-cache" });
    if (!res.ok) return null;
    manifest = (await res.json()) as Manifest;
  } catch {
    return null;
  }
  const f = manifest.files;
  const need = ["grass", "path", "treeGreen5", "treeGreen6", "treeDry5", "treeDry6", "house5", "house6"];
  if (need.some((k) => !f[k])) {
    console.warn("[pack] manifest is missing files; drawing in code instead");
    return null;
  }
  const url = (k: string) => `/pack/${f[k]}`;
  try {
    const [grass, path, g5, g6, d5, d6, h5, h6] = await Promise.all(need.map((k) => sheet(url(k))));
    const pathMap = new Map<string, Texture>();
    for (const [key, col, row] of PATH_TABLE) pathMap.set(key, frame(path, col * 32, row * 32, 32, 16));
    return {
      name: manifest.name,
      credit: manifest.credit,
      grass: [0, 1, 2, 3].map((i) => frame(grass, 160, i * 32, 32, 16)),
      cliff: frame(grass, 0, 0, 32, 32),
      path: pathMap,
      treesGreen: [g5, g6],
      treesDry: [d5, d6],
      houses: [h5, h6],
    };
  } catch (err) {
    console.warn("[pack] could not load:", err);
    return null;
  }
}
