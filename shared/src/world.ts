// Core world types shared by server (simulation) and client (rendering).

export type TileKind = "grass" | "dirt" | "water" | "forest" | "rock" | "farmland";
export type ResourceKind = "wood" | "stone" | "food" | "seeds";
export type Season = "spring" | "summer" | "autumn" | "winter";
export type Weather = "clear" | "rain" | "storm" | "snow";
export type LifeStage = "child" | "adult" | "elder";

export interface Vec2 {
  x: number;
  y: number;
}

export interface Tile {
  kind: TileKind;
  /** Remaining wood (forest) or stone (rock). 0 for other tiles. */
  amount: number;
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
  | "petition";

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
  | { type: "petition"; ask: string; amount?: number; reason: string };

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
  /** Who chose the current goal. */
  source: "ai" | "autopilot";
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
  storehouse: Record<ResourceKind, number>;
  clock: Clock;
  /** Most recent events (capped). Full history lives in events.jsonl on the server. */
  events: WorldEvent[];
  nextId: number;
  paused: boolean;
  /** Sim speed multiplier: 1 = real time (1 sim day per real hour). */
  speed: number;
  /** Tile indices changed since the last network broadcast. Not meaningful in saves. */
  dirtyTiles: number[];
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
