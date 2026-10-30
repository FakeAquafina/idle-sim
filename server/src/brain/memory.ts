// Keeps each villager's memory short: when the notes pile up, the oldest ones
// are condensed into a line or two so nothing important is simply forgotten.

import type Anthropic from "@anthropic-ai/sdk";
import { MemorySummarySchema, type Settings, type Villager, type WorldState } from "@idle-sim/shared";
import { MEMORY_LIMIT } from "../sim/villager.ts";
import type { Budget } from "./budget.ts";
import { PLAN_MODEL, requestStructured } from "./claude.ts";

/** How many of the oldest notes get folded together at a time. */
export const CONDENSE_COUNT = 12;
const RETRY_MS = 10 * 60_000;

/** Replace the oldest `count` notes with the summary lines. Pure, so it is easy to test. */
export function applySummary(v: Villager, count: number, summary: string[]): void {
  const kept = v.memory.slice(count);
  v.memory = [...summary.map((s) => s.slice(0, 120)), ...kept];
}

export interface MemoryDeps {
  getWorld: () => WorldState;
  client: Anthropic | null;
  budget: Budget;
  getSettings: () => Settings;
  systemPrompt: string;
}

export class MemoryBrain {
  private inflight = false;
  private lastTry = new Map<string, number>();

  constructor(private deps: MemoryDeps) {}

  /** Call every few seconds. Condenses at most one villager at a time. */
  check(): void {
    const { client, getWorld, getSettings, budget } = this.deps;
    const settings = getSettings();
    if (!client || !settings.aiEnabled || this.inflight || !budget.canSpend(settings.budgetUsdPerHour)) return;
    const now = Date.now();
    const v = getWorld().villagers.find((x) => x.alive && x.memory.length >= MEMORY_LIMIT && now - (this.lastTry.get(x.id) ?? 0) > RETRY_MS);
    if (v) void this.condense(v.id);
  }

  private async condense(id: string): Promise<void> {
    const { client, getWorld, budget, systemPrompt } = this.deps;
    if (!client) return;
    const w = getWorld();
    const v = w.villagers.find((x) => x.id === id);
    if (!v) return;
    this.inflight = true;
    this.lastTry.set(id, Date.now());
    const oldest = v.memory.slice(0, CONDENSE_COUNT);
    const prompt = `## Condense memories
These are ${v.name}'s oldest memory notes, in order:
${oldest.map((m) => `- ${m}`).join("\n")}

Condense them into one or two first-person lines (under 120 characters each) that ${v.name} would keep: names, promises, grudges, losses, and anything about the provider matter most. Drop routine chores.`;
    try {
      const result = await requestStructured(client, systemPrompt, prompt, MemorySummarySchema, { maxTokens: 800 });
      if (result.usage) budget.record(PLAN_MODEL, result.usage);
      if (result.error || !result.output) {
        console.warn(`[memory] ${v.name}: ${result.error ?? "empty summary"}`);
        return;
      }
      // Only fold the notes we actually sent; newer ones may have been added meanwhile.
      const v2 = getWorld().villagers.find((x) => x.id === id);
      if (!v2 || v2.memory.slice(0, oldest.length).join("|") !== oldest.join("|")) return;
      applySummary(v2, oldest.length, result.output.summary);
      console.log(`[memory] ${v2.name}: ${oldest.length} notes -> ${result.output.summary.length}`);
    } finally {
      this.inflight = false;
    }
  }
}
