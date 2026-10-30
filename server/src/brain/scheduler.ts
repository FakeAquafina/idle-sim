// Decides WHEN each villager asks Claude what to do, and applies the answer.
// Timing is in real seconds (not sim ticks) so fast-forwarding never multiplies cost.

import type Anthropic from "@anthropic-ai/sdk";
import type { AiStatus, Settings, WorldState } from "@idle-sim/shared";
import { inConversation } from "../sim/conversation.ts";
import { remember, say } from "../sim/villager.ts";
import { planToGoal } from "./apply.ts";
import type { Budget } from "./budget.ts";
import { PLAN_MODEL, requestPlan } from "./claude.ts";
import { buildVillagerPrompt } from "./prompts/villager.ts";

export const MIN_INTERVAL_MS = 30_000; // never ask about the same villager more often than this
export const PERIOD_MS = 120_000; // re-plan a busy villager this often
export const MAX_INFLIGHT = 2;

export interface SchedulerDeps {
  getWorld: () => WorldState;
  client: Anthropic | null;
  budget: Budget;
  getSettings: () => Settings;
  systemPrompt: string;
}

export class Scheduler {
  private lastPlanAt = new Map<string, number>();
  private inflight = new Set<string>();
  private poked = new Set<string>();
  lastError: string | undefined;
  private budgetWarned = false;

  constructor(private deps: SchedulerDeps) {}

  status(): AiStatus {
    const s = this.deps.getSettings();
    return {
      enabled: s.aiEnabled,
      keyPresent: this.deps.client !== null,
      spentHourUsd: this.deps.budget.spentLastHour(),
      capUsd: s.budgetUsdPerHour,
      callsHour: this.deps.budget.callsLastHour(),
      inflight: this.inflight.size,
      lastError: this.lastError,
    };
  }

  /** Ask for a fresh decision soon (e.g. after a gift arrives). */
  poke(villagerId: string): void {
    this.poked.add(villagerId);
  }

  /** Call about once per real second. */
  check(onBudgetHit?: () => void): void {
    const { client, getWorld, getSettings, budget } = this.deps;
    const w = getWorld();
    const settings = getSettings();
    if (!client || !settings.aiEnabled || w.paused) return;
    if (!budget.canSpend(settings.budgetUsdPerHour)) {
      this.lastError = "hourly budget reached; villagers on autopilot";
      if (!this.budgetWarned) {
        this.budgetWarned = true;
        onBudgetHit?.();
      }
      return;
    }
    this.budgetWarned = false;

    const now = Date.now();
    const candidates = w.villagers
      .filter((v) => v.alive && !this.inflight.has(v.id) && !inConversation(w, v.id))
      .filter((v) => now - (this.lastPlanAt.get(v.id) ?? 0) >= MIN_INTERVAL_MS)
      .filter((v) => this.poked.has(v.id) || v.goal === null || v.source === "autopilot" || now - (this.lastPlanAt.get(v.id) ?? 0) >= PERIOD_MS)
      .sort((a, b) => (this.lastPlanAt.get(a.id) ?? 0) - (this.lastPlanAt.get(b.id) ?? 0));

    for (const v of candidates) {
      if (this.inflight.size >= MAX_INFLIGHT) break;
      void this.plan(v.id);
    }
  }

  private async plan(villagerId: string): Promise<void> {
    const { client, getWorld, budget, systemPrompt } = this.deps;
    if (!client) return;
    const w = getWorld();
    const v = w.villagers.find((x) => x.id === villagerId);
    if (!v) return;

    this.inflight.add(villagerId);
    this.poked.delete(villagerId);
    this.lastPlanAt.set(villagerId, Date.now());
    try {
      const result = await requestPlan(client, systemPrompt, buildVillagerPrompt(w, v));
      if (result.usage) budget.record(PLAN_MODEL, result.usage);
      if (result.error || !result.plan) {
        this.lastError = result.error ?? "empty plan";
        console.warn(`[brain] ${v.name}: ${this.lastError}`);
        return;
      }
      this.lastError = undefined;

      // The world may have been reset or the villager may have died while we waited.
      const w2 = getWorld();
      const v2 = w2.villagers.find((x) => x.id === villagerId);
      if (!v2 || !v2.alive) return;
      if (inConversation(w2, v2.id)) return; // got into a chat while we waited; let it play out
      this.applyPlan(w2, v2, result.plan);
      const u = result.usage!;
      console.log(
        `[brain] ${v2.name}: ${result.plan.action}${result.plan.target ? ` ${result.plan.target}` : ""} ` +
          `(in ${u.input_tokens}, cached ${u.cache_read_input_tokens ?? 0}, out ${u.output_tokens})`,
      );
    } finally {
      this.inflight.delete(villagerId);
    }
  }

  private applyPlan(w: WorldState, v: WorldState["villagers"][number], plan: NonNullable<Awaited<ReturnType<typeof requestPlan>>["plan"]>): void {
    // Guardrail: a starving villager who is already heading to eat is left alone.
    const protect = v.goal?.type === "eat" && v.needs.hunger < 20;
    const { goal, reason } = protect ? { goal: null, reason: "too hungry to change plans" } : planToGoal(w, v, plan);

    v.lastThought = reason ? `${plan.thought} (couldn't: ${reason})` : plan.thought;
    if (plan.say) say(w, v, plan.say.slice(0, 120), 8);
    if (plan.memory_note) remember(v, plan.memory_note.slice(0, 100));
    if (goal) {
      v.goal = goal;
      v.goalStartedTick = w.clock.tick;
      v.path = [];
      v.source = "ai";
    }
  }
}
