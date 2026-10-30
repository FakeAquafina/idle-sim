// Big moments: the few things a day worth a stronger model. Opus writes the
// daily chronicle page, obituaries, welcomes for newcomers and newborns, and
// names for important buildings. Each is one call; a dozen or so a day at most.

import type Anthropic from "@anthropic-ai/sdk";
import { DAYS_PER_YEAR, STRUCTURES, TICKS_PER_DAY, type Settings, type WorldEvent, type WorldState } from "@idle-sim/shared";
import { z } from "zod/v4";
import { addChronicleEntry } from "../sim/chronicle.ts";
import { describeTime } from "../sim/clock.ts";
import { emitEvent } from "../sim/events.ts";
import { remember } from "../sim/villager.ts";
import type { Budget } from "./budget.ts";
import { STORY_MODEL, requestStructured } from "./claude.ts";

const PageSchema = z.object({
  title: z.string().describe("A short title, under 60 characters."),
  text: z.string().describe("The entry itself."),
});
const NameSchema = z.object({ name: z.string().describe("Two or three words, no quotes.") });

const STORY_SYSTEM = `You are the chronicler of a small village in a quiet pre-industrial land, watched over by an unseen provider who sometimes answers prayers made at a shrine. You write the village's book: short, warm, concrete, a little wry, never saccharine. You use the villagers' names and real details from the facts you are given, and you invent nothing that contradicts them. Plain prose, no headings, no lists. Respond only with the JSON you are asked for.`;

/** Buildings worth a proper name once they stand. */
const NAMED_KINDS = new Set(["dock", "mine", "workshop", "well", "shrine", "storehouse"]);

export interface MomentsDeps {
  getWorld: () => WorldState;
  client: Anthropic | null;
  budget: Budget;
  getSettings: () => Settings;
}

export class MomentsBrain {
  private queue: (() => Promise<void>)[] = [];
  private busy = false;
  private lastChronicleDay = -1;
  lastError: string | undefined;

  constructor(private deps: MomentsDeps) {}

  /** Feed every world event in; the ones that matter get written up. */
  onEvent(e: WorldEvent): void {
    const w = this.deps.getWorld();
    switch (e.kind) {
      case "death": {
        const v = w.villagers.find((x) => x.id === e.villagerIds?.[0]);
        if (v) this.enqueue(() => this.obituary(v.id));
        break;
      }
      case "arrival":
      case "birth": {
        const kind = e.kind;
        const v = w.villagers.find((x) => x.id === e.villagerIds?.[0]);
        if (v) this.enqueue(() => this.welcome(v.id, kind));
        break;
      }
      case "built": {
        const s = w.structures.find((x) => e.pos && x.x === e.pos.x && x.y === e.pos.y && x.built);
        if (s && NAMED_KINDS.has(s.kind) && !s.name) this.enqueue(() => this.nameBuilding(s.id));
        break;
      }
    }
  }

  /** Call every few seconds: writes the chronicle page for each finished sim day. */
  check(): void {
    const w = this.deps.getWorld();
    if (this.lastChronicleDay < 0) this.lastChronicleDay = w.chronicle.filter((c) => c.kind === "day").slice(-1)[0]?.day ?? w.clock.day;
    if (w.clock.day > this.lastChronicleDay && !w.paused) {
      const day = w.clock.day - 1; // the day that just ended
      this.lastChronicleDay = w.clock.day;
      this.enqueue(() => this.dayPage(day));
    }
    if (!this.busy && this.queue.length) {
      const job = this.queue.shift()!;
      this.busy = true;
      void job().finally(() => (this.busy = false));
    }
  }

  private enqueue(job: () => Promise<void>): void {
    if (this.queue.length < 10) this.queue.push(job);
  }

  private canWrite(): boolean {
    const { client, getSettings, budget } = this.deps;
    const s = getSettings();
    return !!client && s.aiEnabled && s.bigMomentsEnabled && budget.canSpend(s.budgetUsdPerHour);
  }

  private async ask<S extends z.ZodType>(prompt: string, schema: S, maxTokens = 1200): Promise<z.infer<S> | null> {
    const { client, budget } = this.deps;
    if (!client) return null;
    const result = await requestStructured(client, STORY_SYSTEM, prompt, schema, { model: STORY_MODEL, maxTokens, effort: "medium", cacheSystem: false });
    if (result.usage) budget.record(STORY_MODEL, result.usage);
    if (result.error || !result.output) {
      this.lastError = result.error ?? "empty";
      console.warn(`[story] ${this.lastError}`);
      return null;
    }
    this.lastError = undefined;
    return result.output;
  }

  private villageFacts(w: WorldState): string {
    const alive = w.villagers.filter((v) => v.alive);
    const c = w.clock;
    const s = w.storehouse;
    const buildings = w.structures.filter((x) => x.built).map((x) => x.name ?? STRUCTURES[x.kind].label.toLowerCase());
    return `Day ${c.dayOfSeason + 1} of ${c.season}, year ${c.year + 1}, ${describeTime(c)}, weather ${c.weather}. ${alive.length} villagers: ${alive.map((v) => `${v.name} (${v.stage}, ${v.skill})`).join(", ")}. Storehouse: ${s.wood} wood, ${s.stone} stone, ${s.food} food, ${s.seeds} seeds, ${s.ore} ore. Buildings: ${buildings.join(", ") || "only the camp"}.`;
  }

