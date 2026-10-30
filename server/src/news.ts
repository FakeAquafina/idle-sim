// Real-world headlines, fetched from public RSS feeds about once an hour and
// retold by Claude as the kind of garbled news a traveller might bring. The
// result lands in the village as a rumor; villagers gossip about it for a while.

import type Anthropic from "@anthropic-ai/sdk";
import { GossipSchema, type Settings, type WorldState } from "@idle-sim/shared";
import type { Budget } from "./brain/budget.ts";
import { PLAN_MODEL, requestStructured } from "./brain/claude.ts";
import { addRumor } from "./sim/petitions.ts";

export const DEFAULT_FEEDS = [
  "https://feeds.bbci.co.uk/news/world/rss.xml",
  "https://feeds.npr.org/1001/rss.xml",
  "https://www.sciencedaily.com/rss/top.xml",
];

/** Headlines containing any of these words are skipped. Extend with NEWS_BLOCKLIST (comma-separated). */
export const DEFAULT_BLOCKLIST = [
  "killed", "dead", "death", "dies", "murder", "shooting", "shot", "stabbed", "rape", "sexual", "suicide",
  "terror", "bomb", "massacre", "abuse", "hostage", "genocide", "execution", "beheaded", "porn", "nazi",
];

const FETCH_GAP_MS = 60 * 60_000;
const RETRY_GAP_MS = 10 * 60_000;

/** Pull <item><title> texts out of an RSS or Atom feed without a parser dependency. */
export function parseFeed(xml: string): string[] {
  const titles: string[] = [];
  const items = xml.match(/<(item|entry)\b[\s\S]*?<\/\1>/gi) ?? [];
  for (const item of items) {
    const m = item.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
    if (!m) continue;
    const t = decodeEntities(m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]+>/g, "")).trim();
    if (t) titles.push(t);
  }
  return titles;
}

export function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
}

/** Drop headlines with blocked words, duplicates and anything too short. */
export function filterHeadlines(titles: string[], blocklist: string[], seen: Set<string> = new Set()): string[] {
  const block = blocklist.map((b) => b.toLowerCase());
  const out: string[] = [];
  for (const t of titles) {
    const key = t.toLowerCase();
    if (key.length < 20 || seen.has(key)) continue;
    if (block.some((b) => new RegExp(`\\b${escapeRegex(b)}\\b`, "i").test(key))) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export interface NewsDeps {
  getWorld: () => WorldState;
  client: Anthropic | null;
  budget: Budget;
  getSettings: () => Settings;
  systemPrompt: string;
  /** Fallback feeds when the admin has not set any (env NEWS_FEEDS). */
  feeds?: string[];
  blocklist?: string[];
  /** Injectable for tests. */
  fetchText?: (url: string) => Promise<string>;
}

export class NewsBrain {
  private lastRunAt = 0;
  private busy = false;
  private seen = new Set<string>();
  lastHeadlines: string[] = [];
  lastError: string | undefined;

  constructor(private deps: NewsDeps) {}

  /** Call every few seconds; does real work about once an hour. */
  check(): void {
    const { client, getSettings, getWorld, budget } = this.deps;
    const settings = getSettings();
    if (!client || !settings.newsEnabled || !settings.aiEnabled || this.busy || getWorld().paused) return;
    if (!budget.canSpend(settings.budgetUsdPerHour)) return;
    const gap = this.lastError ? RETRY_GAP_MS : FETCH_GAP_MS;
    if (Date.now() - this.lastRunAt < gap) return;
    void this.run();
  }

  /** Fetch, filter and retell. Exposed so the admin can trigger it. */
  async run(): Promise<string | null> {
    const { client, getWorld, budget, systemPrompt } = this.deps;
    if (!client) return null;
    this.busy = true;
    this.lastRunAt = Date.now();
    try {
      const headlines = await this.fetchHeadlines();
      if (headlines.length === 0) {
        this.lastError = "no usable headlines";
        return null;
      }
      const picked = headlines.slice(0, 4);
      this.lastHeadlines = picked;
      const prompt = `## Travellers' news
A traveller passing through has heard these things from far away:
${picked.map((h) => `- ${h}`).join("\n")}

Retell one or two of them as gossip the traveller tells at the campfire of a quiet pre-industrial village: half-understood, concrete, a little wondering, under 200 characters each. Describe modern things in the villagers' own terms (a "flying machine", "the far kingdoms", "the learned folk"). Do not name real living people; refer to them by role ("a king", "a healer"). Nothing graphic, no taking sides.`;
      const result = await requestStructured(client, systemPrompt, prompt, GossipSchema, { maxTokens: 800 });
      if (result.usage) budget.record(PLAN_MODEL, result.usage);
      if (result.error || !result.output) {
        this.lastError = result.error ?? "empty gossip";
        console.warn(`[news] ${this.lastError}`);
        return null;
      }
      this.lastError = undefined;
      const w = getWorld();
      for (const g of result.output.gossip.slice(0, 2)) addRumor(w, g, "news");
      console.log(`[news] ${result.output.gossip.length} rumor(s) from ${picked.length} headlines`);
      return result.output.gossip[0] ?? null;
    } finally {
      this.busy = false;
    }
  }

  private async fetchHeadlines(): Promise<string[]> {
    const custom = this.deps.getSettings().newsFeeds;
    const feeds = custom?.length ? custom : (this.deps.feeds ?? DEFAULT_FEEDS);
    const blocklist = this.deps.blocklist ?? DEFAULT_BLOCKLIST;
    const fetchText = this.deps.fetchText ?? defaultFetch;
    const all: string[] = [];
    for (const url of feeds) {
      try {
        const titles = parseFeed(await fetchText(url));
        all.push(...titles.slice(0, 8));
      } catch (err) {
        console.warn(`[news] ${url}: ${(err as Error).message}`);
      }
    }
    if (this.seen.size > 500) this.seen.clear();
    // Shuffle a little so the same outlet doesn't always lead.
    all.sort(() => Math.random() - 0.5);
    return filterHeadlines(all, blocklist, this.seen);
  }
}

async function defaultFetch(url: string): Promise<string> {
  const res = await fetch(url, { headers: { "User-Agent": "idle-village/0.1 (+rss reader)" }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}
