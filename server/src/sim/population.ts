// Population dynamics: couples, births, arrivals, old age and death.
// Pure simulation. When a new person is needed, this file only raises a flag
// (pendingArrival / pendingBirth); the brain supplies the persona and calls
// arrive() or giveBirth(). Without Claude the server falls back to a name pool.

import { DAYS_PER_YEAR, ELDER_FROM_YEARS, STRUCTURES, TICKS_PER_DAY, type Villager, type WorldState } from "@idle-sim/shared";
import { emitEvent } from "./events.ts";
import { chance, randInt } from "./rng.ts";
import { ageYears, createVillager, remember, type Persona } from "./villager.ts";
import { assignHomes, isWalkable, structuresWithFunction, villageCenter } from "./world.ts";

/** Affinity at which two single adults sharing a house become partners. */
export const PARTNER_AFFINITY = 40;
/** Starving or freezing this long is fatal. */
export const EXPOSURE_FATAL_TICKS = 1.5 * TICKS_PER_DAY;
/** Sim days between arrivals, and between births. */
export const ARRIVAL_GAP_DAYS = 2;
export const BIRTH_GAP_DAYS = 3;
/** Population floor under which arrivals come more eagerly. */
export const POPULATION_MIN = 5;

export function alive(w: WorldState): Villager[] {
  return w.villagers.filter((v) => v.alive);
}

export function freeBeds(w: WorldState): number {
  return structuresWithFunction(w, "shelter").reduce((n, h) => n + Math.max(0, (STRUCTURES[h.kind].capacity ?? 0) - h.ownerIds.length), 0);
}

/** Hunger or cold at zero wears a villager down; call once per tick. */
export function trackExposure(w: WorldState, v: Villager): void {
  if (v.needs.hunger <= 0 || v.needs.warmth <= 0) v.exposureTicks = (v.exposureTicks ?? 0) + 1;
  else if (v.exposureTicks) v.exposureTicks = Math.max(0, v.exposureTicks - 2); // recovers twice as fast
  if ((v.exposureTicks ?? 0) >= EXPOSURE_FATAL_TICKS) {
    die(w, v, v.needs.hunger <= 0 ? "hunger" : "cold");
  }
}

/** Once a sim day: couples, old age, and whether the village can take a new face. */
export function dailyPopulation(w: WorldState, populationMax: number): void {
  pairUp(w);
  for (const v of alive(w)) {
    const years = ageYears(v);
    if (years >= ELDER_FROM_YEARS) {
      // Rises with age: about 1% a day at 60, 5% at 70, 10% at 75.
      const p = 0.01 + Math.max(0, years - ELDER_FROM_YEARS) * 0.006;
      if (chance(w, p)) {
        die(w, v, "old age");
        continue;
      }
    }
  }
  const people = alive(w).length;
  if (people < populationMax) {
    if (!w.pendingBirth && wantsBirth(w)) {
      const couple = expectingCouple(w);
      if (couple) {
        w.pendingBirth = { parentIds: [couple[0].id, couple[1].id], sinceTick: w.clock.tick };
        emitEvent(w, "expecting", `${couple[0].name} and ${couple[1].name} are expecting a child.`, { villagerIds: [couple[0].id, couple[1].id] });
      }
    }
    if (!w.pendingArrival && wantsArrival(w)) w.pendingArrival = { sinceTick: w.clock.tick };
  }
}

/** Two single adults who share a house and like each other a lot pair up. */
function pairUp(w: WorldState): void {
  const singles = alive(w).filter((v) => v.stage === "adult" && !v.partnerId && v.homeId);
  for (const a of singles) {
    if (a.partnerId) continue;
    const b = singles.find((o) => o.id !== a.id && !o.partnerId && o.homeId === a.homeId && (a.relationships[o.id] ?? 0) >= PARTNER_AFFINITY && (o.relationships[a.id] ?? 0) >= PARTNER_AFFINITY);
    if (!b) continue;
    a.partnerId = b.id;
    b.partnerId = a.id;
    remember(a, `${b.name} and I have become partners.`);
    remember(b, `${a.name} and I have become partners.`);
    emitEvent(w, "partners", `${a.name} and ${b.name} have become partners.`, { villagerIds: [a.id, b.id] });
  }
}

function expectingCouple(w: WorldState): [Villager, Villager] | null {
  const people = alive(w);
  for (const a of people) {
    if (!a.partnerId || a.stage !== "adult" || !a.homeId) continue;
    const b = people.find((o) => o.id === a.partnerId && o.alive && o.stage === "adult" && o.homeId === a.homeId);
    if (!b) continue;
    const house = w.structures.find((h) => h.id === a.homeId);
    if (!house || house.ownerIds.length >= (STRUCTURES[house.kind].capacity ?? 2) + 1) continue; // one child fits on top of the couple
    return [a, b];
  }
  return null;
}

function wantsBirth(w: WorldState): boolean {
  const people = alive(w).length;
  const since = w.clock.tick - (w.lastBirthTick ?? -Infinity);
  if (since < BIRTH_GAP_DAYS * TICKS_PER_DAY) return false;
  if (w.storehouse.food < people * 4) return false;
  return chance(w, 0.25);
}

