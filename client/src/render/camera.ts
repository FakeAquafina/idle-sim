import type { Application, Container } from "pixi.js";

/** Drag to pan, wheel to zoom. Tracks whether the last gesture was a drag so clicks can be ignored. */
export class Camera {
  private dragging = false;
  private last = { x: 0, y: 0 };
  dragDistance = 0;

  constructor(
    private app: Application,
    private target: Container,
  ) {
    const stage = app.stage;
    stage.eventMode = "static";
    stage.hitArea = app.screen;
    stage.on("pointerdown", (e) => {
      this.dragging = true;
      this.dragDistance = 0;
      this.last = { x: e.global.x, y: e.global.y };
    });
    stage.on("pointermove", (e) => {
      if (!this.dragging) return;
      const dx = e.global.x - this.last.x;
      const dy = e.global.y - this.last.y;
      this.dragDistance += Math.abs(dx) + Math.abs(dy);
      this.target.x += dx;
      this.target.y += dy;
      this.last = { x: e.global.x, y: e.global.y };
    });
    const stop = () => (this.dragging = false);
    stage.on("pointerup", stop);
    stage.on("pointerupoutside", stop);

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

  zoomAt(sx: number, sy: number, factor: number): void {
    const t = this.target;
    const newScale = Math.max(0.5, Math.min(4, t.scale.x * factor));
    const ratio = newScale / t.scale.x;
    t.x = sx - (sx - t.x) * ratio;
    t.y = sy - (sy - t.y) * ratio;
    t.scale.set(newScale);
  }

  /** Center the view on a world-pixel point. */
  centerOn(px: number, py: number): void {
    const t = this.target;
    t.x = this.app.screen.width / 2 - px * t.scale.x;
    t.y = this.app.screen.height / 2 - py * t.scale.y;
  }

  fit(worldPxW: number, worldPxH: number): void {
    const scale = Math.min(this.app.screen.width / worldPxW, this.app.screen.height / worldPxH) * 0.95;
    this.target.scale.set(Math.max(0.5, Math.min(4, scale)));
    this.centerOn(worldPxW / 2, worldPxH / 2);
  }
}
