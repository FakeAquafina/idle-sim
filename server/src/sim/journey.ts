// Journeys. Now and then a villager shoulders a pack and leaves the map by the
// north road. Most come back a few days later with coin, a little to trade and
// something the village did not know before (see DISCOVERIES). Some never do.

import {
  DISCOVERIES,
  JOURNEY_GIVE_UP_DAYS,
  JOURNEY_LOST_CHANCE,
  JOURNEY_MAX_DAYS,
  JOURNEY_MIN_DAYS,
  TICKS_PER_DAY,
  type DiscoveryEffect,
  type Villager,
  type WorldState,
} from "@idle-sim/shared";
import { emitEvent } from "./events.ts";
import { chance, pick, randInt } from "./rng.ts";
import { addTo } from "./stock.ts";
import { remember } from "./villager.ts";
import { assignHomes, isWalkable, tileCenter } from "./world.ts";

export function hasDiscovery(w: WorldState, effect: DiscoveryEffect): boolean {
  return (w.discoveries ?? []).some((d) => d.effect === effect);
}

export function awayNow(w: WorldState): Villager[] {
  return w.villagers.filter((v) => v.alive && v.away);
}

/** Why this villager may not set out right now, or null if they may. */
export function cannotJourney(w: WorldState, v: Villager): string | null {
  if (v.stage !== "adult") return "only grown villagers go journeying";
  if (v.away) return "already away";
  if (awayNow(w).length > 0) return `${awayNow(w)[0].name} is already away; the village can spare one at a time`;
  if (v.needs.hunger < 50 || v.needs.energy < 40) return "too hungry or tired for the road";
  const since = w.clock.tick - (w.lastJourneyTick ?? -Infinity);
  if (since < 3 * TICKS_PER_DAY) return "someone set out only recently";
  if (w.villagers.filter((x) => x.alive).length < 4) return "the village is too small to spare anyone";
  return null;
}

/** Where the road leaves the map. */
export function roadOut(w: WorldState): { x: number; y: number } {
  for (let i = 0; i < 40; i++) {
    const t = { x: randInt(w, 2, w.width - 3), y: randInt(w, 0, 1) };
    if (isWalkable(w, t.x, t.y)) return t;
  }
  return { x: Math.floor(w.width / 2), y: 0 };
}

/** The villager has reached the road: off they go. */
export function depart(w: WorldState, v: Villager): void {
  const lost = chance(w, JOURNEY_LOST_CHANCE);
  const days = randInt(w, JOURNEY_MIN_DAYS, JOURNEY_MAX_DAYS);
  v.away = { sinceTick: w.clock.tick, returnTick: lost ? null : w.clock.tick + days * TICKS_PER_DAY };
  v.goal = null;
  v.path = [];
  v.speech = undefined;
  v.pos = { x: v.pos.x, y: -3 }; // beyond the edge, out of sight
  w.lastJourneyTick = w.clock.tick;
  remember(v, "I set out on the north road to see what lies beyond the hills.");
  for (const o of w.villagers) if (o.alive && o.id !== v.id) remember(o, `${v.name} set out on a journey beyond the hills.`);
  emitEvent(w, "journey", `${v.name} shoulders a pack and sets out north along the road, beyond the hills.`, { villagerIds: [v.id], pos: { x: Math.floor(v.pos.x), y: 0 } });
}

/** Call once per tick: travellers come home, or are given up on. */
export function tickJourneys(w: WorldState): void {
  for (const v of w.villagers) {
    if (!v.alive || !v.away) continue;
    const gone = w.clock.tick - v.away.sinceTick;
    if (v.away.returnTick !== null) {
      if (w.clock.tick >= v.away.returnTick) comeHome(w, v);
    } else if (gone >= JOURNEY_GIVE_UP_DAYS * TICKS_PER_DAY) {
      giveUpOn(w, v);
    }
  }
}

function comeHome(w: WorldState, v: Villager): void {
  const road = roadOut(w);
  v.pos = tileCenter(road);
  v.away = undefined;
  v.needs.hunger = Math.max(v.needs.hunger, 55);
  v.needs.energy = Math.max(v.needs.energy, 50);
  v.needs.social = 100;
  const coins = randInt(w, 4, 14);
  v.coins += coins;
  const goods = chance(w, 0.5) ? ("seeds" as const) : ("ore" as const);
  const n = randInt(w, 2, 4);
  addTo(v.stock, goods, n);
  const known = new Set((w.discoveries ?? []).map((d) => d.effect));
  const unknown = (Object.keys(DISCOVERIES) as DiscoveryEffect[]).filter((e) => !known.has(e));
  const found = unknown.length && chance(w, 0.85) ? pick(w, unknown) : null;
  if (found) {
    w.discoveries ??= [];
    w.discoveries.push({ effect: found, tick: w.clock.tick, finderId: v.id });
    const d = DISCOVERIES[found];
    remember(v, `I came home from my journey with ${d.name}: ${d.text}.`);
    for (const o of w.villagers) if (o.alive && o.id !== v.id) remember(o, `${v.name} came back from the hills with ${d.name}.`);
    emitEvent(w, "discovery", `${v.name} comes back down the north road, thinner and grinning, with ${coins} coin, ${n} ${goods} and ${d.name}: ${d.text}.`, {
      villagerIds: [v.id],
      pos: road,
    });
  } else {
    remember(v, "I came home from my journey with a little coin and a lot of stories.");
    for (const o of w.villagers) if (o.alive && o.id !== v.id) remember(o, `${v.name} came back from the hills.`);
    emitEvent(w, "journey", `${v.name} comes back down the north road with ${coins} coin, ${n} ${goods} and a lot of stories.`, { villagerIds: [v.id], pos: road });
  }
}

/** No word has come. They are not dead, as far as anyone knows, but they are gone. */
function giveUpOn(w: WorldState, v: Villager): void {
  v.alive = false;
  v.departed = true;
  v.away = undefined;
  v.goal = null;
  v.path = [];
  for (const h of w.structures) h.ownerIds = h.ownerIds.filter((id) => id !== v.id);
  v.homeId = undefined;
  if (w.pendingBirth?.parentIds.includes(v.id)) w.pendingBirth = undefined;
  for (const o of w.villagers) {
    if (!o.alive) continue;
    if (o.partnerId === v.id) {
      o.partnerId = undefined;
      remember(o, `${v.name} never came back from the road. I still look north some evenings.`);
      o.needs.social = Math.max(0, o.needs.social - 30);
    } else if ((o.relationships[v.id] ?? 0) >= 15) {
      remember(o, `No word ever came of ${v.name}. I hope the road was kind.`);
      o.needs.social = Math.max(0, o.needs.social - 10);
    } else {
      remember(o, `${v.name} went over the hills and never came back.`);
    }
  }
  emitEvent(w, "journey_lost", `No word has come of ${v.name} since they took the north road. The village stops setting a place.`, { villagerIds: [v.id] });
  assignHomes(w);
}