function wantsArrival(w: WorldState): boolean {
  const people = alive(w).length;
  if (freeBeds(w) < 1) return false;
  if (w.storehouse.food < people * 3) return false;
  const since = w.clock.tick - (w.lastArrivalTick ?? -Infinity);
  if (since < ARRIVAL_GAP_DAYS * TICKS_PER_DAY) return false;
  return chance(w, people < POPULATION_MIN ? 0.6 : 0.25);
}

/** A newcomer walks in from the north road. */
export function arrive(w: WorldState, persona: Persona): Villager {
  const c = villageCenter(w);
  let tile = { x: Math.floor(w.width / 2), y: 1 };
  for (let i = 0; i < 60; i++) {
    const cand = { x: randInt(w, 1, w.width - 2), y: randInt(w, 1, 3) };
    if (isWalkable(w, cand.x, cand.y)) {
      tile = cand;
      break;
    }
  }
  const v = createVillager(w, persona, tile);
  v.goal = { type: "wander", target: { x: c.x, y: c.y + 2 } };
  v.goalStartedTick = w.clock.tick;
  remember(v, "I came to this village looking for a place to belong.");
  w.villagers.push(v);
  w.pendingArrival = undefined;
  w.lastArrivalTick = w.clock.tick;
  assignHomes(w);
  for (const o of alive(w)) if (o.id !== v.id) remember(o, `${v.name}, a ${v.skill}, arrived from the north road.`);
  emitEvent(w, "arrival", `A stranger arrives from the north road: ${v.name}, a ${v.skill}.`, { villagerIds: [v.id], pos: tile });
  return v;
}

/** A child is born to the expecting couple. */
export function giveBirth(w: WorldState, persona: Omit<Persona, "ageYears">): Villager | null {
  const p = w.pendingBirth;
  w.pendingBirth = undefined;
  if (!p) return null;
  const parents = p.parentIds.map((id) => w.villagers.find((v) => v.id === id && v.alive)).filter((v): v is Villager => !!v);
  if (parents.length < 2) return null;
  const home = w.structures.find((h) => h.id === parents[0].homeId);
  const spot = home ? { x: home.x, y: home.y + home.h } : villageCenter(w);
  const child = createVillager(w, { ...persona, ageYears: 0 }, spot);
  child.parentIds = p.parentIds;
  child.skill = "child";
  for (const parent of parents) {
    child.relationships[parent.id] = 50;
    parent.relationships[child.id] = 60;
    remember(parent, `Our child ${child.name} was born.`);
  }
  if (home) {
    home.ownerIds.push(child.id);
    child.homeId = home.id;
  }
  w.villagers.push(child);
  w.lastBirthTick = w.clock.tick;
  for (const o of alive(w)) if (!p.parentIds.includes(o.id) && o.id !== child.id) remember(o, `${parents[0].name} and ${parents[1].name} had a child, ${child.name}.`);
  emitEvent(w, "birth", `${parents[0].name} and ${parents[1].name} have a child: ${child.name}.`, { villagerIds: [child.id, ...p.parentIds], pos: spot });
  return child;
}

/** A villager dies. They stay in the list (for the chronicle) but leave the world. */
export function die(w: WorldState, v: Villager, cause: string): void {
  if (!v.alive) return;
  v.alive = false;
  v.diedTick = w.clock.tick;
  v.deathCause = cause;
  v.goal = null;
  v.path = [];
  v.speech = undefined;
  for (const h of w.structures) h.ownerIds = h.ownerIds.filter((id) => id !== v.id);
  v.homeId = undefined;
  w.conversations = w.conversations.filter((c) => c.aId !== v.id && c.bId !== v.id);
  if (w.pendingBirth?.parentIds.includes(v.id)) w.pendingBirth = undefined;

  const years = ageYears(v);
  const text =
    cause === "old age"
      ? `${v.name} died peacefully at ${years}, after ${Math.floor(v.ageDays / DAYS_PER_YEAR)} years.`
      : `${v.name} died of ${cause} at ${years}.`;
  emitEvent(w, "death", text, { villagerIds: [v.id], pos: { x: Math.floor(v.pos.x), y: Math.floor(v.pos.y) } });

  const shrine = structuresWithFunction(w, "petition")[0] ?? structuresWithFunction(w, "social")[0];
  for (const o of alive(w)) {
    const bond = o.relationships[v.id] ?? 0;
    if (o.partnerId === v.id) {
      o.partnerId = undefined;
      remember(o, `My partner ${v.name} is gone. I don't know what to do with the quiet.`);
      o.needs.social = Math.max(0, o.needs.social - 40);
    } else if (bond >= 15) {
      remember(o, `${v.name}, my friend, died of ${cause}.`);
      o.needs.social = Math.max(0, o.needs.social - 20);
    } else {
      remember(o, `${v.name} died of ${cause}. We buried them by the shrine.`);
    }
    // Everyone gathers to mourn for a while.
    if (shrine && o.stage !== "child") {
      o.goal = { type: "socialize_at", structureId: shrine.id, untilTick: w.clock.tick + TICKS_PER_DAY / 24 };
      o.goalStartedTick = w.clock.tick;
      o.path = [];
      o.source = "autopilot";
    }
  }
  if (shrine) emitEvent(w, "funeral", `The village gathers at the ${STRUCTURES[shrine.kind].label.toLowerCase()} to mourn ${v.name}.`, { pos: { x: shrine.x, y: shrine.y } });
  assignHomes(w);
}
