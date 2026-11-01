// Draws the world from the mirrored state, top-down. Layers, back to front:
//   surroundings  darker land beyond the map edge
//   ground        one big Graphics of 16×16 tiles (redrawn only when tiles change)
//   hover         the highlighted tile or footprint under the pointer / selection
//   objects       trees, rocks, buildings, villagers, animals, sorted by how far down the screen their feet are
//   labels        names and speech bubbles, never hidden behind a building

import { Container, Graphics, type Renderer, Sprite, Text } from "pixi.js";
import { STRUCTURES, TICKS_PER_SECOND, type Animal, type Merchant, type Season, type Structure, type Tile, type VillagerView } from "@idle-sim/shared";
import type { MirrorState } from "../net.ts";
import { TILE, projection } from "./projection.ts";
import {
  PALETTES,
  bakeDecor,
  chimneyPoint,
  destroyDecor,
  drawAnimal,
  drawFlame,
  drawGroundTile,
  drawSmoke,
  drawSurroundings,
  drawStructure,
  drawVillager,
  footprintCenter,
  hash,
  lookFor,
  makeSprite,
  structureRise,
  villagerHeight,
  type DecorSet,
  type Facing,
  type Palette,
  type Shore,
} from "./art.ts";

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

/** Something that walks: three poses (standing, two steps), a facing and a flip for walking left. */
interface Mover {
  root: Container;
  body: Container;
  frames: [Graphics, Graphics, Graphics];
  target: { x: number; y: number };
  key: string;
  facing: Facing;
  flip: 1 | -1;
  /** Redraws the three poses for the current facing. */
  redraw: () => void;
}

interface VillagerLook extends Mover {
  name: Text;
  bubble: Container;
  bubbleBg: Graphics;
  bubbleText: Text;
  bubbleW: number;
  bubbleH: number;
  speechUntil: number;
  bubbleShownAt: number;
  height: number;
}

const LABEL_STYLE = { fontSize: 9, fill: 0xffffff, fontFamily: "ui-monospace, Menlo, monospace", stroke: { color: 0x101418, width: 2 } };
const WALK_FRAME_MS = 160;
const BUBBLE_FADE_OUT_TICKS = 1.5 * TICKS_PER_SECOND;
const BUBBLE_FADE_IN_MS = 180;
/** Flat things (fields, pens, docks) sit under whoever walks on them. */
const FLAT_KINDS = new Set(["farm", "pen", "dock", "campfire"]);

