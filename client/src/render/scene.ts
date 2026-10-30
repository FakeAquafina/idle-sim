// Draws the world from the mirrored state. Four layers, back to front:
//   ground   one big Graphics of tile diamonds (redrawn only when tiles change)
//   hover    the highlighted tile or footprint under the pointer / selection
//   objects  trees, rocks, buildings, villagers, animals, depth-sorted every frame
//   labels   names and speech bubbles, never hidden behind a building

import { Container, Graphics, type Renderer, Sprite, Text } from "pixi.js";
import { STRUCTURES, type Animal, type Season, type Structure, type Tile, type VillagerView } from "@idle-sim/shared";
import type { MirrorState } from "../net.ts";
import { TILE_H, TILE_W, footprint, projection } from "./projection.ts";
import {
  PALETTES,
  bakeDecor,
  chimneyPoint,
  destroyDecor,
  drawAnimal,
  drawFlame,
  drawGroundTile,
  drawSmoke,
  drawStructure,
  drawVillager,
  footprintCenter,
  hash,
  lookFor,
  makeSprite,
  structureHeight,
  villagerHeight,
  type DecorSet,
  type Palette,
  type Shore,
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
  smoke: Graphics | null;
  label: Text;
  key: string;
  s: Structure;
}

/** Something that walks: three poses (standing, two steps) and a facing direction. */
interface Mover {
  root: Container;
  body: Container;
  frames: [Graphics, Graphics, Graphics];
  target: { x: number; y: number };
  key: string;
  facing: 1 | -1;
}

interface VillagerLook extends Mover {
  name: Text;
  bubble: Container;
  bubbleBg: Graphics;
  bubbleText: Text;
  height: number;
}

