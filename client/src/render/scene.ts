// Draws the world from the mirrored state. Four layers, back to front:
//   ground   one big Graphics of tile diamonds (redrawn only when tiles change)
//   hover    the highlighted tile or footprint under the pointer / selection
//   objects  trees, rocks, buildings, villagers, animals, depth-sorted every frame
//   labels   names and speech bubbles, never hidden behind a building

import { Container, Graphics, type Renderer, Sprite, Text } from "pixi.js";
import { STRUCTURES, type Animal, type Structure, type Tile, type VillagerView } from "@idle-sim/shared";
import type { MirrorState } from "../net.ts";
import { TILE_H, TILE_W, footprint, projection } from "./projection.ts";
import {
  bakeDecor,
  drawAnimal,
  drawFlame,
  drawGroundTile,
  drawStructure,
  drawVillager,
  footprintCenter,
  hash,
  lookFor,
  makeSprite,
  structureHeight,
  villagerHeight,
  type DecorSet,
} from "./sprites.ts";

export type Pick =
  | { kind: "villager"; id: string }
  | { kind: "structure"; id: string }
  | { kind: "animal"; id: string }
  | { kind: "tile"; x: number; y: number };

export interface Light {
  x: number;
  y: number;
  color: number;
  radius: number;
  strength: number;
}

interface Decor {
  sprite: Sprite;
  key: string;
}

interface StructureView {
  root: Container;
  gfx: Graphics;
  flame: Graphics | null;
  label: Text;
  key: string;
  s: Structure;
}

interface Mover {
  root: Container;
  gfx: Graphics;
  target: { x: number; y: number };
  key: string;
}

interface VillagerLook extends Mover {
  name: Text;
  bubble: Container;
  bubbleBg: Graphics;
  bubbleText: Text;
  height: number;
}

const LABEL_STYLE = { fontSize: 9, fill: 0xffffff, fontFamily: "ui-monospace, Menlo, monospace", stroke: { color: 0x101418, width: 2 } };

export class Scene {
  readonly root = new Container();
  private ground = new Graphics();
  private hover = new Graphics();
  private objects = new Container();
  private labels = new Container();
  private decor = new Map<number, Decor>();
  private structureViews = new Map<string, StructureView>();
  private villagerViews = new Map<string, VillagerLook>();
  private animalViews = new Map<string, Mover>();
  private textures: DecorSet;
  private selection: Pick | null = null;
  private hovered: Pick | null = null;
  state: MirrorState | null = null;

  constructor(renderer: Renderer) {
    this.textures = bakeDecor(renderer);
    this.objects.sortableChildren = true;
    this.root.addChild(this.ground, this.hover, this.objects, this.labels);
  }

  // ---- Building the scene -----------------------------------------------------

  rebuildAll(state: MirrorState): void {
    this.state = state;
    for (const d of this.decor.values()) d.sprite.destroy();
    this.decor.clear();
    for (const v of this.structureViews.values()) v.root.destroy({ children: true });
    this.structureViews.clear();
    for (const v of this.villagerViews.values()) {
      v.root.destroy({ children: true });
      v.bubble.destroy({ children: true });
      v.name.destroy();
    }
    this.villagerViews.clear();
    for (const v of this.animalViews.values()) v.root.destroy({ children: true });
    this.animalViews.clear();
    this.drawTiles(state);
    this.update(state, true);
  }

  /** Redraw the ground and refresh trees/rocks. Cheap enough to call whenever tiles change. */
  drawTiles(state: MirrorState): void {
    this.state = state;
    const g = this.ground;
    g.clear();
    for (let y = 0; y < state.height; y++) {
      for (let x = 0; x < state.width; x++) {
        const t = state.tiles[y * state.width + x];
        const p = projection.toScreen(x + 0.5, y + 0.5);
        drawGroundTile(g, p.x, p.y, t, x, y);
        this.syncDecor(x, y, t, state.width);
      }
    }
  }

