import { createHash, timingSafeEqual } from "node:crypto";
import type { AdminCommand, Settings, WorldState } from "@idle-sim/shared";
import { addRumor, deliverGift, denyPetition, grantPetition } from "../sim/petitions.ts";
import type { Persona } from "../sim/villager.ts";

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
  settings: Settings;
  reset: () => void;
  saveSettings: () => void;
  /** Picks an unused persona for a newcomer, or null if the pool is empty. */
  pickNewcomer: () => Persona | null;
  /** Nudge the AI to re-plan this villager soon. */
  poke: (villagerId: string) => void;
}

export function runAdminCommand(cmd: AdminCommand, ctx: AdminContext): { ok: boolean; message?: string } {
  const w = ctx.world;
  switch (cmd.cmd) {
    case "pause":
      w.paused = true;
      return { ok: true, message: "Paused" };
    case "resume":
      w.paused = false;
      return { ok: true, message: "Running" };
    case "speed": {
      const v = Number(cmd.value);
      if (!Number.isFinite(v)) return { ok: false, message: "Bad speed" };
      w.speed = Math.max(MIN_SPEED, Math.min(MAX_SPEED, v));
      return { ok: true, message: `Speed ${w.speed}x` };
    }
    case "reset":
      ctx.reset();
      return { ok: true, message: "World reset" };

    case "grant": {
      const p = w.petitions.find((x) => x.id === cmd.petitionId);
      const newcomer = p?.ask === "newcomer" ? (ctx.pickNewcomer() ?? undefined) : undefined;
      if (p?.ask === "newcomer" && !newcomer) return { ok: false, message: "No newcomer personas left" };
      const err = grantPetition(w, cmd.petitionId, { amount: cmd.amount, message: cmd.message, newcomer });
      if (err) return { ok: false, message: err };
      if (p) ctx.poke(p.villagerId);
      return { ok: true, message: "Granted" };
    }
    case "deny": {
      const p = w.petitions.find((x) => x.id === cmd.petitionId);
      const err = denyPetition(w, cmd.petitionId, cmd.message);
      if (err) return { ok: false, message: err };
      if (p) ctx.poke(p.villagerId);
      return { ok: true, message: "Denied" };
    }
    case "gift": {
      if (cmd.resource === "blessing") deliverGift(w, "blessing");
      else {
        const n = Math.floor(Number(cmd.amount ?? 10));
        if (!Number.isFinite(n) || n < 1 || n > 100) return { ok: false, message: "Amount must be 1-100" };
        deliverGift(w, cmd.resource, n);
      }
      return { ok: true, message: "Gift delivered" };
    }
    case "rumor": {
      if (!cmd.text?.trim()) return { ok: false, message: "Empty rumor" };
      addRumor(w, cmd.text);
      for (const v of w.villagers) if (v.alive) ctx.poke(v.id);
      return { ok: true, message: "Rumor whispered" };
    }
    case "setAi":
      ctx.settings.aiEnabled = !!cmd.enabled;
      ctx.saveSettings();
      return { ok: true, message: ctx.settings.aiEnabled ? "AI on" : "AI off (autopilot)" };
    case "setBudget": {
      const v = Number(cmd.usdPerHour);
      if (!Number.isFinite(v) || v < 0 || v > 20) return { ok: false, message: "Budget must be $0-20/hour" };
      ctx.settings.budgetUsdPerHour = v;
      ctx.saveSettings();
      return { ok: true, message: `Budget $${v.toFixed(2)}/hour` };
    }
    case "setNews":
      ctx.settings.newsEnabled = !!cmd.enabled;
      ctx.saveSettings();
      return { ok: true, message: ctx.settings.newsEnabled ? "Travellers bring news" : "No outside news" };
    case "setBigMoments":
      ctx.settings.bigMomentsEnabled = !!cmd.enabled;
      ctx.saveSettings();
      return { ok: true, message: ctx.settings.bigMomentsEnabled ? "Chronicle on" : "Chronicle off" };
    case "setPopulationMax": {
      const v = Math.floor(Number(cmd.value));
      if (!Number.isFinite(v) || v < 2 || v > 30) return { ok: false, message: "Population cap must be 2-30" };
      ctx.settings.populationMax = v;
      ctx.saveSettings();
      return { ok: true, message: `Population cap ${v}` };
    }
    default:
      return { ok: false, message: "Unknown command" };
  }
}