const LABEL_STYLE = { fontSize: 9, fill: 0xffffff, fontFamily: "ui-monospace, Menlo, monospace", stroke: { color: 0x101418, width: 2 } };
const WALK_FRAME_MS = 160;

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
  private season: Season = "summer";
  private pal: Palette = PALETTES.summer;
  private selection: Pick | null = null;
  private hovered: Pick | null = null;
  state: MirrorState | null = null;

  constructor(private renderer: Renderer) {
    this.textures = bakeDecor(renderer, this.pal);
    this.objects.sortableChildren = true;
    this.root.addChild(this.ground, this.hover, this.objects, this.labels);
  }

  // ---- Building the scene -----------------------------------------------------

  rebuildAll(state: MirrorState): void {
    this.state = state;
    this.clearDecor();
    for (const v of this.structureViews.values()) {
      v.root.destroy({ children: true });
      v.label.destroy();
    }
    this.structureViews.clear();
    for (const v of this.villagerViews.values()) {
      v.root.destroy({ children: true });
      v.bubble.destroy({ children: true });
      v.name.destroy();
    }
    this.villagerViews.clear();
    for (const v of this.animalViews.values()) v.root.destroy({ children: true });
    this.animalViews.clear();
    this.applySeason(state.clock.season);
    this.drawTiles(state);
    this.update(state, true);
  }

  private clearDecor(): void {
    for (const d of this.decor.values()) d.sprite.destroy();
    this.decor.clear();
  }

  /** Swap palettes and rebake the trees and rocks when the season turns. */
  private applySeason(season: Season): void {
    if (season === this.season && this.textures) return;
    this.season = season;
    this.pal = PALETTES[season];
    destroyDecor(this.textures);
    this.textures = bakeDecor(this.renderer, this.pal);
    this.clearDecor();
    for (const v of this.structureViews.values()) v.key = ""; // snow on the roofs
  }

  /** Redraw the ground and refresh trees/rocks. Cheap enough to call whenever tiles change. */
  drawTiles(state: MirrorState): void {
    this.state = state;
    const g = this.ground;
    g.clear();
    const W = state.width;
    const kindAt = (x: number, y: number): Tile["kind"] | null => (x < 0 || y < 0 || x >= W || y >= state.height ? null : state.tiles[y * W + x].kind);
    const land = (k: Tile["kind"] | null) => k !== null && k !== "water";
    for (let y = 0; y < state.height; y++) {
      for (let x = 0; x < W; x++) {
        const t = state.tiles[y * W + x];
        const p = projection.toScreen(x + 0.5, y + 0.5);
        let shore: Shore | undefined;
        if (t.kind === "water") shore = { n: land(kindAt(x, y - 1)), e: land(kindAt(x + 1, y)), s: land(kindAt(x, y + 1)), w: land(kindAt(x - 1, y)) };
        drawGroundTile(g, p.x, p.y, t, x, y, this.pal, shore);
        const nearWater = t.kind !== "water" && [kindAt(x, y - 1), kindAt(x + 1, y), kindAt(x, y + 1), kindAt(x - 1, y)].includes("water");
        this.syncDecor(x, y, t, W, nearWater);
      }
    }
  }

  private syncDecor(x: number, y: number, t: Tile, width: number, nearWater: boolean): void {
    const i = y * width + x;
    const key = decorKey(t, x, y, nearWater);
    const existing = this.decor.get(i);
    if (existing?.key === key) return;
    if (existing) {
      existing.sprite.destroy();
      this.decor.delete(i);
    }
    if (!key) return;
    const h = hash(x, y, 7);
    const big = t.amount >= 7;
    const tex =
      key.startsWith("forest") ? this.textures.trees[h % 2][big ? 1 : 0]
      : key.startsWith("rock") ? this.textures.rock[big ? 1 : 0]
      : key.startsWith("ore") ? this.textures.ore[big ? 1 : 0]
      : key === "reeds" ? this.textures.reeds
      : this.textures.bush;
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
    if (state.clock.season !== this.season) {
      this.applySeason(state.clock.season);
      this.drawTiles(state);
    }
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
        view = { root, gfx, flame: null, smoke: null, label, key: "", s };
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
    drawStructure(view.gfx, s, def, this.pal);
    const height = structureHeight(s.kind, s.built);
    // Tall things sort by their front corner, flat things sit just under whatever stands on them.
    view.root.zIndex = height > 0 ? projection.depth(s.x + s.w, s.y + s.h) - 0.5 : projection.depth(s.x, s.y) - 0.5;

    if (s.built && s.kind === "campfire" && !view.flame) {
      view.flame = new Graphics();
      view.root.addChild(view.flame);
    }
    if (s.built && chimneyPoint(s) && !view.smoke) {
      view.smoke = new Graphics();
      view.root.addChild(view.smoke);
    }
    view.label.text = s.name ?? def.label;
    view.label.position.set(p.x, p.y - height - 4);
    view.label.visible = s.built && s.kind !== "farm" && s.kind !== "pen";
  }

  // ---- Movers (villagers and animals) ------------------------------------------------

  private createMover(): Mover {
    const root = new Container();
    const body = new Container();
    const frames: [Graphics, Graphics, Graphics] = [new Graphics(), new Graphics(), new Graphics()];
    body.addChild(...frames);
    root.addChild(body);
    this.objects.addChild(root);
    return { root, body, frames, target: { x: 0, y: 0 }, key: "", facing: 1 };
  }

  private redrawMover(m: Mover, draw: (g: Graphics, step: 0 | 1 | 2) => void): void {
    m.frames.forEach((g, i) => {
      g.clear();
      draw(g, i as 0 | 1 | 2);
    });
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
      const carrying = Object.values(v.inventory).some((n) => (n ?? 0) > 0);
      const key = `${v.stage}|${v.speech?.text ?? ""}|${resting}|${carrying}`;
      if (look.key !== key) {
        look.key = key;
        look.height = villagerHeight(v.stage);
        const opts = lookFor(v.id, v.stage, resting, carrying);
        this.redrawMover(look, (g, step) => drawVillager(g, opts, step));
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
    const mover = this.createMover();
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
    return { ...mover, name, bubble, bubbleBg, bubbleText, height: villagerHeight(v.stage) };
  }

  // ---- Animals --------------------------------------------------------------------

  private updateAnimals(animals: Animal[], snap: boolean): void {
    const seen = new Set<string>();
    for (const a of animals) {
      if (!a.alive) continue;
      seen.add(a.id);
      let look = this.animalViews.get(a.id);
      if (!look) {
        look = this.createMover();
        this.animalViews.set(a.id, look);
        snap = true;
      }
      const p = projection.toScreen(a.pos.x, a.pos.y);
      look.target = p;
      if (snap) look.root.position.set(p.x, p.y);
      const key = `${a.kind}|${a.tame}`;
      if (look.key !== key) {
        look.key = key;
        this.redrawMover(look, (g, step) => drawAnimal(g, a.kind, a.tame, step));
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

  /** Ease movers toward their latest server position, animate, depth-sort, place labels. */
  animate(dt: number, nowMs: number): void {
    const k = Math.min(1, dt * 0.25);
    const walkStep = (Math.floor(nowMs / WALK_FRAME_MS) % 2) + 1;
    const stepMover = (m: Mover) => {
      const dx = m.target.x - m.root.x;
      const dy = m.target.y - m.root.y;
      const moving = Math.abs(dx) + Math.abs(dy) > 0.6;
      m.root.x += dx * k;
      m.root.y += dy * k;
      if (Math.abs(dx) > 0.4) m.facing = dx < 0 ? -1 : 1;
      m.body.scale.x = m.facing;
      const frame = moving ? walkStep : 0;
      for (let i = 0; i < 3; i++) m.frames[i].visible = i === frame;
      const w = projection.toWorld(m.root.x, m.root.y);
      m.root.zIndex = projection.depth(w.x, w.y);
    };
    for (const look of this.villagerViews.values()) {
      stepMover(look);
      look.name.position.set(Math.round(look.root.x), Math.round(look.root.y - look.height - 2));
      if (look.bubble.visible) look.bubble.position.set(Math.round(look.root.x), Math.round(look.root.y - look.height - 14));
    }
    for (const look of this.animalViews.values()) stepMover(look);

    const t = nowMs / 1000;
    const tod = this.state?.clock.timeOfDay ?? 0.5;
    const night = tod < 0.25 || tod > 0.8;
    const smokeStrength = night ? 1 : this.pal.snow ? 0.8 : 0.35;
    for (const view of this.structureViews.values()) {
      if (view.flame) {
        const m = footprintCenter(view.s.w, view.s.h);
        drawFlame(view.flame, m.x, m.y, t);
      }
      if (view.smoke) {
        const cp = chimneyPoint(view.s);
        const lived = view.s.kind !== "house" || view.s.ownerIds.length > 0;
        if (cp) drawSmoke(view.smoke, cp.x, cp.y, t + hash(view.s.x, view.s.y) % 7, lived ? smokeStrength : 0);
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
      else if (s.kind === "house") out.push({ x: base.x - 8, y: base.y - 6, color: 0xffd080, radius: 16, strength: s.ownerIds.length ? 0.6 : 0.15 });
      else if (s.kind === "shrine") out.push({ x: base.x, y: base.y - 10, color: 0xd0e0ff, radius: 20, strength: 0.5 });
      else if (s.kind === "workshop") out.push({ x: base.x + 6, y: base.y - 4, color: 0xffb060, radius: 14, strength: 0.5 });
      else if (s.kind === "dock") out.push({ x: base.x + 10, y: base.y - 12, color: 0xffd166, radius: 12, strength: 0.4 });
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

/** What standing thing a tile carries, if any. Trees and rocks follow the tile; bushes and reeds are decoration. */
function decorKey(t: Tile, x: number, y: number, nearWater: boolean): string {
  if ((t.kind === "forest" || t.kind === "rock" || t.kind === "ore") && t.amount > 0) return `${t.kind}|${t.amount >= 7 ? "big" : "small"}`;
  const h = hash(x, y, 3);
  if (nearWater && (t.kind === "grass" || t.kind === "sand") && h % 4 === 0) return "reeds";
  if (t.kind === "grass" && h % 17 === 0) return "bush";
  return "";
}

function samePick(a: Pick | null, b: Pick | null): boolean {
  if (!a || !b) return a === b;
  if (a.kind !== b.kind) return false;
  if (a.kind === "tile" && b.kind === "tile") return a.x === b.x && a.y === b.y;
  return (a as { id: string }).id === (b as { id: string }).id;
}