  private syncDecor(x: number, y: number, t: Tile, width: number): void {
    const i = y * width + x;
    const key = decorKey(t);
    const existing = this.decor.get(i);
    if (existing?.key === key) return;
    if (existing) {
      existing.sprite.destroy();
      this.decor.delete(i);
    }
    if (!key) return;
    const h = hash(x, y, 7);
    const big = t.amount >= 7;
    const tex = t.kind === "forest" ? this.textures.trees[h % 2][big ? 1 : 0] : t.kind === "rock" ? this.textures.rock[big ? 1 : 0] : this.textures.ore[big ? 1 : 0];
    const sprite = makeSprite(tex);
    // Nudge within the tile so forests don't look like a grid.
    const jx = ((h >> 4) % 7) - 3;
    const jy = ((h >> 8) % 3) - 1;
    const p = projection.toScreen(x + 0.5, y + 0.5);
    sprite.position.set(p.x + jx, p.y + jy);
    sprite.zIndex = projection.depth(x + 0.5, y + 0.5);
    this.objects.addChild(sprite);
    this.decor.set(i, { sprite, key });
  }

  update(state: MirrorState, snap = false): void {
    this.state = state;
    this.updateStructures(state.structures);
    this.updateVillagers(state.villagers, snap);
    this.updateAnimals(state.animals ?? [], snap);
    this.drawHover();
  }

  // ---- Structures -----------------------------------------------------------------

  private updateStructures(structures: Structure[]): void {
    const seen = new Set<string>();
    for (const s of structures) {
      seen.add(s.id);
      let view = this.structureViews.get(s.id);
      if (!view) {
        const root = new Container();
        const gfx = new Graphics();
        const label = new Text({ text: "", style: LABEL_STYLE, resolution: 2 });
        label.anchor.set(0.5, 1);
        root.addChild(gfx);
        this.labels.addChild(label);
        this.objects.addChild(root);
        view = { root, gfx, flame: null, label, key: "", s };
        this.structureViews.set(s.id, view);
      }
      view.s = s;
      const key = `${s.built}|${s.progress.toFixed(2)}|${s.growth?.toFixed(2) ?? "-"}|${s.name ?? ""}|${s.depleted ?? false}`;
      if (view.key === key) continue;
      view.key = key;
      this.drawStructureView(view, s);
    }
    for (const [id, view] of this.structureViews) {
      if (!seen.has(id)) {
        view.root.destroy({ children: true });
        view.label.destroy();
        this.structureViews.delete(id);
      }
    }
  }

  private drawStructureView(view: StructureView, s: Structure): void {
    const def = STRUCTURES[s.kind];
    const p = projection.toScreen(s.x, s.y);
    view.root.position.set(p.x, p.y);
    view.gfx.clear();
    drawStructure(view.gfx, s, def);
    const height = structureHeight(s.kind, s.built);
    // Tall things sort by their front corner, flat things sit just under whatever stands on them.
    view.root.zIndex = height > 0 ? projection.depth(s.x + s.w, s.y + s.h) - 0.5 : projection.depth(s.x, s.y) - 0.5;

    if (s.built && s.kind === "campfire" && !view.flame) {
      view.flame = new Graphics();
      view.root.addChild(view.flame);
    }
    view.label.text = s.name ?? def.label;
    view.label.position.set(p.x, p.y - height - 4);
    view.label.visible = s.built && s.kind !== "farm" && s.kind !== "pen";
  }

  // ---- Villagers ------------------------------------------------------------------

