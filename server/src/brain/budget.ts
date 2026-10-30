// Tracks Claude spend over a rolling hour so the village can never run away with the bill.

import type Anthropic from "@anthropic-ai/sdk";

/** USD per million tokens. */
export const PRICING: Record<string, { input: number; output: number; cacheWrite: number; cacheRead: number }> = {
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheWrite: 0.125, cacheRead: 0.01 },
  "claude-opus-5-5": { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 },
};

const HOUR_MS = 60 * 60 * 1000;

export function costOf(model: string, usage: Anthropic.Usage): number {
  const p = PRICING[model] ?? PRICING["claude-opus-5-5"];
  const m = 1_000_000;
  return (
    (usage.input_tokens / m) * p.input +
    ((usage.cache_creation_input_tokens ?? 0) / m) * p.cacheWrite +
    ((usage.cache_read_input_tokens ?? 0) / m) * p.cacheRead +
    (usage.output_tokens / m) * p.output
  );
}

export class Budget {
  private entries: { at: number; usd: number }[] = [];

  record(model: string, usage: Anthropic.Usage): number {
    const usd = costOf(model, usage);
    this.entries.push({ at: Date.now(), usd });
    this.prune();
    return usd;
  }

  spentLastHour(): number {
    this.prune();
    return this.entries.reduce((sum, e) => sum + e.usd, 0);
  }

  callsLastHour(): number {
    this.prune();
    return this.entries.length;
  }

  canSpend(capUsd: number): boolean {
    return this.spentLastHour() < capUsd;
  }

  private prune() {
    const cutoff = Date.now() - HOUR_MS;
    while (this.entries.length && this.entries[0].at < cutoff) this.entries.shift();
  }
}
