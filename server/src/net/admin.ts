import { createHash, timingSafeEqual } from "node:crypto";
import type { AdminCommand, WorldState } from "@idle-sim/shared";

export function tokenMatches(given: string | undefined, expected: string): boolean {
  if (!given || !expected) return false;
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

export const MIN_SPEED = 0.25;
export const MAX_SPEED = 200;

export interface AdminContext {
  world: WorldState;
  reset: () => void;
}

export function runAdminCommand(cmd: AdminCommand, ctx: AdminContext): { ok: boolean; message?: string } {
  switch (cmd.cmd) {
    case "pause":
      ctx.world.paused = true;
      return { ok: true, message: "Paused" };
    case "resume":
      ctx.world.paused = false;
      return { ok: true, message: "Running" };
    case "speed": {
      const v = Number(cmd.value);
      if (!Number.isFinite(v)) return { ok: false, message: "Bad speed" };
      ctx.world.speed = Math.max(MIN_SPEED, Math.min(MAX_SPEED, v));
      return { ok: true, message: `Speed ${ctx.world.speed}x` };
    }
    case "reset":
      ctx.reset();
      return { ok: true, message: "World reset" };
    default:
      return { ok: false, message: "Unknown command" };
  }
}
