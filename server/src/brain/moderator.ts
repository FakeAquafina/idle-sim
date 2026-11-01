// The moderator. When the owner sets it on a petition, Opus reads the village's
// situation and writes a proposal for how the world itself might grow in answer:
// a new building, a new rule, a new kind of event. The owner approves or rejects
// it in the admin panel; an approved proposal is written to docs/proposals/ in
// the checkout, ready to hand to a Claude Code session to build. Nothing here
// changes the running world by itself.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { DISCOVERIES, PLAN_ACTIONS, ProposalOutputSchema, STRUCTURES, type Proposal, type WorldState } from "@idle-sim/shared";
import { describeTime } from "../sim/clock.ts";
import { describeAsk } from "../sim/petitions.ts";
import { villageStock } from "../sim/world.ts";
import type { Budget } from "./budget.ts";
import { MODERATOR_MODEL, requestStructured } from "./claude.ts";

const FILE = "proposals.json";
const MAX_KEPT = 40;

const MODERATOR_SYSTEM = `You are the moderator of a small idle village simulation: a quiet, pre-industrial settlement watched over by an unseen provider (the owner of the game), who sometimes answers petitions the villagers make at an old shrine. The simulation is deterministic code (TypeScript); Claude models voice the villagers and write the chronicle. The owner has asked you to look at one petition and propose how the WORLD should grow in answer: not just a crate of goods, but something new in the simulation that answers the need underneath the request and makes the village richer to watch. Think like a thoughtful game designer who writes clearly for a solo, learn-as-they-go developer: concrete, small, buildable in an afternoon, in keeping with the existing systems and tone. Prefer one good idea over many. Never propose anything that costs real money per tick, breaks determinism, or needs new infrastructure. Respond only with the JSON you are asked for.`;

export interface ModeratorDeps {
  getWorld: () => WorldState;
  client: Anthropic | null;
  budget: Budget;
  /** server/data: proposals.json lives here. */
  dataDir: string;
  /** The checkout root: approved proposals are written under docs/proposals/. */
  repoRoot: string;
  notify: (text: string) => void;
}

export class Moderator {
  private proposals: Proposal[] = [];

  constructor(private deps: ModeratorDeps) {
    this.load();
  }

  list(): Proposal[] {
    return this.proposals;
  }

  /** Set the moderator on a petition. Returns at once; the proposal fills in when Opus answers. */
  request(petitionId: string): { ok: boolean; message?: string } {
    const w = this.deps.getWorld();
    const petition = w.petitions.find((p) => p.id === petitionId);
    if (!petition) return { ok: false, message: "No such petition" };
    if (!this.deps.client) return { ok: false, message: "No ANTHROPIC_API_KEY on the server" };
    if (this.proposals.some((p) => p.petitionId === petitionId && (p.status === "writing" || p.status === "pending"))) {
      return { ok: false, message: "The moderator is already on that petition" };
    }
    const proposal: Proposal = {
      id: `m${Date.now().toString(36)}`,
      petitionId,
      petitionText: `${petition.villagerName} asks for ${describeAsk(petition)}: "${petition.reason}"`,
      createdAt: Date.now(),
      status: "writing",
    };
    this.proposals.push(proposal);
    this.trim();
    this.save();
    void this.write(proposal.id);
    return { ok: true, message: "The moderator is writing a proposal" };
  }

  approve(id: string): { ok: boolean; message?: string } {
    const p = this.proposals.find((x) => x.id === id);
    if (!p) return { ok: false, message: "No such proposal" };
    if (p.status !== "pending") return { ok: false, message: `Proposal is ${p.status}` };
    const dir = path.join(this.deps.repoRoot, "docs", "proposals");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const file = path.join("docs", "proposals", `${p.id}-${slug(p.title ?? "proposal")}.md`);
    writeFileSync(path.join(this.deps.repoRoot, file), this.toMarkdown(p));
    p.status = "approved";
    p.decidedAt = Date.now();
    p.file = file;
    this.save();
    return { ok: true, message: `Approved; written to ${file}` };
  }

  reject(id: string): { ok: boolean; message?: string } {
    const p = this.proposals.find((x) => x.id === id);
    if (!p) return { ok: false, message: "No such proposal" };
    if (p.status !== "pending") return { ok: false, message: `Proposal is ${p.status}` };
    p.status = "rejected";
    p.decidedAt = Date.now();
    this.save();
    return { ok: true, message: "Proposal set aside" };
  }

  private async write(id: string): Promise<void> {
    const p = this.proposals.find((x) => x.id === id);
    const { client, budget } = this.deps;
    if (!p || !client) return;
    const w = this.deps.getWorld();
    const result = await requestStructured(client, MODERATOR_SYSTEM, this.prompt(w, p), ProposalOutputSchema, {
      model: MODERATOR_MODEL,
      maxTokens: 4000,
      effort: "high",
      cacheSystem: false,
    });
    if (result.usage) budget.record(MODERATOR_MODEL, result.usage);
    if (result.error || !result.output) {
      p.status = "failed";
      p.error = result.error ?? "empty answer";
      console.warn(`[moderator] ${p.error}`);
    } else {
      Object.assign(p, result.output);
      p.status = "pending";
      console.log(`[moderator] proposal ready: ${p.title}`);
      this.deps.notify(`Moderator proposal awaiting your approval: ${p.title}`);
    }
    this.save();
  }

