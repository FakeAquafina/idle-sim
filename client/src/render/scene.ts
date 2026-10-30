// Draws the world from the mirrored state. Placeholder shapes for now.

import { Container, Graphics, Text } from "pixi.js";
import { STRUCTURES, type Structure, type Tile, type VillagerView } from "@idle-sim/shared";
import type { MirrorState } from "../net.ts";
import { TILE, projection } from "./projection.ts";

const TILE_COLORS: Record<Tile["kind"], number> = {
  grass: 0x4f8a3b,
  dirt: 0x8a6a3b,
  water: 0x2f5f9e,
  forest: 0x2f6b2a,
  rock: 0x6f7378,
  farmland: 0x6e4b2a,
};

interface StructureView {
  root: Container;
  gfx: Graphics;
  label: Text;
  key: string;
}

interface VillagerLook {
  root: Container;
  body: Graphics;
  name: Text;
  bubble: Container;
  bubbleBg: Graphics;
  bubbleText: Text;
  target: { x: number; y: number };
  key: string;
}

export class Scene {
  readonly root = new Container();
  private tiles = new Graphics();
  private structureLayer = new Container();
  private villagerLayer = new Container();
  private structureViews = new Map<string, StructureView>();
  private villagerViews = new Map<string, VillagerLook>();
  onVillagerClick: ((id: string) => void) | null = null;
  private shouldIgnoreClick: () => boolean = () => false;

  constructor() {
    this.villagerLayer.sortableChildren = true;
    this.root.addChild(this.tiles, this.structureLayer, this.villagerLayer);
  }

  setClickGuard(fn: () => boolean) {
    this.shouldIgnoreClick = fn;
  }

  rebuildAll(state: MirrorState): void {
    this.drawTiles(state);
    this.structureLayer.removeChildren();
    this.structureViews.clear();
    this.villagerLayer.removeChildren();
    this.villagerViews.clear();
    this.update(state, true);
  }

  drawTiles(state: MirrorState): void {
    const g = this.tiles;
    g.clear();
    for (let y = 0; y < state.height; y++) {
      for (let x = 0; x < state.width; x++) {
        const t = state.tiles[y * state.width + x];
        const p = projection.toScreen(x, y);
        g.rect(p.x, p.y, TILE, TILE).fill(TILE_COLORS[t.kind]);
        if (t.kind === "forest") {
          g.circle(p.x + TILE / 2, p.y + TILE / 2, 3 + Math.min(3, t.amount / 5)).fill(0x1f4d1c);
        } else if (t.kind === "rock") {
          g.rect(p.x + 4, p.y + 5, TILE - 8, TILE - 9).fill(0x9a9ea3);
        }
      }
    }
  }

  update(state: MirrorState, snap = false): void {
    this.updateStructures(state.structures);
    this.updateVillagers(state.villagers, snap);
  }

  private updateStructures(structures: Structure[]): void {
    const seen = new Set<string>();
    for (const s of structures) {
      seen.add(s.id);
      let view = this.structureViews.get(s.id);
      if (!view) {
        const root = new Container();
        const gfx = new Graphics();
        const label = new Text({ text: "", style: { fontSize: 8, fill: 0xffffff, fontFamily: "monospace" } });
        label.anchor.set(0.5, 1);
        root.addChild(gfx, label);
        this.structureLayer.addChild(root);
        view = { root, gfx, label, key: "" };
        this.structureViews.set(s.id, view);
      }
      const key = `${s.built}|${s.progress.toFixed(3)}|${s.growth?.toFixed(2) ?? "-"}|${s.name ?? ""}`;
      if (view.key === key) continue;
      view.key = key;
      this.drawStructure(view, s);
    }
    for (const [id, view] of this.structureViews) {
      if (!seen.has(id)) {
        view.root.destroy({ children: true });
        this.structureViews.delete(id);
      }
    }
  }

  private drawStructure(view: StructureView, s: Structure): void {
    const def = STRUCTURES[s.kind];
    const p = projection.toScreen(s.x, s.y);
    const w = s.w * TILE;
    const h = s.h * TILE;
    const g = view.gfx;
    g.clear();
    view.root.position.set(p.x, p.y);

    if (!s.built) {
      g.rect(1, 1, w - 2, h - 2).fill({ color: def.color, alpha: 0.25 }).stroke({ color: def.color, width: 1, alpha: 0.9 });
      g.rect(2, h - 5, (w - 4) * s.progress, 3).fill(0xe0a458);
    } else if (s.kind === "farm") {
      const growth = s.growth;
      const color = growth === undefined ? 0x6e4b2a : growth >= 1 ? 0xd4b24a : lerpColor(0x7a5c2e, 0x5aa83a, growth);
      g.rect(0, 0, w, h).fill(color);
      for (let i = 0; i < s.w * 2; i++) g.rect(i * (TILE / 2) + 2, 0, 1, h).fill({ color: 0x3f2d16, alpha: 0.5 });
    } else {
      g.rect(0, 0, w, h).fill(def.color).stroke({ color: 0x000000, width: 1, alpha: 0.35 });
      if (s.kind === "house") g.poly([0, 0, w / 2, -5, w, 0]).fill(0x8b3a2a);
      if (s.kind === "campfire") g.circle(w / 2, h / 2, 4).fill(0xffd166);
      if (s.kind === "shrine") g.circle(w / 2, h / 2, 3).fill(0xffffff);
      if (s.kind === "well") g.circle(w / 2, h / 2, 4).fill(0x1d3b5c);
    }
    view.label.text = s.name ?? def.label;
    view.label.position.set(w / 2, -2);
    view.label.visible = s.built && s.kind !== "farm";
  }

