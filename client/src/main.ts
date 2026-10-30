import { Application } from "pixi.js";
import { STRUCTURES, type Vec2 } from "@idle-sim/shared";
import { Mirror, type MirrorState, connect } from "./net.ts";
import { Atmosphere } from "./render/atmosphere.ts";
import { Camera } from "./render/camera.ts";
import { projection } from "./render/projection.ts";
import { type Pick, Scene } from "./render/scene.ts";
import { highlightSpeed, setupAdminBar, showAdminMessage, updateAdminSettings } from "./ui/admin.ts";
import { addChronicleEntry, resetChronicle, setupChronicle } from "./ui/chronicle.ts";
import { addEvent, resetFeed, setupFeed } from "./ui/feed.ts";
import { renderInbox, setupInbox } from "./ui/inbox.ts";
import { describeGoal, esc, farmWord, onSelectionChange, renderInspector, select } from "./ui/inspector.ts";
import { hideTooltip, showTooltip } from "./ui/tooltip.ts";
import { updateAi, updateStatus, updateTopbar, updateViewers } from "./ui/topbar.ts";

// Admin token comes from ?token=... once, then sticks in localStorage. The
// server only honours it from its own machine, so the viewer bothers with it
// only when opened on localhost (directly, or through an SSH tunnel).
const LOCAL = ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);
const params = new URLSearchParams(location.search);
const urlToken = params.get("token");
if (urlToken !== null) history.replaceState(null, "", location.pathname);
if (urlToken && LOCAL) localStorage.setItem("adminToken", urlToken);
const token = LOCAL ? localStorage.getItem("adminToken") : null;

const app = new Application();
await app.init({ resizeTo: window, background: 0x12161b, antialias: false, resolution: window.devicePixelRatio || 1, autoDensity: true });
document.getElementById("game")!.appendChild(app.canvas);

const mirror = new Mirror();
const scene = new Scene(app.renderer);
const atmosphere = new Atmosphere();
app.stage.addChild(scene.root, atmosphere.gfx);
const camera = new Camera(app, scene.root);
setupChronicle();
setupFeed(jumpTo);
onSelectionChange((sel) => scene.setSelection(sel));
document.getElementById("inspectorClose")!.onclick = () => select(null, null);
document.getElementById("homeBtn")!.onclick = () => centerOnVillage();

// ---- Pointer: hover shows a tooltip, a tap selects ------------------------------------
app.stage.on("pointermove", (e) => {
  if (e.pointerType !== "mouse" || camera.dragDistance > 4) {
    hideTooltip();
    return;
  }
  const local = scene.root.toLocal(e.global);
  const p = scene.pick(local.x, local.y);
  scene.setHover(p);
  const text = p && mirror.state ? describePick(p, mirror.state) : null;
  if (text) showTooltip(text, e.client.x, e.client.y);
  else hideTooltip();
});
app.canvas.addEventListener("pointerleave", () => {
  hideTooltip();
  scene.setHover(null);
});
app.stage.on("pointertap", (e) => {
  const local = scene.root.toLocal(e.global);
  const p = scene.pick(local.x, local.y);
  if (camera.dragDistance > 4) return;
  if (p?.kind === "villager" || p?.kind === "structure") select(p, mirror.state);
  else select(null, null);
});

// ---- Network -------------------------------------------------------------------------
let firstSnapshot = true;
const conn = connect(token, {
  onSnapshot(msg) {
    mirror.applySnapshot(msg);
    const s = mirror.state!;
    scene.rebuildAll(s);
    resetFeed(s.events);
    updateTopbar(s);
    updateViewers(msg.viewers);
    setupAdminBar(msg.isAdmin, (cmd) => conn.sendAdmin(cmd));
    setupInbox(msg.isAdmin, (cmd) => conn.sendAdmin(cmd));
    highlightSpeed(s.speed, s.paused);
    updateAdminSettings(msg.settings, msg.server);
    updateAi(msg.ai);
    renderInbox(s.petitions);
    resetChronicle(s.chronicle ?? []);
    if (firstSnapshot) {
      centerOnVillage();
      firstSnapshot = false;
    }
  },
  onDelta(msg) {
    const tilesChanged = mirror.applyDelta(msg);
    const s = mirror.state!;
    if (tilesChanged) scene.drawTiles(s);
    scene.update(s);
    updateTopbar(s);
    renderInspector(s);
    highlightSpeed(s.speed, s.paused);
    updateAdminSettings(msg.settings);
    updateAi(msg.ai);
    renderInbox(s.petitions);
  },
  onEvent: addEvent,
  onChronicle: addChronicleEntry,
  onViewers: updateViewers,
  onAdminResult: showAdminMessage,
  onStatus: updateStatus,
});