export class Scene {
  readonly root = new Container();
  private surroundings = new Graphics();
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
    this.root.addChild(this.surroundings, this.ground, this.hover, this.objects, this.labels);
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
    this.surroundings.clear();
    drawSurroundings(this.surroundings, state.width, state.height, this.pal, state.coast);
    const g = this.ground;
    g.clear();
    const W = state.width;
    const kindAt = (x: number, y: number): Tile["kind"] | null => (x < 0 || y < 0 || x >= W || y >= state.height ? null : state.tiles[y * W + x].kind);
    const land = (k: Tile["kind"] | null) => k !== null && k !== "water";
    for (let y = 0; y < state.height; y++) {
      for (let x = 0; x < W; x++) {
        const t = state.tiles[y * W + x];
        const p = projection.toScreen(x, y);
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
    // Nudge within the tile so forests don't look like a grid; the foot stays near the tile's bottom.
    const jx = ((h >> 4) % 7) - 3;
    const jy = ((h >> 8) % 3) - 1;
    const p = projection.toScreen(x + 0.5, y + 0.85);
    sprite.position.set(Math.round(p.x + jx), Math.round(p.y + jy));
    sprite.zIndex = sprite.position.y;
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
    this.updateVillagers(state.merchant ? [...state.villagers, merchantView(state.merchant)] : state.villagers, snap);
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
      const key = `${s.built}|${s.progress.toFixed(2)}|${s.growth?.toFixed(2) ?? "-"}|${s.name ?? ""}|${s.depleted ?? false}|${s.hidden ?? false}|${deliveredKey(s)}`;
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
    const rise = structureRise(s.kind, s.built);
    // Standing things sort by their bottom edge; flat things sit just under whatever stands on them.
    view.root.zIndex = FLAT_KINDS.has(s.kind) || !s.built ? p.y - 0.5 : p.y + s.h * TILE - 0.5;
    if (s.built && s.kind === "campfire" && !view.flame) {
      view.flame = new Graphics();
      view.root.addChild(view.flame);
    }
    if (s.built && chimneyPoint(s) && !view.smoke) {
      view.smoke = new Graphics();
      view.root.addChild(view.smoke);
    }
    view.label.text = s.name ?? def.label;
    view.label.position.set(p.x + (s.w * TILE) / 2, p.y - rise - 3);
    view.label.visible = s.built && !s.hidden && s.kind !== "farm" && s.kind !== "pen";
    // The owner can see an undiscovered landmark, faintly; the villagers cannot.
    view.root.alpha = s.hidden ? 0.4 : 1;
  }

  // ---- Movers (villagers and animals) ------------------------------------------------

  private createMover(draw: (g: Graphics, step: 0 | 1 | 2, facing: Facing) => void): Mover {
    const root = new Container();
    const body = new Container();
    const frames: [Graphics, Graphics, Graphics] = [new Graphics(), new Graphics(), new Graphics()];
    body.addChild(...frames);
    root.addChild(body);
    this.objects.addChild(root);
    const m: Mover = { root, body, frames, target: { x: 0, y: 0 }, key: "", facing: "down", flip: 1, redraw: () => {} };
    m.redraw = () => {
      m.frames.forEach((g, i) => {
        g.clear();
        draw(g, i as 0 | 1 | 2, m.facing);
      });
    };
    return m;
  }

  private updateVillagers(villagers: VillagerView[], snap: boolean): void {
    const seen = new Set<string>();
    for (const v of villagers) {
      if (!v.alive || v.away) continue; // the dead and the travelling are not on the map
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
        const id = v.id;
        const stage = v.stage;
        const self = look;
        self.redraw = () => {
          self.frames.forEach((g, i) => {
            g.clear();
            drawVillager(g, lookFor(id, stage, resting, carrying, self.facing), i as 0 | 1 | 2);
          });
        };
        self.redraw();
        if (v.speech) {
          look.bubbleText.text = v.speech.text;
          const bw = Math.ceil(look.bubbleText.width) + 8;
          const bh = Math.ceil(look.bubbleText.height) + 4;
          look.bubbleBg.clear();
          look.bubbleBg.roundRect(-bw / 2, -bh, bw, bh, 3).fill({ color: 0xf4efe4, alpha: 0.78 });
          look.bubbleBg.poly([-3, 0, 3, 0, 0, 3]).fill({ color: 0xf4efe4, alpha: 0.78 });
          look.bubbleText.position.set(-bw / 2 + 4, -bh + 2);
          look.bubbleW = bw;
          look.bubbleH = bh;
          if (!look.bubble.visible || look.speechUntil !== v.speech.untilTick) look.bubbleShownAt = performance.now();
          look.speechUntil = v.speech.untilTick;
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
    const mover = this.createMover(() => {});
    const name = new Text({ text: v.name, style: LABEL_STYLE, resolution: 2 });
    name.anchor.set(0.5, 1);
    const bubble = new Container();
    const bubbleBg = new Graphics();
    const bubbleText = new Text({
      text: "",
      style: { fontSize: 8, fill: 0x2a2622, fontFamily: "ui-monospace, Menlo, monospace", wordWrap: true, wordWrapWidth: 104 },
      resolution: 2,
    });
    bubble.addChild(bubbleBg, bubbleText);
    bubble.visible = false;
    this.labels.addChild(name, bubble);
    return { ...mover, name, bubble, bubbleBg, bubbleText, bubbleW: 0, bubbleH: 0, speechUntil: 0, bubbleShownAt: 0, height: villagerHeight(v.stage) };
  }

  // ---- Animals --------------------------------------------------------------------

  private updateAnimals(animals: Animal[], snap: boolean): void {
    const seen = new Set<string>();
    for (const a of animals) {
      if (!a.alive) continue;
      seen.add(a.id);
      let look = this.animalViews.get(a.id);
      if (!look) {
        look = this.createMover((g, step) => drawAnimal(g, a.kind, a.tame, step));
        this.animalViews.set(a.id, look);
        snap = true;
      }
      const p = projection.toScreen(a.pos.x, a.pos.y);
      look.target = p;
      if (snap) look.root.position.set(p.x, p.y);
      const key = `${a.kind}|${a.tame}`;
      if (look.key !== key) {
        look.key = key;
        const kind = a.kind;
        const tame = a.tame;
        const self = look;
        self.redraw = () => self.frames.forEach((g, i) => (g.clear(), drawAnimal(g, kind, tame, i as 0 | 1 | 2)));
        self.redraw();
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
    const stepMover = (m: Mover, turns: boolean) => {
      const dx = m.target.x - m.root.x;
      const dy = m.target.y - m.root.y;
      const moving = Math.abs(dx) + Math.abs(dy) > 0.6;
      m.root.x += dx * k;
      m.root.y += dy * k;
      if (moving) {
        // Face the way we are going: sideways when the sideways part is larger, else up or down the screen.
        const facing: Facing = !turns ? "side" : Math.abs(dx) > Math.abs(dy) * 1.2 ? "side" : dy < 0 ? "up" : "down";
        const flip: 1 | -1 = facing === "side" ? (dx < 0 ? -1 : 1) : m.flip;
        if (facing !== m.facing) {
          m.facing = facing;
          m.redraw();
        }
        m.flip = flip;
      }
      m.body.scale.x = m.flip;
      const frame = moving ? walkStep : 0;
      for (let i = 0; i < 3; i++) m.frames[i].visible = i === frame;
      m.root.zIndex = m.root.y;
    };
    for (const look of this.villagerViews.values()) {
      stepMover(look, true);
      look.name.position.set(Math.round(look.root.x), Math.round(look.root.y - look.height - 2));
      if (look.bubble.visible) look.bubble.position.set(Math.round(look.root.x), Math.round(look.root.y - look.height - 14));
    }
    this.layoutBubbles(nowMs);
    for (const look of this.animalViews.values()) stepMover(look, false);

    const t = nowMs / 1000;
    const tod = this.state?.clock.timeOfDay ?? 0.5;
    const night = tod < 0.25 || tod > 0.8;
    const smokeStrength = night ? 1 : this.pal.snow ? 0.8 : 0.35;
    for (const view of this.structureViews.values()) {
      if (view.flame) {
        const m = footprintCenter(view.s.w, view.s.h);
        drawFlame(view.flame, m.x, m.y - 1, t);
      }
      if (view.smoke) {
        const cp = chimneyPoint(view.s);
        const lived = view.s.kind !== "house" || view.s.ownerIds.length > 0;
        if (cp) drawSmoke(view.smoke, cp.x, cp.y, t + hash(view.s.x, view.s.y) % 7, lived ? smokeStrength : 0);
      }
    }
  }

  /**
   * Keep speech bubbles readable when several people talk at once: the
   * frontmost speaker keeps theirs by their head and anyone whose bubble would
   * cover it is lifted above. Bubbles also fade in, and out as the line ends.
   */
  private layoutBubbles(nowMs: number): void {
    const tick = this.state?.clock.tick ?? 0;
    const placed: { l: number; r: number; t: number; b: number }[] = [];
    const visible = [...this.villagerViews.values()].filter((v) => v.bubble.visible).sort((a, b) => b.root.y - a.root.y);
    for (const look of visible) {
      const fadeIn = Math.min(1, (nowMs - look.bubbleShownAt) / BUBBLE_FADE_IN_MS);
      const fadeOut = Math.max(0, Math.min(1, (look.speechUntil - tick) / BUBBLE_FADE_OUT_TICKS));
      look.bubble.alpha = Math.min(fadeIn, fadeOut);
      let y = look.bubble.y;
      const box = { l: look.bubble.x - look.bubbleW / 2, r: look.bubble.x + look.bubbleW / 2, t: y - look.bubbleH, b: y };
      for (let pass = 0; pass < placed.length; pass++) {
        const hit = placed.find((p) => box.l < p.r && box.r > p.l && box.t < p.b && box.b > p.t);
        if (!hit) break;
        const lift = box.b - hit.t + 2;
        y -= lift;
        box.t -= lift;
        box.b -= lift;
      }
      look.bubble.y = y;
      placed.push(box);
    }
  }

  /** Light sources for the night overlay, in this scene's local pixels. */
  lights(): Light[] {
    const out: Light[] = [];
    for (const view of this.structureViews.values()) {
      const s = view.s;
      if (!s.built || s.hidden) continue;
      const m = footprintCenter(s.w, s.h);
      const base = { x: view.root.x + m.x, y: view.root.y + m.y };
      const front = { x: base.x, y: view.root.y + s.h * TILE - 6 };
      if (s.kind === "campfire") out.push({ x: base.x, y: base.y - 2, color: 0xffa040, radius: 44, strength: 1 });
      else if (s.kind === "house") out.push({ x: front.x, y: front.y, color: 0xffd080, radius: 18, strength: s.ownerIds.length ? 0.6 : 0.15 });
      else if (s.kind === "shrine") out.push({ x: base.x, y: base.y, color: 0xd0e0ff, radius: 20, strength: 0.5 });
      else if (s.kind === "workshop") out.push({ x: front.x, y: front.y, color: 0xffb060, radius: 14, strength: 0.5 });
      else if (s.kind === "dock") out.push({ x: view.root.x + s.w * TILE - 4, y: view.root.y - 6, color: 0xffd166, radius: 12, strength: 0.4 });
      else if (s.kind === "market") out.push({ x: base.x, y: base.y, color: 0xffd166, radius: 10, strength: 0.3 });
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
      if (Math.abs(dx) <= 7 && dy <= 2 && dy >= -14) return { kind: "animal", id };
    }
    for (const st of s.structures) {
      const p = projection.toScreen(st.x, st.y);
      const rise = structureRise(st.kind, st.built);
      if (lx >= p.x && lx < p.x + st.w * TILE && ly >= p.y - rise && ly < p.y + st.h * TILE) return { kind: "structure", id: st.id };
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
      const q = projection.toScreen(p.x, p.y);
      g.rect(q.x, q.y, TILE, TILE).fill({ color, alpha: alpha * 0.15 }).stroke({ color, alpha, width: 1 });
    } else if (p.kind === "structure") {
      const st = s.structures.find((x) => x.id === p.id);
      if (!st) return;
      const q = projection.toScreen(st.x, st.y);
      g.rect(q.x, q.y, st.w * TILE, st.h * TILE).stroke({ color, alpha, width: 1 });
    } else {
      const look = p.kind === "villager" ? this.villagerViews.get(p.id) : this.animalViews.get(p.id);
      if (!look) return;
      g.ellipse(look.root.x, look.root.y, 6, 3).stroke({ color, alpha, width: 1 });
    }
  }

  /** Where a villager currently is on screen (scene-local), for the camera to follow. */
  villagerPosition(id: string): { x: number; y: number } | null {
    const look = this.villagerViews.get(id);
    return look ? { x: look.root.x, y: look.root.y } : null;
  }
}

/** The merchant is drawn with the villager code: an adult with a pack on his back. */
function merchantView(m: Merchant): VillagerView {
  return {
    id: "merchant",
    name: "merchant",
    traits: [],
    quirk: "",
    skill: "merchant",
    ageDays: 0,
    stage: "adult",
    alive: true,
    needs: { hunger: 100, energy: 100, social: 100, warmth: 100 },
    inventory: { seeds: 1 },
    stock: {},
    coins: m.coins,
    pos: m.pos,
    goal: null,
    goalStartedTick: 0,
    cooldowns: {},
    memory: [],
    relationships: {},
    source: "autopilot",
  };
}

/** Part of the redraw key for a blueprint: how much has been brought to it. */
function deliveredKey(s: Structure): string {
  return s.delivered ? Object.values(s.delivered).reduce((a, b) => a + (b ?? 0), 0).toString() : "";
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
