// Lets Claude write what two villagers say when they meet. One call covers
// both sides of the exchange; the simulation then plays the lines out.

import type Anthropic from "@anthropic-ai/sdk";
import { ConverseOutputSchema, type Conversation, type Settings, type Villager, type WorldState } from "@idle-sim/shared";
import { cannedLines, fillConversation, setMeetHandler } from "../sim/conversation.ts";
import type { Budget } from "./budget.ts";
import { PLAN_MODEL, requestStructured } from "./claude.ts";
import { buildConversePrompt } from "./prompts/villager.ts";

/** Real-time gap between Claude-written chats for the same villager; closer ones get canned lines. */
export const CONVERSE_GAP_MS = 3 * 60_000;

export interface ConverseDeps {
  getWorld: () => WorldState;
  client: Anthropic | null;
  budget: Budget;
  getSettings: () => Settings;
  systemPrompt: string;
}

export class ConversationBrain {
  private lastAt = new Map<string, number>();
  lastError: string | undefined;

  constructor(private deps: ConverseDeps) {
    setMeetHandler((w, c, a, b) => this.onMeet(w, c, a, b));
  }

  private onMeet(w: WorldState, c: Conversation, a: Villager, b: Villager): boolean {
    const { client, getSettings, budget } = this.deps;
    const settings = getSettings();
    if (!client || !settings.aiEnabled || !budget.canSpend(settings.budgetUsdPerHour)) return false;
    const now = Date.now();
    if (now - (this.lastAt.get(a.id) ?? 0) < CONVERSE_GAP_MS || now - (this.lastAt.get(b.id) ?? 0) < CONVERSE_GAP_MS) return false;
    this.lastAt.set(a.id, now);
    this.lastAt.set(b.id, now);
    void this.write(c.id, a.id, b.id, buildConversePrompt(w, a, b));
    return true;
  }

  private async write(conversationId: string, aId: string, bId: string, prompt: string): Promise<void> {
    const { client, getWorld, budget, systemPrompt } = this.deps;
    if (!client) return;
    const result = await requestStructured(client, systemPrompt, prompt, ConverseOutputSchema, { maxTokens: 1500 });
    if (result.usage) budget.record(PLAN_MODEL, result.usage);
    const w = getWorld();
    const a = w.villagers.find((v) => v.id === aId);
    const b = w.villagers.find((v) => v.id === bId);
    if (!a || !b) return;
    if (result.error || !result.output) {
      this.lastError = result.error ?? "empty conversation";
      console.warn(`[talk] ${a.name} & ${b.name}: ${this.lastError}`);
      fillConversation(w, conversationId, cannedLines(w, a, b), "neutral");
      return;
    }
    this.lastError = undefined;
    const out = result.output;
    const lines = out.lines.map((l) => ({
      speakerId: l.speaker.trim().toLowerCase() === b.name.toLowerCase() ? b.id : a.id,
      text: l.text.slice(0, 120),
    }));
    fillConversation(w, conversationId, lines, out.tone, { a: out.memory_a ?? undefined, b: out.memory_b ?? undefined });
    console.log(`[talk] ${a.name} & ${b.name}: ${out.tone}, ${lines.length} lines (cached ${result.usage?.cache_read_input_tokens ?? 0})`);
  }
}
