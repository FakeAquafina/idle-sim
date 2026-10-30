// Answers the simulation's requests for new people (pendingArrival / pendingBirth)
// with a persona, from Claude when possible and from the pool otherwise.

import type Anthropic from "@anthropic-ai/sdk";
import type { Settings, WorldState } from "@idle-sim/shared";
import { arrive, giveBirth } from "../sim/population.ts";
import type { Persona } from "../sim/villager.ts";
import type { Budget } from "./budget.ts";
import { fallbackPersona, generatePersona } from "./persona.ts";

export interface PopulationDeps {
  getWorld: () => WorldState;
  client: Anthropic | null;
  budget: Budget;
  getSettings: () => Settings;
  systemPrompt: string;
  pool: Persona[];
}

export class PopulationBrain {
  private busy = false;

  constructor(private deps: PopulationDeps) {}

  /** Call every few seconds. */
  check(): void {
    const w = this.deps.getWorld();
    if (this.busy || w.paused) return;
    if (w.pendingBirth) void this.resolve("child");
    else if (w.pendingArrival) void this.resolve("newcomer");
  }

  private async resolve(kind: "newcomer" | "child"): Promise<void> {
    const { getWorld, getSettings, budget, client, systemPrompt, pool } = this.deps;
    this.busy = true;
    try {
      const w = getWorld();
      const parents = kind === "child" ? (w.pendingBirth?.parentIds ?? []).map((id) => w.villagers.find((v) => v.id === id)).filter((v) => !!v) : [];
      const settings = getSettings();
      const useClaude = client && settings.aiEnabled && budget.canSpend(settings.budgetUsdPerHour);
      const persona = (useClaude ? await generatePersona({ client, budget, systemPrompt }, w, kind, parents) : null) ?? fallbackPersona(w, pool, kind);
      const w2 = getWorld();
      if (kind === "child") {
        if (!w2.pendingBirth) return;
        const child = giveBirth(w2, persona);
        if (child) console.log(`[population] born: ${child.name}`);
      } else {
        if (!w2.pendingArrival) return;
        const v = arrive(w2, persona);
        console.log(`[population] arrived: ${v.name}, ${v.skill}`);
      }
    } finally {
      this.busy = false;
    }
  }
}