  private updateVillagers(villagers: VillagerView[], snap: boolean): void {
    const seen = new Set<string>();
    for (const v of villagers) {
      if (!v.alive) continue;
      seen.add(v.id);
      let look = this.villagerViews.get(v.id);
      if (!look) {
        look = this.createVillagerLook(v);
        this.villagerViews.set(v.id, look);
        snap = true;
      }
      const p = projection.toScreen(v.pos.x, v.pos.y);
      look.target = p;
      if (snap) look.root.position.set(p.x, p.y);

      const resting = v.goal?.type === "rest";
      const key = `${v.stage}|${v.speech?.text ?? ""}|${resting}`;
      if (look.key !== key) {
        look.key = key;
        look.height = villagerHeight(v.stage);
        look.gfx.clear();
        drawVillager(look.gfx, lookFor(v.id, v.stage, resting));
        if (v.speech) {
          look.bubbleText.text = v.speech.text;
          const bw = Math.ceil(look.bubbleText.width) + 8;
          const bh = Math.ceil(look.bubbleText.height) + 4;
          look.bubbleBg.clear();
          look.bubbleBg.roundRect(-bw / 2, -bh, bw, bh, 3).fill({ color: 0xfaf6ee, alpha: 0.95 });
          look.bubbleBg.poly([-3, 0, 3, 0, 0, 3]).fill({ color: 0xfaf6ee, alpha: 0.95 });
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
        look.bubble.destroy({ children: true });
        look.name.destroy();
        this.villagerViews.delete(id);
      }
    }
  }

  private createVillagerLook(v: VillagerView): VillagerLook {
    const root = new Container();
    const gfx = new Graphics();
    root.addChild(gfx);
    this.objects.addChild(root);
    const name = new Text({ text: v.name, style: LABEL_STYLE, resolution: 2 });
    name.anchor.set(0.5, 1);
    const bubble = new Container();
    const bubbleBg = new Graphics();
    const bubbleText = new Text({
      text: "",
      style: { fontSize: 9, fill: 0x222222, fontFamily: "ui-monospace, Menlo, monospace", wordWrap: true, wordWrapWidth: 130 },
      resolution: 2,
    });
    bubble.addChild(bubbleBg, bubbleText);
    bubble.visible = false;
    this.labels.addChild(name, bubble);
    return { root, gfx, name, bubble, bubbleBg, bubbleText, target: { x: 0, y: 0 }, key: "", height: villagerHeight(v.stage) };
  }

  // ---- Animals --------------------------------------------------------------------

  private updateAnimals(animals: Animal[], snap: boolean): void {
    const seen = new Set<string>();
    for (const a of animals) {
      if (!a.alive) continue;
      seen.add(a.id);
      let look = this.animalViews.get(a.id);
      if (!look) {
        const root = new Container();
        const gfx = new Graphics();
        root.addChild(gfx);
        this.objects.addChild(root);
        look = { root, gfx, target: { x: 0, y: 0 }, key: "" };
        this.animalViews.set(a.id, look);
        snap = true;
      }
      const p = projection.toScreen(a.pos.x, a.pos.y);
      look.target = p;
      if (snap) look.root.position.set(p.x, p.y);
      const key = `${a.kind}|${a.tame}`;
      if (look.key !== key) {
        look.key = key;
        look.gfx.clear();
        drawAnimal(look.gfx, a.kind, a.tame);
      }
    }
    for (const [id, look] of this.animalViews) {
      if (!seen.has(id)) {
        look.root.destroy({ children: true });
        this.animalViews.delete(id);
      }
    }
  }

  // ---- Per-frame -------------------------------------------------------------------

  /** Ease movers toward their latest server position, depth-sort, flicker fires, place labels. */
  animate(dt: number, nowMs: number): void {
    const k = Math.min(1, dt * 0.25);
    for (const look of this.villagerViews.values()) {
      look.root.x += (look.target.x - look.root.x) * k;
      look.root.y += (look.target.y - look.root.y) * k;
      const w = projection.toWorld(look.root.x, look.root.y);
      look.root.zIndex = projection.depth(w.x, w.y);
      look.name.position.set(Math.round(look.root.x), Math.round(look.root.y - look.height - 2));
      if (look.bubble.visible) look.bubble.position.set(Math.round(look.root.x), Math.round(look.root.y - look.height - 14));
    }
    for (const look of this.animalViews.values()) {
      look.root.x += (look.target.x - look.root.x) * k;
      look.root.y += (look.target.y - look.root.y) * k;
      const w = projection.toWorld(look.root.x, look.root.y);
      look.root.zIndex = projection.depth(w.x, w.y);
    }
    const t = nowMs / 1000;
    for (const view of this.structureViews.values()) {
      if (view.flame) {
        const m = footprintCenter(view.s.w, view.s.h);
        drawFlame(view.flame, m.x, m.y, t);
      }
    }
  }

  /** Light sources for the night overlay, in this scene's local pixels. */
  lights(): Light[] {
    const out: Light[] = [];
    for (const view of this.structureViews.values()) {
      const s = view.s;
      if (!s.built) continue;
      const m = footprintCenter(s.w, s.h);
      const base = { x: view.root.x + m.x, y: view.root.y + m.y };
      if (s.kind === "campfire") out.push({ x: base.x, y: base.y - 4, color: 0xffa040, radius: 44, strength: 1 });
      else if (s.kind === "house") out.push({ x: base.x - 8, y: base.y - 6, color: 0xffd080, radius: 16, strength: 0.6 });
      else if (s.kind === "shrine") out.push({ x: base.x, y: base.y - 10, color: 0xd0e0ff, radius: 20, strength: 0.5 });
      else if (s.kind === "workshop") out.push({ x: base.x + 6, y: base.y - 4, color: 0xffb060, radius: 14, strength: 0.5 });
    }
    return out;
  }

  // ---- Picking and highlighting --------------------------------------------------------

  /** What is under a point given in this scene's local pixels. */
  pick(lx: number, ly: number): Pick | null {
    const s = this.state;
    if (!s) return null;
    for (const [id, look] of this.villagerViews) {
      const dx = lx - look.root.x;
      const dy = ly - look.root.y;
      if (Math.abs(dx) <= 6 && dy <= 3 && dy >= -look.height - 2) return { kind: "villager", id };
    }
    for (const [id, look] of this.animalViews) {
      const dx = lx - look.root.x;
      const dy = ly - look.root.y;
      if (Math.abs(dx) <= 6 && dy <= 2 && dy >= -12) return { kind: "animal", id };
    }
    for (const st of s.structures) {
      const h = structureHeight(st.kind, st.built);
      for (const dy of h > 0 ? [0, h] : [0]) {
        const w = projection.toWorld(lx, ly + dy);
        if (w.x >= st.x && w.x < st.x + st.w && w.y >= st.y && w.y < st.y + st.h) return { kind: "structure", id: st.id };
      }
    }
    const w = projection.toWorld(lx, ly);
    const tx = Math.floor(w.x);
    const ty = Math.floor(w.y);
    if (tx >= 0 && ty >= 0 && tx < s.width && ty < s.height) return { kind: "tile", x: tx, y: ty };
    return null;
  }

  setHover(p: Pick | null): void {
    if (samePick(this.hovered, p)) return;
    this.hovered = p;
    this.drawHover();
  }

  setSelection(p: Pick | null): void {
    this.selection = p;
    this.drawHover();
  }

  private drawHover(): void {
    const g = this.hover;
    g.clear();
    if (this.selection) this.outline(g, this.selection, 0xe0a458, 0.9);
    if (this.hovered && !samePick(this.hovered, this.selection)) this.outline(g, this.hovered, 0xffffff, 0.5);
  }

  private outline(g: Graphics, p: Pick, color: number, alpha: number): void {
    const s = this.state;
    if (!s) return;
    if (p.kind === "tile") {
      const f = footprint(p.x, p.y, 1, 1);
      g.poly([f.top.x, f.top.y, f.right.x, f.right.y, f.bottom.x, f.bottom.y, f.left.x, f.left.y]).fill({ color, alpha: alpha * 0.15 }).stroke({ color, alpha, width: 1 });
    } else if (p.kind === "structure") {
      const st = s.structures.find((x) => x.id === p.id);
      if (!st) return;
      const f = footprint(st.x, st.y, st.w, st.h);
      g.poly([f.top.x, f.top.y, f.right.x, f.right.y, f.bottom.x, f.bottom.y, f.left.x, f.left.y]).stroke({ color, alpha, width: 1 });
    } else {
      const look = p.kind === "villager" ? this.villagerViews.get(p.id) : this.animalViews.get(p.id);
      if (!look) return;
      g.ellipse(look.root.x, look.root.y, TILE_W / 4, TILE_H / 4).stroke({ color, alpha, width: 1 });
    }
  }

  /** Where a villager currently is on screen (scene-local), for the camera to follow. */
  villagerPosition(id: string): { x: number; y: number } | null {
    const look = this.villagerViews.get(id);
    return look ? { x: look.root.x, y: look.root.y } : null;
  }
}

function decorKey(t: Tile): string {
  if ((t.kind === "forest" || t.kind === "rock" || t.kind === "ore") && t.amount > 0) return `${t.kind}|${t.amount >= 7 ? "big" : "small"}`;
  return "";
}

function samePick(a: Pick | null, b: Pick | null): boolean {
  if (!a || !b) return a === b;
  if (a.kind !== b.kind) return false;
  if (a.kind === "tile" && b.kind === "tile") return a.x === b.x && a.y === b.y;
  return (a as { id: string }).id === (b as { id: string }).id;
}