  private async dayPage(day: number): Promise<void> {
    const w = this.deps.getWorld();
    const from = day * TICKS_PER_DAY;
    const events = w.events.filter((e) => e.tick >= from && e.tick < from + TICKS_PER_DAY && e.kind !== "day").slice(-25);
    if (events.length < 3) return; // nothing worth a page
    if (!this.canWrite()) return;
    const prompt = `## The day that just ended
${this.villageFacts(w)}
What happened, in order:
${events.map((e) => `- ${e.text}`).join("\n")}

Write the chronicle page for this day: three to five sentences, as the village's own book would record it. Mention at least two villagers by name. Give it a short title.`;
    const page = await this.ask(prompt, PageSchema);
    if (!page) return;
    addChronicleEntry(this.deps.getWorld(), "day", page.title, page.text);
    console.log(`[story] chronicle: ${page.title}`);
  }

  private async obituary(id: string): Promise<void> {
    const w = this.deps.getWorld();
    const v = w.villagers.find((x) => x.id === id);
    if (!v) return;
    const years = Math.floor(v.ageDays / DAYS_PER_YEAR);
    const friends = w.villagers.filter((o) => o.alive && (o.relationships[v.id] ?? 0) >= 15).map((o) => o.name);
    const fallback = `${v.name}, ${v.skill}, died of ${v.deathCause ?? "unknown causes"} at ${years}. ${friends.length ? `${friends.join(", ")} mourned them most.` : ""}`.trim();
    if (!this.canWrite()) {
      addChronicleEntry(w, "obituary", `${v.name}`, fallback);
      return;
    }
    const prompt = `## An obituary
${this.villageFacts(w)}
${v.name} has died of ${v.deathCause ?? "unknown causes"} at ${years}. ${v.stage}, ${v.skill}. Traits: ${v.traits.join(", ")}. Quirk: ${v.quirk}.${v.partnerId ? ` Partner: ${w.villagers.find((o) => o.id === v.partnerId)?.name}.` : ""}${friends.length ? ` Close to: ${friends.join(", ")}.` : ""}
Things ${v.name} remembered:
${v.memory.slice(-10).map((m) => `- ${m}`).join("\n") || "- (little is recorded)"}

Write the chronicle's remembrance: three or four sentences, specific to this person, kind but honest. Title it with their name.`;
    const page = await this.ask(prompt, PageSchema);
    const w2 = this.deps.getWorld();
    addChronicleEntry(w2, "obituary", page?.title ?? v.name, page?.text ?? fallback);
    if (page) emitEvent(w2, "chronicle", `The chronicle remembers ${v.name}: "${page.text.split(/(?<=\.)\s/)[0]}"`, { villagerIds: [v.id] });
  }

  private async welcome(id: string, kind: "arrival" | "birth"): Promise<void> {
    const w = this.deps.getWorld();
    const v = w.villagers.find((x) => x.id === id);
    if (!v) return;
    const parents = (v.parentIds ?? []).map((pid) => w.villagers.find((o) => o.id === pid)?.name).filter(Boolean);
    const fallback = kind === "birth" ? `${v.name} was born to ${parents.join(" and ")}.` : `${v.name}, a ${v.skill}, came in from the north road and was given a place.`;
    if (!this.canWrite()) {
      addChronicleEntry(w, "welcome", v.name, fallback);
      return;
    }
    const prompt =
      kind === "birth"
        ? `## A birth
${this.villageFacts(w)}
${parents.join(" and ")} have had a child, ${v.name}. Traits: ${v.traits.join(", ")}. Quirk: ${v.quirk}.
Write two or three sentences for the chronicle marking the birth, and give the entry a short title.`
        : `## A newcomer
${this.villageFacts(w)}
${v.name}, a ${v.skill} aged ${Math.floor(v.ageDays / DAYS_PER_YEAR)}, has arrived from the north road. Traits: ${v.traits.join(", ")}. Quirk: ${v.quirk}.
Write two or three sentences for the chronicle on their arrival (where they might have come from, what the village made of them), and a short title.`;
    const page = await this.ask(prompt, PageSchema, 800);
    addChronicleEntry(this.deps.getWorld(), "welcome", page?.title ?? v.name, page?.text ?? fallback);
  }

  private async nameBuilding(id: string): Promise<void> {
    if (!this.canWrite()) return;
    const w = this.deps.getWorld();
    const s = w.structures.find((x) => x.id === id);
    if (!s || s.name) return;
    const def = STRUCTURES[s.kind];
    const prompt = `## Naming a building
${this.villageFacts(w)}
The village has just finished its ${def.label.toLowerCase()} (${def.description}). Recent happenings:
${w.events.slice(-8).map((e) => `- ${e.text}`).join("\n")}

Give it the name the villagers would actually use: two or three plain words, rooted in the place or in something that happened (e.g. "Oskar's Folly", "the Salt Steps"). No quotes.`;
    const out = await this.ask(prompt, NameSchema, 300);
    if (!out) return;
    const w2 = this.deps.getWorld();
    const s2 = w2.structures.find((x) => x.id === id);
    if (!s2 || s2.name) return;
    const name = out.name.replace(/["“”]/g, "").trim().slice(0, 40);
    if (!name) return;
    s2.name = name;
    for (const v of w2.villagers) if (v.alive) remember(v, `We took to calling the new ${def.label.toLowerCase()} "${name}".`);
    emitEvent(w2, "naming", `The villagers take to calling the new ${def.label.toLowerCase()} "${name}".`, { pos: { x: s2.x, y: s2.y } });
    addChronicleEntry(w2, "naming", name, `The ${def.label.toLowerCase()} finished on day ${w2.clock.dayOfSeason + 1} of ${w2.clock.season} came to be called ${name}.`);
  }
}