  private prompt(w: WorldState, p: Proposal): string {
    const c = w.clock;
    const alive = w.villagers.filter((v) => v.alive);
    const s = villageStock(w);
    const petition = w.petitions.find((x) => x.id === p.petitionId);
    const supporters = petition ? petition.supporters.map((id) => w.villagers.find((v) => v.id === id)?.name ?? "someone") : [];
    const buildings = w.structures.filter((x) => x.built && !x.hidden).map((x) => `${x.name ? `${x.name} (` : ""}${STRUCTURES[x.kind].label.toLowerCase()}${x.name ? ")" : ""}`);
    const catalog = Object.entries(STRUCTURES).map(([k, d]) => `${k}: ${d.description}`).join("\n");
    const learned = (w.discoveries ?? []).map((d) => DISCOVERIES[d.effect].name);
    const chronicle = w.chronicle.slice(-4).map((e) => `- ${e.title}: ${e.text}`).join("\n");
    const events = w.events.slice(-15).map((e) => `- ${e.text}`).join("\n");
    return `## The petition
${p.petitionText}
Standing behind it at the shrine: ${supporters.join(", ") || "the petitioner alone"}.${petition?.status ? ` Status: ${petition.status}.` : ""}

## The village right now
Day ${c.dayOfSeason + 1} of ${c.season}, year ${c.year + 1}, ${describeTime(c)}, weather ${c.weather}.
${alive.length} villagers: ${alive.map((v) => `${v.name} (${v.stage}, ${v.skill}; ${v.traits.join(", ")})`).join("; ")}.
Between them they own ${s.wood} wood, ${s.stone} stone, ${s.food} food, ${s.seeds} seeds, ${s.ore} ore.
Buildings: ${buildings.join(", ") || "only the camp"}. Learned from journeys: ${learned.join(", ") || "nothing yet"}.

## Recent happenings
${events || "- quiet"}

## From the chronicle
${chronicle || "- nothing written yet"}

## What the simulation already has
Buildings villagers can lay out (each has a cost in materials and takes work):
${catalog}
Actions a villager may take: ${PLAN_ACTIONS.join(", ")}.
Systems: personal ownership of what one gathers, households, a common storehouse, a market stall with coin and a travelling merchant, farms and seasons, hunting and fishing, wild and tame animals, petitions at a shrine, journeys that bring back discoveries (${Object.values(DISCOVERIES).map((d) => d.name).join(", ")}), conversations, families, births, deaths, a chronicle, outside news as gossip.

Propose how the world should grow in answer to this petition. One to a few concrete changes, each buildable in an afternoon. Give the chronicle a line or two to read when it comes to pass. Be honest about risks.`;
  }

  toMarkdown(p: Proposal): string {
    const when = new Date(p.createdAt).toISOString().slice(0, 10);
    return `# ${p.title ?? "Proposal"}

*Moderator proposal ${p.id}, written ${when}, approved by the owner.*

**The petition:** ${p.petitionText}

## Summary

${p.summary ?? ""}

## Proposed changes

${(p.changes ?? []).map((c) => `- **${c.area}**: ${c.description}`).join("\n")}

## For the chronicle

> ${p.flavour ?? ""}

## Risks

${p.risks ?? ""}

## Implementation notes

${p.implementation_notes ?? ""}

---
To build this, start a Claude Code session in the repo and say: *implement the approved proposal in \`${p.file ?? "docs/proposals/<this file>"}\`*.
`;
  }

  private trim(): void {
    if (this.proposals.length > MAX_KEPT) this.proposals.splice(0, this.proposals.length - MAX_KEPT);
  }

  private load(): void {
    const file = path.join(this.deps.dataDir, FILE);
    if (!existsSync(file)) return;
    try {
      const raw = JSON.parse(readFileSync(file, "utf8")) as Proposal[];
      this.proposals = Array.isArray(raw) ? raw : [];
      // A write that was in flight when the server stopped is lost.
      for (const p of this.proposals) if (p.status === "writing") (p.status = "failed"), (p.error = "server restarted while writing");
    } catch (err) {
      console.warn("[moderator] could not read proposals.json:", err);
    }
  }

  private save(): void {
    try {
      if (!existsSync(this.deps.dataDir)) mkdirSync(this.deps.dataDir, { recursive: true });
      const file = path.join(this.deps.dataDir, FILE);
      writeFileSync(file + ".tmp", JSON.stringify(this.proposals, null, 2));
      renameSync(file + ".tmp", file);
    } catch (err) {
      console.warn("[moderator] could not save proposals:", err);
    }
  }
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "proposal";
}
