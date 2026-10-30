// Invents new people: newcomers on the road and children born in the village.
// Claude writes them when available; otherwise a spare persona from the pool
// (or a plain generated one) is used so the village never waits.

import type Anthropic from "@anthropic-ai/sdk";
import { PersonaSchema, type Villager, type WorldState } from "@idle-sim/shared";
import { pick } from "../sim/rng.ts";
import type { Persona } from "../sim/villager.ts";
import type { Budget } from "./budget.ts";
import { PLAN_MODEL, requestStructured } from "./claude.ts";

const SPARE_NAMES = ["Ansel", "Birgit", "Corin", "Dorte", "Emmet", "Freya", "Gale", "Hedda", "Ivo", "Jorun", "Kell", "Liv", "Mattis", "Nell", "Orla", "Petter", "Runa", "Sten", "Tilde", "Ulf"];
const SPARE_TRAITS = ["quiet", "bold", "patient", "nosy", "gentle", "stubborn", "cheerful", "wary", "dreamy", "brisk"];
const SPARE_QUIRKS = ["whistles the same four notes", "counts steps between buildings", "never sits with their back to a door", "collects feathers", "talks to the fire"];
const SPARE_SKILLS = ["fisher", "hunter", "miner", "herder", "farmer", "builder"];

export function usedNames(w: WorldState): Set<string> {
  return new Set(w.villagers.map((v) => v.name.toLowerCase()));
}

/** A persona without Claude: the pool first, then something plain but serviceable. */
export function fallbackPersona(w: WorldState, pool: Persona[], kind: "newcomer" | "child"): Persona {
  const used = usedNames(w);
  if (kind === "newcomer") {
    const spare = pool.find((p) => !used.has(p.name.toLowerCase()));
    if (spare) return spare;
  }
  const name = SPARE_NAMES.find((n) => !used.has(n.toLowerCase())) ?? `${pick(w, SPARE_NAMES)} the younger`;
  return {
    name,
    traits: [pick(w, SPARE_TRAITS), pick(w, SPARE_TRAITS)],
    quirk: pick(w, SPARE_QUIRKS),
    skill: kind === "child" ? "child" : pick(w, SPARE_SKILLS),
    ageYears: kind === "child" ? 0 : 20 + Math.floor(Math.random() * 25),
  };
}

export interface PersonaDeps {
  client: Anthropic | null;
  budget: Budget;
  systemPrompt: string;
}

/** Ask Claude for a newcomer or a newborn. Returns null on any failure (callers then use fallbackPersona). */
export async function generatePersona(deps: PersonaDeps, w: WorldState, kind: "newcomer" | "child", parents: Villager[] = []): Promise<Persona | null> {
  const { client, budget, systemPrompt } = deps;
  if (!client) return null;
  const people = w.villagers.filter((v) => v.alive);
  const roster = people.map((v) => `${v.name} (${v.skill})`).join(", ");
  const taken = [...usedNames(w)].join(", ");
  const prompt =
    kind === "newcomer"
      ? `## A newcomer
A stranger is walking in from the north road to join this village of ${people.length}: ${roster}. It is ${w.clock.season}. Invent them: a given name not among (${taken}), two one-word traits, a small quirk, a trade the village could use, and an age between 18 and 50. Keep it grounded and specific, in the same spirit as the people already here.`
      : `## A newborn
${parents.map((p) => `${p.name} (${p.traits.join(", ")}; ${p.quirk}; ${p.skill})`).join(" and ")} have had a child. Invent the baby: a given name not among (${taken}), two one-word traits that echo or contrast the parents, a small quirk a toddler might have, skill "child", ageYears 0.`;
  const result = await requestStructured(client, systemPrompt, prompt, PersonaSchema, { maxTokens: 600 });
  if (result.usage) budget.record(PLAN_MODEL, result.usage);
  if (result.error || !result.output) {
    console.warn(`[persona] ${kind}: ${result.error ?? "empty"}`);
    return null;
  }
  const p = result.output;
  const name = p.name.trim().split(/\s+/)[0] || "Nameless";
  if (usedNames(w).has(name.toLowerCase())) return null;
  return {
    name,
    traits: p.traits.map((t) => t.toLowerCase().slice(0, 20)),
    quirk: p.quirk.slice(0, 80),
    skill: kind === "child" ? "child" : p.skill.toLowerCase().slice(0, 20),
    ageYears: kind === "child" ? 0 : Math.max(16, Math.min(60, p.ageYears)),
  };
}