  private updateVillagers(villagers: VillagerView[], snap: boolean): void {
    const seen = new Set<string>();
    for (const v of villagers) {
      if (!v.alive) continue;
      seen.add(v.id);
      let look = this.villagerViews.get(v.id);
      if (!look) {
        look = this.createVillagerLook(v);
        this.villagerViews.set(v.id, look);
        this.villagerLayer.addChild(look.root);
        snap = true;
      }
      const p = projection.toScreen(v.pos.x, v.pos.y);
      look.target = p;
      if (snap) look.root.position.set(p.x, p.y);

      const key = `${v.stage}|${v.speech?.text ?? ""}|${v.goal?.type ?? ""}`;
      if (look.key !== key) {
        look.key = key;
        this.drawVillagerBody(look, v);
        if (v.speech) {
          look.bubbleText.text = v.speech.text;
          const bw = look.bubbleText.width + 8;
          const bh = look.bubbleText.height + 4;
          look.bubbleBg.clear().roundRect(-bw / 2, -bh, bw, bh, 3).fill({ color: 0xfaf6ee, alpha: 0.95 });
          look.bubbleText.position.set(-bw / 2 + 4, -bh + 2);
          look.bubble.visible = true;
        } else {
          look.bubble.visible = false;
        }
      }
    }
    for (const [id, look] of this.villagerViews) {
      if (!seen.has(id)) {
        look.root.destroy({ children: true });
        this.villagerViews.delete(id);
      }
    }
  }

  private createVillagerLook(v: VillagerView): VillagerLook {
    const root = new Container();
    const body = new Graphics();
    const name = new Text({ text: v.name, style: { fontSize: 8, fill: 0xffffff, fontFamily: "monospace" } });
    name.anchor.set(0.5, 1);
    name.position.set(0, -7);
    const bubble = new Container();
    const bubbleBg = new Graphics();
    const bubbleText = new Text({ text: "", style: { fontSize: 8, fill: 0x222222, fontFamily: "monospace", wordWrap: true, wordWrapWidth: 120 } });
    bubble.addChild(bubbleBg, bubbleText);
    bubble.position.set(0, -16);
    bubble.visible = false;
    root.addChild(body, name, bubble);
    root.eventMode = "static";
    root.cursor = "pointer";
    root.on("pointertap", () => {
      if (!this.shouldIgnoreClick()) this.onVillagerClick?.(v.id);
    });
    return { root, body, name, bubble, bubbleBg, bubbleText, target: { x: 0, y: 0 }, key: "" };
  }

  private drawVillagerBody(look: VillagerLook, v: VillagerView): void {
    const g = look.body;
    g.clear();
    const r = v.stage === "child" ? 3.5 : 5;
    const color = colorFromId(v.id);
    g.circle(0, 0, r).fill(color).stroke({ color: v.stage === "elder" ? 0xdddddd : 0x111111, width: 1 });
    if (v.goal?.type === "rest") g.circle(0, 0, r).fill({ color: 0x000000, alpha: 0.4 });
  }

  /** Called every frame: ease villagers toward their latest server position and depth-sort. */
  animate(dt: number): void {
    const k = Math.min(1, dt * 0.25);
    for (const look of this.villagerViews.values()) {
      look.root.x += (look.target.x - look.root.x) * k;
      look.root.y += (look.target.y - look.root.y) * k;
      look.root.zIndex = look.root.y;
    }
  }
}

function colorFromId(id: string): number {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) | 0;
  const hue = Math.abs(h) % 360;
  return hslToHex(hue, 0.6, 0.6);
}

function hslToHex(h: number, s: number, l: number): number {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  r = Math.round((r + m) * 255);
  g = Math.round((g + m) * 255);
  b = Math.round((b + m) * 255);
  return (r << 16) | (g << 8) | b;
}

function lerpColor(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  const r = Math.round(ar + (br - ar) * t), g = Math.round(ag + (bg - ag) * t), bl = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (g << 8) | bl;
}
