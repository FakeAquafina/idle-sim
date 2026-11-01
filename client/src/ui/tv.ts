// TV mode (?tv=1): the viewer as an ambient picture for a living-room screen.
// Panels are hidden, a caption strip along the bottom tells the story, and the
// camera drifts on its own: it follows a villager or a building for a while,
// and cuts (slowly) to wherever something just happened. Press T to toggle it,
// Escape to leave it. A screen wake lock keeps the TV from dozing off.

import { TICKS_PER_SECOND, type WorldEvent } from "@idle-sim/shared";
import type { MirrorState } from "../net.ts";
import type { Camera } from "../render/camera.ts";
import { projection } from "../render/projection.ts";
import type { Scene } from "../render/scene.ts";
import { esc } from "./inspector.ts";

/** Events the camera cuts to and holds on for a long moment. */
const BIG_MOMENTS = new Set(["birth", "death", "funeral", "arrival", "partners", "petition", "built", "founded", "blessing", "gift", "expecting", "naming", "discovery", "journey", "journey_lost", "merchant"]);
/** Events that only earn a caption, never a camera move. */
const CAPTION_ONLY = new Set(["day", "season", "news"]);
const LINGER_BIG_MS = 26_000;
const LINGER_SMALL_MS = 12_000;
/** How long the camera stays with one subject before wandering off. */
const ROAM_MS = 32_000;
/** Touching the screen pauses the director this long so a viewer can look around. */
const HOLD_MS = 20_000;

interface Subject {
  villagerId?: string;
  px?: number;
  py?: number;
  scale: number;
}

export interface TvDeps {
  camera: Camera;
  scene: Scene;
  state(): MirrorState | null;
}

export class TvDirector {
  enabled = false;
  private subject: Subject | null = null;
  private subjectUntil = 0;
  private focusBig = false;
  private caption = "";
  private captionKind = "";
  private captionUntil = 0;
  private holdUntil = 0;
  private lock: WakeLockSentinel | null = null;
  private cursorTimer: ReturnType<typeof setTimeout> | null = null;
  private strip = document.getElementById("tv")!;
  private captionEl = document.getElementById("tvCaption")!;
  private speechEl = document.getElementById("tvSpeech")!;
  private metaEl = document.getElementById("tvMeta")!;

  constructor(private deps: TvDeps) {
    document.addEventListener("visibilitychange", () => {
      if (this.enabled && document.visibilityState === "visible") void this.keepAwake();
    });
    // Show the mouse pointer briefly when it moves, then hide it again.
    window.addEventListener("mousemove", () => {
      if (!this.enabled) return;
      document.body.classList.add("tv-cursor");
      if (this.cursorTimer) clearTimeout(this.cursorTimer);
      this.cursorTimer = setTimeout(() => document.body.classList.remove("tv-cursor"), 2000);
    });
    window.addEventListener("pointerdown", () => {
      if (this.enabled) this.holdUntil = performance.now() + HOLD_MS;
    });
  }

  setEnabled(on: boolean): void {
    if (on === this.enabled) return;
    this.enabled = on;
    document.body.classList.toggle("tv", on);
    this.strip.classList.toggle("hidden", !on);
    const url = new URL(location.href);
    if (on) url.searchParams.set("tv", "1");
    else url.searchParams.delete("tv");
    history.replaceState(null, "", url);
    if (on) {
      this.subject = null;
      this.subjectUntil = 0;
      this.holdUntil = 0;
      void this.keepAwake();
    } else {
      this.lock?.release().catch(() => undefined);
      this.lock = null;
      document.body.classList.remove("tv-cursor");
    }
  }

  toggle(): void {
    this.setEnabled(!this.enabled);
  }

  /** Something happened: caption it, and swing the camera there if it has a place. */
  onEvent(e: WorldEvent): void {
    if (!this.enabled) return;
    const now = performance.now();
    const big = BIG_MOMENTS.has(e.kind);
    const linger = big ? LINGER_BIG_MS : LINGER_SMALL_MS;
    // A small moment never interrupts a big one that is still playing out.
    if (this.focusBig && !big && now < this.subjectUntil - 5000) return;
    this.caption = e.text;
    this.captionKind = e.kind;
    this.captionUntil = now + linger;
    if (CAPTION_ONLY.has(e.kind)) return;
    const villagerId = e.villagerIds?.[0];
    const at = e.pos ? projection.toScreen(e.pos.x + 0.5, e.pos.y + 0.5) : null;
    if (!villagerId && !at) return;
    this.subject = { villagerId, px: at?.x, py: at?.y, scale: this.closeScale() };
    this.subjectUntil = now + linger;
    this.focusBig = big;
  }