app.ticker.add((ticker) => {
  const now = performance.now();
  scene.animate(ticker.deltaTime, now);
  atmosphere.update(now, mirror.state, app.screen.width, app.screen.height, scene.lights(), (x, y) => scene.root.toGlobal({ x, y }), camera.scale);
});

// ---- Camera helpers ---------------------------------------------------------------------
/** Look at the storehouse (the village grows around it), zoomed in enough to see faces. */
function centerOnVillage(): void {
  const s = mirror.state;
  if (!s) return;
  const store = s.structures.find((x) => x.kind === "storehouse");
  const c = store ? projection.toScreen(store.x + store.w / 2, store.y + store.h / 2) : projection.toScreen(s.width / 2, s.height / 2);
  camera.centerOn(c.x, c.y, window.innerWidth > 900 ? 1.6 : 1.1);
}

let jumpTimer: ReturnType<typeof setTimeout> | null = null;
function jumpTo(target: { pos?: Vec2; villagerId?: string }): void {
  const s = mirror.state;
  if (!s) return;
  let p: { x: number; y: number } | null = null;
  let pick: Pick | null = null;
  if (target.villagerId) {
    p = scene.villagerPosition(target.villagerId);
    if (p) pick = { kind: "villager", id: target.villagerId };
  }
  if (!p && target.pos) {
    p = projection.toScreen(target.pos.x + 0.5, target.pos.y + 0.5);
    pick = { kind: "tile", x: target.pos.x, y: target.pos.y };
  }
  if (!p) return;
  camera.centerOn(p.x, p.y, Math.max(camera.scale, 1.6));
  scene.setHover(pick);
  if (jumpTimer) clearTimeout(jumpTimer);
  jumpTimer = setTimeout(() => scene.setHover(null), 1800);
}

// ---- Tooltip text -------------------------------------------------------------------------
function describePick(p: Pick, s: MirrorState): string | null {
  switch (p.kind) {
    case "villager": {
      const v = s.villagers.find((x) => x.id === p.id);
      if (!v) return null;
      return `<b>${esc(v.name)}</b> <span class="muted">${v.stage}, ${esc(v.skill)}</span><br>${esc(describeGoal(v))}${v.speech ? `<br><i>“${esc(v.speech.text)}”</i>` : ""}`;
    }
    case "animal": {
      const a = (s.animals ?? []).find((x) => x.id === p.id);
      if (!a) return null;
      return a.kind === "deer" ? "a wild deer" : a.tame ? "a village goat" : "a wild goat";
    }
    case "structure": {
      const st = s.structures.find((x) => x.id === p.id);
      if (!st) return null;
      const def = STRUCTURES[st.kind];
      const title = `<b>${esc(st.name ?? def.label)}</b>${st.name ? ` <span class="muted">${def.label.toLowerCase()}</span>` : ""}`;
      if (!st.built) return `${title}<br>${Math.round(st.progress * 100)}% built`;
      if (st.kind === "house") {
        const who = st.ownerIds.map((id) => s.villagers.find((v) => v.id === id)?.name).filter(Boolean);
        return `${title}<br>${who.length ? `home of ${who.map((n) => esc(n!)).join(" and ")}` : "empty"}`;
      }
      if (st.kind === "farm") return `${title}<br>${farmWord(st.growth)}`;
      if (st.kind === "mine" && st.reserve) return `${title}<br>${st.depleted ? "worked out" : `${st.reserve.stone} stone, ${st.reserve.ore} ore left`}`;
      if (st.kind === "pen") return `${title}<br>${(s.animals ?? []).filter((a) => a.alive && a.penId === st.id).length} goats`;
      return title;
    }
    case "tile": {
      const t = s.tiles[p.y * s.width + p.x];
      if (!t) return null;
      switch (t.kind) {
        case "forest": return `forest <span class="muted">· ${t.amount} wood</span>`;
        case "rock": return `rock <span class="muted">· ${t.amount} stone</span>`;
        case "ore": return `ore vein <span class="muted">· ${t.amount} ore</span>`;
        case "water": return s.coast ? "the sea" : "water";
        default: return t.kind;
      }
    }
  }
}
