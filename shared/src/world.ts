// Core world types shared by server (simulation) and client (rendering).

import type { Petition, Rumor } from "./actions.ts";

export type TileKind = "grass" | "dirt" | "water" | "sand" | "forest" | "rock" | "ore" | "farmland";
export type ResourceKind = "wood" | "stone" | "food" | "seeds" | "ore";
export type Season = "spring" | "summer" | "autumn" | "winter";
export type Weather = "clear" | "rain" | "storm" | "snow";
export type LifeStage = "child" | "adult" | "elder";

export interface Vec2 {
  x: number;
  y: number;
}

export interface Tile {
  kind: TileKind;
  /** Remaining wood (forest), stone (rock) or ore (ore vein). 0 for other tiles. */
  amount: number;
}

export type AnimalKind = "deer" | "goat";

export interface Animal {
  id: string;
  kind: AnimalKind;
  pos: Vec2;
  target?: Vec2;
  /** Ticks until the animal picks a new place to wander to. */
  idleTicks: number;
  tame: boolean;
  /** Pen it lives in, once domesticated. */
  penId?: string;
  /** Villager currently leading it to a pen. */
  leaderId?: string;
  alive: boolean;
}

export type Inventory = Partial<Record<ResourceKind, number>>;

export interface Structure {
  id: string;
  /** Key into the structure catalog (see catalog.ts). */
  kind: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Construction progress 0..1. */
  progress: number;
  built: boolean;
  name?: string;
  /** Villager ids living here (houses). */
  ownerIds: string[];
  /** Farms only: crop growth 0..1. undefined = nothing planted. */
  growth?: number;
  /** Mines only: what is left in the vein. */
  reserve?: { stone: number; ore: number };
  /** Mines only: true once the vein has run dry. */
  depleted?: boolean;
}

export interface Needs {
  hunger: number; // 100 = full, 0 = starving
  energy: number; // 100 = rested
  social: number; // 100 = content
  warmth: number; // 100 = warm
}

export type GoalType =
  | "wander"
  | "gather"
  | "build"
  | "farm"
  | "rest"
  | "eat"
  | "talk_to"
  | "socialize_at"
  | "petition"
  | "support"
  | "fish"
  | "hunt"
  | "tame"
  | "mine";

export type Goal =
  | { type: "wander"; target: Vec2 }
  | {
      type: "gather";
      resource: "wood" | "stone";
      target?: Vec2;
      phase: "to_resource" | "collecting" | "to_storehouse";
      collectTimer: number;
    }
  | { type: "build"; structureId: string }
  | { type: "farm"; structureId: string; tendTicks: number }
  | { type: "rest"; structureId?: string }
  | { type: "eat" }
  | { type: "talk_to"; villagerId: string; chatted: boolean }
  | { type: "socialize_at"; structureId: string; untilTick: number }
  | { type: "petition"; ask: string; amount?: number; reason: string }
  | { type: "support"; petitionId: string }
  | { type: "fish"; target?: Vec2; phase: "to_shore" | "fishing" | "to_storehouse"; timer: number }
  | { type: "hunt"; animalId: string; phase: "chasing" | "to_storehouse" }
  | { type: "tame"; animalId: string; penId: string; phase: "approach" | "leading" }
  | { type: "mine"; structureId: string; phase: "to_mine" | "digging" | "to_storehouse"; timer: number };

export interface Speech {
  text: string;
  untilTick: number;
}

export interface Villager {
  id: string;
  name: string;
  traits: string[];
  quirk: string;
  skill: string;
  ageDays: number;
  stage: LifeStage;
  alive: boolean;
  needs: Needs;
  inventory: Inventory;
  /** Fractional tile coordinates (center of a tile is x+0.5, y+0.5). */
  pos: Vec2;
  /** Remaining waypoints as integer tile coords. */
  path: Vec2[];
  goal: Goal | null;
  goalStartedTick: number;
  /** goal type -> tick until which autopilot avoids it (after a failure). */
  cooldowns: Partial<Record<GoalType, number>>;
  speech?: Speech;
  memory: string[];
  /** other villager id -> affinity -100..100 */
  relationships: Record<string, number>;
  homeId?: string;
  /** Life partner, once two close adults sharing a house pair up. */
  partnerId?: string;
  /** For villagers born here. */
  parentIds?: string[];
  /** Ticks spent starving or freezing; death comes when it lasts too long. */
  exposureTicks?: number;
  diedTick?: number;
  deathCause?: string;
  /** Who chose the current goal. */
  source: "ai" | "autopilot";
  /** Claude's latest private reasoning (shown in the inspector). */
  lastThought?: string;
}