  /** Called every frame: steer the camera and refresh the strip. */
  update(nowMs: number, state: MirrorState | null): void {
    if (!this.enabled || !state) return;
    this.renderStrip(nowMs, state);
    if (nowMs < this.holdUntil) return;
    if (!this.subject || nowMs > this.subjectUntil) this.pickSubject(nowMs, state);
    const s = this.subject;
    if (!s) return;
    const p = s.villagerId ? this.deps.scene.villagerPosition(s.villagerId) : null;
    const px = p?.x ?? s.px;
    const py = p?.y ?? s.py;
    if (px === undefined || py === undefined) {
      this.subject = null; // whoever we were following is gone
      return;
    }
    this.deps.camera.glideTo(px, py, s.scale);
  }

  /** Nothing special is happening: follow someone for a while, or admire a building. */
  private pickSubject(nowMs: number, state: MirrorState): void {
    this.focusBig = false;
    this.subjectUntil = nowMs + ROAM_MS;
    const alive = state.villagers.filter((v) => v.alive);
    const talking = alive.filter((v) => v.speech);
    const built = state.structures.filter((st) => st.built && st.kind !== "farm");
    const roll = Math.random();
    if (talking.length && roll < 0.5) {
      this.subject = { villagerId: pick(talking).id, scale: this.closeScale() };
    } else if (alive.length && (roll < 0.8 || !built.length)) {
      this.subject = { villagerId: pick(alive).id, scale: this.closeScale() };
    } else if (built.length) {
      const st = pick(built);
      const c = projection.toScreen(st.x + st.w / 2, st.y + st.h / 2);
      this.subject = { px: c.x, py: c.y - 8, scale: this.wideScale() };
    } else {
      this.subject = null;
    }
  }

  private renderStrip(nowMs: number, state: MirrorState): void {
    const c = state.clock;
    const hour = Math.floor(c.timeOfDay * 24);
    const minute = Math.floor((c.timeOfDay * 24 - hour) * 60);
    const weather = { clear: "☀ clear", rain: "🌧 rain", storm: "⛈ storm", snow: "❄ snow" }[c.weather];
    const alive = state.villagers.filter((v) => v.alive);
    const meta = `Day ${c.dayOfSeason + 1} of ${c.season}, year ${c.year + 1} · ${weather} · ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}${c.isNight ? " 🌙" : ""} · ${alive.length} villagers${state.paused ? " · paused" : ""}`;
    setText(this.metaEl, meta);

    const captionLive = nowMs < this.captionUntil;
    setText(this.captionEl, captionLive ? this.caption : "");
    this.captionEl.className = captionLive ? `k-${this.captionKind}` : "";

    // Whoever the camera is with gets subtitles while they speak.
    const followed = this.subject?.villagerId ? alive.find((v) => v.id === this.subject!.villagerId) : undefined;
    const sp = followed?.speech;
    const fresh = sp && sp.untilTick - c.tick > 0.5 * TICKS_PER_SECOND;
    const html = followed && sp && fresh ? `<b>${esc(followed.name)}</b> “${esc(sp.text)}”` : "";
    if (this.speechEl.innerHTML !== html) this.speechEl.innerHTML = html;
  }

  /** Zoom for watching people: whole numbers keep the pixel art crisp; tighter on a big screen. */
  private closeScale(): number {
    return window.innerWidth >= 2500 ? 4 : window.innerWidth >= 1500 ? 3 : 2;
  }

  private wideScale(): number {
    return this.closeScale() - 1;
  }

  private async keepAwake(): Promise<void> {
    if (!("wakeLock" in navigator)) return;
    try {
      this.lock = await navigator.wakeLock.request("screen");
    } catch {
      // Not allowed (page not visible, battery saver): the TV's own sleep timer applies.
    }
  }
}

function pick<T>(list: T[]): T {
  return list[Math.floor(Math.random() * list.length)];
}


function setText(el: HTMLElement, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}
