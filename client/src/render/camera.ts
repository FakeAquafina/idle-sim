// Drag (or one-finger swipe) to pan, wheel or pinch to zoom. Tracks the last
// drag distance so a tap at the end of a pan is not treated as a click.

import type { Application, Container, FederatedPointerEvent } from "pixi.js";

const MIN_SCALE = 0.4;
const MAX_SCALE = 5;

export class Camera {
  private pointers = new Map<number, { x: number; y: number }>();
  private pinchDist = 0;
  dragDistance = 0;

  constructor(
    private app: Application,
    private target: Container,
  ) {
    const stage = app.stage;
    stage.eventMode = "static";
    stage.hitArea = app.screen;
    stage.on("pointerdown", (e: FederatedPointerEvent) => {
      this.pointers.set(e.pointerId, { x: e.global.x, y: e.global.y });
      if (this.pointers.size === 1) this.dragDistance = 0;
      if (this.pointers.size === 2) this.pinchDist = this.pinchDistance();
    });
    stage.on("pointermove", (e: FederatedPointerEvent) => {
      const prev = this.pointers.get(e.pointerId);
      if (!prev) return;
      const cur = { x: e.global.x, y: e.global.y };
      if (this.pointers.size === 1) {
        const dx = cur.x - prev.x;
        const dy = cur.y - prev.y;
        this.dragDistance += Math.abs(dx) + Math.abs(dy);
        this.target.x += dx;
        this.target.y += dy;
      }
      this.pointers.set(e.pointerId, cur);
      if (this.pointers.size === 2) {
        const d = this.pinchDistance();
        const [a, b] = [...this.pointers.values()];
        if (this.pinchDist > 0 && d > 0) this.zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, d / this.pinchDist);
        this.pinchDist = d;
        this.dragDistance = 1000; // a pinch is never a click
      }
    });
    const lift = (e: FederatedPointerEvent) => {
      this.pointers.delete(e.pointerId);
      this.pinchDist = 0;
    };
    stage.on("pointerup", lift);
    stage.on("pointerupoutside", lift);
    stage.on("pointercancel", lift);

    app.canvas.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
        this.zoomAt(e.offsetX, e.offsetY, factor);
      },
      { passive: false },
    );
  }

  private pinchDistance(): number {
    const [a, b] = [...this.pointers.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  }

  get scale(): number {
    return this.target.scale.x;
  }

  zoomAt(sx: number, sy: number, factor: number): void {
    const t = this.target;
    const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, t.scale.x * factor));
    const ratio = newScale / t.scale.x;
    t.x = sx - (sx - t.x) * ratio;
    t.y = sy - (sy - t.y) * ratio;
    t.scale.set(newScale);
  }

  /** Center the view on a point given in the target's local pixels. */
  centerOn(px: number, py: number, scale?: number): void {
    const t = this.target;
    if (scale !== undefined) t.scale.set(Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale)));
    t.x = this.app.screen.width / 2 - px * t.scale.x;
    t.y = this.app.screen.height / 2 - py * t.scale.y;
  }

  /** Show the whole box (in the target's local pixels) with a little margin. */
  fit(b: { minX: number; minY: number; maxX: number; maxY: number }): void {
    const scale = Math.min(this.app.screen.width / (b.maxX - b.minX), this.app.screen.height / (b.maxY - b.minY)) * 0.95;
    this.centerOn((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, scale);
  }
}
