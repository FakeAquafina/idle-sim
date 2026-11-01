// Tracks Claude spend over a rolling hour so the village can never run away with the bill.
// The log is mirrored to a small JSON file so a restart doesn't reset the hour.

import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import type Anthropic from "@anthropic-ai/sdk";

/** USD per million tokens. */
export const PRICING: Record<string, { input: number; output: number; cacheWrite: number; cacheRead: number }> = {
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheWrite: 0.125, cacheRead: 0.01 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.2 },
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

interface Entry {
  at: number;
  usd: number;
}

export class Budget {
  private entries: Entry[] = [];

  /** Pass a file path to keep the last hour's spend across restarts; omit it (tests) to stay in memory. */
  constructor(private file?: string) {
    if (file) this.load();
  }

  record(model: string, usage: Anthropic.Usage): number {
    const usd = costOf(model, usage);
    this.entries.push({ at: Date.now(), usd });
    this.prune();
    this.save();
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

  private load() {
    if (!this.file || !existsSync(this.file)) return;
    try {
      const raw = JSON.parse(readFileSync(this.file, "utf8")) as unknown;
      if (!Array.isArray(raw)) return;
      this.entries = raw.filter((e): e is Entry => typeof e?.at === "number" && typeof e?.usd === "number").sort((a, b) => a.at - b.at);
      this.prune();
      if (this.entries.length) console.log(`[budget] restored ${this.entries.length} calls ($${this.spentLastHour().toFixed(3)}) from the last hour`);
    } catch (err) {
      console.warn("[budget] could not read the spend log:", err);
    }
  }

  private save() {
    if (!this.file) return;
    try {
      const tmp = this.file + ".tmp";
      writeFileSync(tmp, JSON.stringify(this.entries));
      renameSync(tmp, this.file);
    } catch (err) {
      console.warn("[budget] could not write the spend log:", err);
    }
  }
}