export interface Clock {
  tick: number;
  ticksPerDay: number;
  day: number; // total days elapsed since world start
  dayOfSeason: number; // 0..DAYS_PER_SEASON-1
  season: Season;
  year: number;
  weather: Weather;
  timeOfDay: number; // 0..1, 0 = midnight
  isNight: boolean;
}

/** A short exchange between two villagers, played out line by line. */
export interface Conversation {
  id: string;
  aId: string;
  bId: string;
  startedTick: number;
  /** Empty while waiting for Claude to write the lines. */
  lines: { speakerId: string; text: string }[];
  nextLine: number;
  nextTick: number;
  tone: "warm" | "neutral" | "tense";
  /** True until the lines have been filled in (by Claude or the canned fallback). */
  pending: boolean;
  /** Memory notes to give each speaker once the talk is over. */
  notes?: { a?: string; b?: string };
}

/** An entry in the village chronicle, written by the storyteller model. */
export interface ChronicleEntry {
  id: number;
  tick: number;
  day: number;
  kind: "day" | "obituary" | "welcome" | "naming";
  title: string;
  text: string;
}

export interface WorldEvent {
  id: number;
  tick: number;
  kind: string;
  text: string;
  villagerIds?: string[];
  pos?: Vec2;
}

export interface WorldState {
  seed: number;
  rngState: number;
  width: number;
  height: number;
  tiles: Tile[];
  structures: Structure[];
  villagers: Villager[];
  animals: Animal[];
  storehouse: Record<ResourceKind, number>;
  /** Tick at which each resource first dropped below its petition threshold (absent = not short). */
  shortageSince: Partial<Record<ResourceKind, number>>;
  /** Which map edge is sea, if any. */
  coast?: "north" | "south" | "east" | "west";
  clock: Clock;
  /** Most recent events (capped). Full history lives in events.jsonl on the server. */
  events: WorldEvent[];
  nextId: number;
  paused: boolean;
  /** Sim speed multiplier: 1 = real time (1 sim day per real hour). */
  speed: number;
  /** Tile indices changed since the last network broadcast. Not meaningful in saves. */
  dirtyTiles: number[];
  /** Requests villagers have made to the provider. */
  petitions: Petition[];
  /** Whispers from the provider (and garbled outside news) that villagers gossip about for a while. */
  rumors: Rumor[];
  /** Conversations currently being spoken. */
  conversations: Conversation[];
  /** The village's written history (capped; the full event log lives on disk). */
  chronicle: ChronicleEntry[];
  /** Set when the village could take a newcomer; the brain supplies a persona. */
  pendingArrival?: { sinceTick: number };
  /** Set when a couple is expecting; the brain supplies the child's persona. */
  pendingBirth?: { parentIds: [string, string]; sinceTick: number };
  lastArrivalTick?: number;
  lastBirthTick?: number;
}

/** Server-side settings the admin can change at runtime. */
export interface Settings {
  aiEnabled: boolean;
  /** Hard cap on Claude spend, in US dollars per rolling hour. */
  budgetUsdPerHour: number;
  /** Fetch real-world headlines and turn them into village gossip. */
  newsEnabled: boolean;
  /** Let the storyteller model write the chronicle, obituaries, welcomes and names. */
  bigMomentsEnabled: boolean;
  /** No arrivals or births once the village reaches this many living villagers. */
  populationMax: number;
}

/** AI status shared with viewers. */
export interface AiStatus {
  enabled: boolean;
  keyPresent: boolean;
  spentHourUsd: number;
  capUsd: number;
  callsHour: number;
  inflight: number;
  lastError?: string;
}

// ---- Time constants -------------------------------------------------------

/** Simulation ticks per real second at speed 1. */
export const TICKS_PER_SECOND = 10;
/** 1 sim day = 1 real hour at speed 1. */
export const TICKS_PER_DAY = TICKS_PER_SECOND * 60 * 60;
export const DAYS_PER_SEASON = 7;
export const SEASONS: Season[] = ["spring", "summer", "autumn", "winter"];
export const DAYS_PER_YEAR = DAYS_PER_SEASON * SEASONS.length;

/** Life stage thresholds in sim years. */
export const CHILD_UNTIL_YEARS = 16;
export const ELDER_FROM_YEARS = 60;

export function stageForAge(ageDays: number): LifeStage {
  const years = ageDays / DAYS_PER_YEAR;
  if (years < CHILD_UNTIL_YEARS) return "child";
  if (years < ELDER_FROM_YEARS) return "adult";
  return "elder";
}

export function tileIndex(width: number, x: number, y: number): number {
  return y * width + x;
}
