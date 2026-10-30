// What Claude is allowed to decide for a villager, as a Zod schema.
// Flat and enum-constrained on purpose: the server validates every choice
// against the world before it becomes a real goal.

import { z } from "zod/v4";

export const PLAN_ACTIONS = ["build", "farm", "gather", "talk_to", "rest", "eat", "wander", "socialize", "petition", "support"] as const;
export type PlanAction = (typeof PLAN_ACTIONS)[number];

export const PETITION_ASKS = ["wood", "stone", "food", "seeds", "newcomer", "blessing"] as const;
export type PetitionAsk = (typeof PETITION_ASKS)[number];

export const PetitionRequestSchema = z.object({
  ask: z.enum(PETITION_ASKS),
  amount: z.number().int().nullable().describe("Units asked for; null for newcomer/blessing."),
  reason: z.string().describe("One sentence, in character, spoken at the shrine."),
});

export const PlanOutputSchema = z.object({
  thought: z.string().describe("Private reasoning, one or two sentences."),
  say: z.string().nullable().describe("Something said aloud right now, under 120 characters, or null."),
  action: z.enum(PLAN_ACTIONS),
  target: z
    .string()
    .nullable()
    .describe("build: a building kind. gather: wood or stone. talk_to: a villager's name. Otherwise null."),
  petition: PetitionRequestSchema.nullable().describe("Only when action is petition (proposing a gathering at the shrine)."),
  memory_note: z.string().nullable().describe("A short note worth remembering, or null."),
});

export type PlanOutput = z.infer<typeof PlanOutputSchema>;
export type PetitionRequest = z.infer<typeof PetitionRequestSchema>;

// ---- Petition records (live in WorldState) -----------------------------------

/** proposed = gathering support at the shrine; open = enough voices, waiting on the provider. */
export type PetitionStatus = "proposed" | "open" | "granted" | "denied" | "lapsed";

export interface Petition {
  id: string;
  villagerId: string;
  villagerName: string;
  ask: PetitionAsk;
  amount: number | null;
  reason: string;
  tick: number;
  status: PetitionStatus;
  /** Villagers who have come to the shrine to back this request (proposer included). */
  supporters: string[];
  /** Voices needed before the petition opens. */
  needed: number;
  /** Proposal lapses if not enough voices gather by this tick. */
  expiresTick: number;
  grantedAmount?: number;
  /** Optional one-line message from the provider, delivered as a whisper. */
  response?: string;
  resolvedTick?: number;
}

export interface Rumor {
  text: string;
  tick: number;
}

export const MAX_OPEN_PETITIONS = 3;
export const MAX_OPEN_PER_VILLAGER = 1;
/** Minimum voices for a petition to open (also at least half the living villagers). */
export const MIN_SUPPORTERS = 2;
/** Sim days a proposal waits for support before lapsing. */
export const PROPOSAL_DAYS = 1;

/** Stock below which a villager may reasonably ask the provider for a resource. */
export const PETITION_NEED_THRESHOLD: Record<"wood" | "stone" | "food" | "seeds", number> = {
  wood: 25,
  stone: 10,
  food: 15,
  seeds: 2,
};
