import { Application, Graphics } from "pixi.js";
import { Mirror, connect } from "./net.ts";
import { Camera } from "./render/camera.ts";
import { TILE } from "./render/projection.ts";
import { Scene } from "./render/scene.ts";
import { highlightSpeed, setupAdminBar, showAdminMessage, updateAdminSettings } from "./ui/admin.ts";
import { renderInbox, setupInbox } from "./ui/inbox.ts";
import { addEvent, resetFeed } from "./ui/feed.ts";
import { renderInspector, selectVillager } from "./ui/inspector.ts";
import { updateAi, updateStatus, updateTopbar, updateViewers } from "./ui/topbar.ts";

// Admin token comes from ?token=... once, then sticks in localStorage.
const params = new URLSearchParams(location.search);
const urlToken = params.get("token");
if (urlToken) {
  localStorage.setItem("adminToken", urlToken);
  history.replaceState(null, "", location.pathname);
}
const token = localStorage.getItem("adminToken");

const app = new Application();
await app.init({ resizeTo: window, background: 0x12161b, antialias: false, resolution: window.devicePixelRatio || 1, autoDensity: true });
document.getElementById("game")!.appendChild(app.canvas);

const mirror = new Mirror();
const scene = new Scene();
const overlay = new Graphics();
app.stage.addChild(scene.root, overlay);
const camera = new Camera(app, scene.root);
scene.setClickGuard(() => camera.dragDistance > 4);
scene.onVillagerClick = (id) => selectVillager(id, mirror.state);
document.getElementById("inspectorClose")!.onclick = () => selectVillager(null, null);

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
    updateAdminSettings(msg.settings.aiEnabled, msg.settings.budgetUsdPerHour);
    updateAi(msg.ai);
    renderInbox(s.petitions);
    if (firstSnapshot) {
      camera.fit(s.width * TILE, s.height * TILE);
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
    updateAdminSettings(msg.settings.aiEnabled, msg.settings.budgetUsdPerHour);
    updateAi(msg.ai);
    renderInbox(s.petitions);
  },
  onEvent: addEvent,
  onViewers: updateViewers,
  onAdminResult: showAdminMessage,
  onStatus: updateStatus,
});

app.ticker.add((ticker) => {
  scene.animate(ticker.deltaTime);
  drawOverlay();
});

/** Night darkening and weather tint over the whole screen. */
function drawOverlay() {
  overlay.clear();
  const s = mirror.state;
  if (!s) return;
  const t = s.clock.timeOfDay;
  // Darkness peaks at midnight (t=0), fades out by ~06:00 and in from ~20:00.
  const night = t < 0.25 ? 1 - t / 0.25 : t > 0.8 ? (t - 0.8) / 0.2 : 0;
  if (night > 0) overlay.rect(0, 0, app.screen.width, app.screen.height).fill({ color: 0x0a1030, alpha: 0.5 * night });
  const w = s.clock.weather;
  if (w === "rain") overlay.rect(0, 0, app.screen.width, app.screen.height).fill({ color: 0x3a4a66, alpha: 0.18 });
  if (w === "storm") overlay.rect(0, 0, app.screen.width, app.screen.height).fill({ color: 0x222a3a, alpha: 0.35 });
  if (w === "snow") overlay.rect(0, 0, app.screen.width, app.screen.height).fill({ color: 0xffffff, alpha: 0.14 });
}
