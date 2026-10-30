// Screen-space effects drawn over the world every frame: night darkness with
// warm light around fires and windows, weather tints, rain and snow particles,
// and the odd lightning flash in a storm.

import { Graphics } from "pixi.js";
import type { Weather } from "@idle-sim/shared";
import type { MirrorState } from "../net.ts";
import type { Light } from "./scene.ts";

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  phase: number;
}

export class Atmosphere {
  readonly gfx = new Graphics();
  private particles: Particle[] = [];
  private weather: Weather | null = null;
  private flash = 0;
  private nextBolt = 0;
  private lastMs = 0;

  /**
   * @param lights  light sources in scene-local pixels
   * @param toGlobal  converts scene-local pixels to screen pixels
   */
  update(nowMs: number, state: MirrorState | null, width: number, height: number, lights: Light[], toGlobal: (x: number, y: number) => { x: number; y: number }, zoom: number): void {
    const dt = this.lastMs ? Math.min(0.1, (nowMs - this.lastMs) / 1000) : 0;
    this.lastMs = nowMs;
    const g = this.gfx;
    g.clear();
    if (!state) return;

    const t = state.clock.timeOfDay;
    // Darkness peaks at midnight (t=0), fades out by ~06:00 and in from ~20:00.
    const night = t < 0.25 ? 1 - t / 0.25 : t > 0.8 ? (t - 0.8) / 0.2 : 0;
    const w = state.clock.weather;
    const gloom = w === "storm" ? 0.35 : w === "rain" ? 0.15 : 0;

    if (night > 0) g.rect(0, 0, width, height).fill({ color: 0x0a1030, alpha: 0.55 * night });
    // Golden light around sunrise (~06:00) and sunset (~19:00).
    const dawn = Math.max(0, 1 - Math.abs(t - 0.27) / 0.06);
    const dusk = Math.max(0, 1 - Math.abs(t - 0.79) / 0.06);
    if (dawn > 0) g.rect(0, 0, width, height).fill({ color: 0xffb070, alpha: 0.16 * dawn });
    if (dusk > 0) g.rect(0, 0, width, height).fill({ color: 0xff7a4a, alpha: 0.2 * dusk });
    if (w === "rain") g.rect(0, 0, width, height).fill({ color: 0x3a4a66, alpha: 0.18 });
    if (w === "storm") g.rect(0, 0, width, height).fill({ color: 0x222a3a, alpha: 0.35 });
    if (w === "snow") g.rect(0, 0, width, height).fill({ color: 0xffffff, alpha: 0.12 });

    // Lights only show once it is dim.
    const glow = Math.max(night, gloom * 0.6);
    if (glow > 0.05) {
      for (const l of lights) {
        const p = toGlobal(l.x, l.y);
        if (p.x < -200 || p.y < -200 || p.x > width + 200 || p.y > height + 200) continue;
        const r = l.radius * zoom;
        const a = l.strength * glow;
        g.circle(p.x, p.y, r).fill({ color: l.color, alpha: 0.1 * a });
        g.circle(p.x, p.y, r * 0.6).fill({ color: l.color, alpha: 0.14 * a });
        g.circle(p.x, p.y, r * 0.3).fill({ color: l.color, alpha: 0.2 * a });
      }
    }

    this.updateParticles(dt, w, width, height);
    this.drawParticles(w);

    if (w === "storm") {
      this.nextBolt -= dt;
      if (this.nextBolt <= 0) {
        this.flash = 1;
        this.nextBolt = 5 + Math.random() * 10;
      }
    } else {
      this.nextBolt = 2 + Math.random() * 4;
    }
    if (this.flash > 0) {
      g.rect(0, 0, width, height).fill({ color: 0xf4f8ff, alpha: 0.55 * this.flash });
      this.flash = Math.max(0, this.flash - dt * 6);
    }
  }

  private updateParticles(dt: number, w: Weather, width: number, height: number): void {
    if (w !== this.weather) {
      this.weather = w;
      this.particles = [];
      const n = w === "rain" ? 160 : w === "storm" ? 300 : w === "snow" ? 140 : 0;
      for (let i = 0; i < n; i++) this.particles.push(this.spawn(w, width, height, true));
    }
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      p.phase += dt;
      p.x += p.vx * dt + (w === "snow" ? Math.sin(p.phase * 2) * 12 * dt : 0);
      p.y += p.vy * dt;
      if (p.y > height + 10 || p.x < -20 || p.x > width + 20) this.particles[i] = this.spawn(w, width, height, false);
    }
  }

  private spawn(w: Weather, width: number, height: number, anywhere: boolean): Particle {
    const y = anywhere ? Math.random() * height : -10 - Math.random() * 40;
    if (w === "snow") return { x: Math.random() * (width + 40) - 20, y, vx: -8 + Math.random() * 16, vy: 35 + Math.random() * 35, phase: Math.random() * 6 };
    const storm = w === "storm";
    return { x: Math.random() * (width + 200), y, vx: storm ? -260 : -120, vy: storm ? 1150 : 850, phase: 0 };
  }

  private drawParticles(w: Weather): void {
    const g = this.gfx;
    if (w === "snow") {
      for (const p of this.particles) g.rect(p.x, p.y, 2, 2).fill({ color: 0xffffff, alpha: 0.85 });
    } else if (w === "rain" || w === "storm") {
      const len = w === "storm" ? 0.014 : 0.011;
      for (const p of this.particles) g.moveTo(p.x, p.y).lineTo(p.x + p.vx * len, p.y + p.vy * len);
      g.stroke({ color: 0xa9c4e8, alpha: w === "storm" ? 0.55 : 0.45, width: 1 });
    }
  }
}
