import {
  DAYS_PER_YEAR,
  TICKS_PER_DAY,
  TICKS_PER_SECOND,
  stageForAge,
  type Vec2,
  type Villager,
  type WorldState,
} from "@idle-sim/shared";
import { distance, structuresWithFunction, structureCenter, tileCenter } from "./world.ts";

export interface Persona {
  name: string;
  traits: string[];
  quirk: string;
  skill: string;
  ageYears: number;
}

export const WALK_SPEED = 1.6 / TICKS_PER_SECOND; // tiles per tick
export const MEMORY_LIMIT = 20;

export function createVillager(w: WorldState, p: Persona, tile: Vec2): Villager {
  const ageDays = Math.floor(p.ageYears * DAYS_PER_YEAR);
  return {
    id: `v${w.nextId++}`,
    name: p.name,
    traits: p.traits,
    quirk: p.quirk,
    skill: p.skill,
    ageDays,
    stage: stageForAge(ageDays),
    alive: true,
    needs: { hunger: 80, energy: 90, social: 70, warmth: 100 },
    inventory: {},
    pos: tileCenter(tile),
    path: [],
    goal: null,
    goalStartedTick: 0,
    cooldowns: {},
    memory: [],
    relationships: {},
    source: "autopilot",
  };
}

export function villagerTile(v: Villager): Vec2 {
  return { x: Math.floor(v.pos.x), y: Math.floor(v.pos.y) };
}

function clamp(n: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, n));
}

/** Is the villager inside (adjacent to) a built house right now? */
export function isSheltered(w: WorldState, v: Villager): boolean {
  const g = v.goal;
  if (!g || g.type !== "rest" || !g.structureId) return false;
  const s = w.structures.find((s) => s.id === g.structureId);
  return !!s && s.built && s.kind === "house" && distance(v.pos, structureCenter(s)) < 2.5;
}

export function isNearFire(w: WorldState, v: Villager): boolean {
  return structuresWithFunction(w, "social").some((s) => distance(v.pos, structureCenter(s)) < 2.5);
}

export function updateNeeds(w: WorldState, v: Villager): void {
  const n = v.needs;
  n.hunger = clamp(n.hunger - 100 / (1.5 * TICKS_PER_DAY));
  n.social = clamp(n.social - 100 / (2 * TICKS_PER_DAY));
  if (v.goal?.type !== "rest") n.energy = clamp(n.energy - 100 / (1.3 * TICKS_PER_DAY));

  const cold = w.clock.season === "winter" || w.clock.weather === "snow" || w.clock.weather === "storm";
  const warmSpot = isSheltered(w, v) || isNearFire(w, v);
  if (warmSpot) n.warmth = clamp(n.warmth + 100 / (0.1 * TICKS_PER_DAY));
  else if (cold) n.warmth = clamp(n.warmth - 100 / (0.6 * TICKS_PER_DAY));
  else n.warmth = clamp(n.warmth + 100 / (0.3 * TICKS_PER_DAY));
}

/** Move one step along the path. Returns true when the path is finished. */
export function moveAlongPath(v: Villager): boolean {
  if (v.path.length === 0) return true;
  const target = tileCenter(v.path[0]);
  const dx = target.x - v.pos.x;
  const dy = target.y - v.pos.y;
  const d = Math.hypot(dx, dy);
  if (d <= WALK_SPEED) {
    v.pos = target;
    v.path.shift();
  } else {
    v.pos = { x: v.pos.x + (dx / d) * WALK_SPEED, y: v.pos.y + (dy / d) * WALK_SPEED };
  }
  return v.path.length === 0;
}

export function say(w: WorldState, v: Villager, text: string, seconds = 6): void {
  v.speech = { text, untilTick: w.clock.tick + seconds * TICKS_PER_SECOND };
}

export function remember(v: Villager, note: string): void {
  v.memory.push(note);
  if (v.memory.length > MEMORY_LIMIT) v.memory.splice(0, v.memory.length - MEMORY_LIMIT);
}

export function ageOneDay(v: Villager): void {
  v.ageDays += 1;
  v.stage = stageForAge(v.ageDays);
}

export function ageYears(v: Villager): number {
  return Math.floor(v.ageDays / DAYS_PER_YEAR);
}
