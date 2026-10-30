// Wild deer and goats roam the edges of the map, flee from people, and can be
// hunted or (goats) led into a pen.

import { STRUCTURES, TICKS_PER_DAY, TICKS_PER_SECOND, WILD_ANIMAL_TARGET, type Animal, type AnimalKind, type Structure, type WorldState } from "@idle-sim/shared";
import { emitEvent } from "./events.ts";
import { chance, pick, randInt } from "./rng.ts";
import { distance, isWalkable, structuresWithFunction, tileCenter, villageCenter } from "./world.ts";

const WANDER_SPEED = 0.8 / TICKS_PER_SECOND;
const FLEE_SPEED = 1.2 / TICKS_PER_SECOND;
const FOLLOW_SPEED = 1.7 / TICKS_PER_SECOND;
const FLEE_RADIUS: Record<AnimalKind, number> = { deer: 5, goat: 2.5 };
/** How far from the village wild animals like to stay. */
const SHY_DISTANCE = 9;

export function spawnAnimal(w: WorldState, kind: AnimalKind): Animal | null {
  const c = villageCenter(w);
  for (let i = 0; i < 80; i++) {
    const x = randInt(w, 1, w.width - 2);
    const y = randInt(w, 1, w.height - 2);
    if (!isWalkable(w, x, y) || distance({ x, y }, c) < SHY_DISTANCE + 4) continue;
    const a: Animal = { id: `a${w.nextId++}`, kind, pos: tileCenter({ x, y }), idleTicks: randInt(w, 10, 60), tame: false, alive: true };
    w.animals.push(a);
    return a;
  }
  return null;
}

export function seedAnimals(w: WorldState): void {
  for (let i = 0; i < 5; i++) spawnAnimal(w, "deer");
  for (let i = 0; i < 4; i++) spawnAnimal(w, "goat");
}

function penOf(w: WorldState, a: Animal): Structure | undefined {
  return a.penId ? w.structures.find((s) => s.id === a.penId) : undefined;
}

function moveToward(a: Animal, target: { x: number; y: number }, speed: number): boolean {
  const dx = target.x - a.pos.x;
  const dy = target.y - a.pos.y;
  const d = Math.hypot(dx, dy);
  if (d <= speed) {
    a.pos = { x: target.x, y: target.y };
    return true;
  }
  a.pos = { x: a.pos.x + (dx / d) * speed, y: a.pos.y + (dy / d) * speed };
  return false;
}

export function tickAnimals(w: WorldState, newDay: boolean): void {
  const c = villageCenter(w);
  const people = w.villagers.filter((v) => v.alive);

  for (const a of w.animals) {
    if (!a.alive) continue;

    // Led to a pen: trot after the villager.
    if (a.leaderId) {
      const leader = people.find((v) => v.id === a.leaderId);
      if (!leader) a.leaderId = undefined;
      else {
        if (distance(a.pos, leader.pos) > 1.2) moveToward(a, leader.pos, FOLLOW_SPEED);
        continue;
      }
    }

    // In a pen: potter about inside the fence.
    const pen = penOf(w, a);
    if (pen) {
      if (a.idleTicks-- <= 0 || !a.target) {
        a.target = { x: pen.x + 0.5 + Math.floor(Math.random() * 0) + randInt(w, 0, pen.w - 1), y: pen.y + 0.5 + randInt(w, 0, pen.h - 1) };
        a.idleTicks = randInt(w, 40, 120);
      }
      moveToward(a, a.target, WANDER_SPEED * 0.6);
      continue;
    }

    // Wild: flee from nearby people, otherwise wander away from the village.
    let threat: { x: number; y: number } | null = null;
    let threatD = Infinity;
    for (const v of people) {
      const d = distance(v.pos, a.pos);
      if (d < FLEE_RADIUS[a.kind] && d < threatD) {
        threat = v.pos;
        threatD = d;
      }
    }
    if (threat) {
      const dx = a.pos.x - threat.x;
      const dy = a.pos.y - threat.y;
      const d = Math.hypot(dx, dy) || 1;
      const next = { x: a.pos.x + (dx / d) * FLEE_SPEED, y: a.pos.y + (dy / d) * FLEE_SPEED };
      if (isWalkable(w, Math.floor(next.x), Math.floor(next.y))) a.pos = next;
      else a.target = undefined;
      a.idleTicks = 0;
      continue;
    }
    if (a.idleTicks-- <= 0 || !a.target) {
      a.target = undefined;
      for (let i = 0; i < 8; i++) {
        const x = Math.floor(a.pos.x) + randInt(w, -4, 4);
        const y = Math.floor(a.pos.y) + randInt(w, -4, 4);
        if (isWalkable(w, x, y) && distance({ x, y }, c) > SHY_DISTANCE) {
          a.target = tileCenter({ x, y });
          break;
        }
      }
      a.idleTicks = randInt(w, 20, 90);
    }
    if (a.target) {
      const next = { ...a.pos };
      const arrived = moveToward({ ...a, pos: next } as Animal, a.target, WANDER_SPEED);
      if (isWalkable(w, Math.floor(next.x), Math.floor(next.y))) a.pos = next;
      else a.target = undefined;
      if (arrived) a.target = undefined;
    }
  }

  // Pens: milk and kids.
  if (w.clock.tick % Math.floor(TICKS_PER_DAY / 2) === 0) {
    for (const pen of structuresWithFunction(w, "livestock")) {
      const herd = w.animals.filter((a) => a.alive && a.penId === pen.id);
      if (herd.length === 0) continue;
      w.storehouse.food += herd.length;
      const cap = STRUCTURES[pen.kind].capacity ?? 4;
      if (herd.length >= 2 && herd.length < cap && chance(w, 0.08)) {
        const kid: Animal = { id: `a${w.nextId++}`, kind: "goat", pos: { x: pen.x + 1.5, y: pen.y + 1 }, idleTicks: 30, tame: true, penId: pen.id, alive: true };
        w.animals.push(kid);
        emitEvent(w, "birth_animal", "A kid is born in the goat pen.", { pos: { x: pen.x, y: pen.y } });
      }
    }
  }

  // Wild population drifts back toward its target once a day.
  if (newDay) {
    const wild = w.animals.filter((a) => a.alive && !a.tame && !a.leaderId).length;
    if (wild < WILD_ANIMAL_TARGET) {
      const n = randInt(w, 1, 2);
      for (let i = 0; i < n; i++) spawnAnimal(w, pick(w, ["deer", "deer", "goat"] as AnimalKind[]));
    }
    // Keep the array from growing forever.
    if (w.animals.some((a) => !a.alive)) w.animals = w.animals.filter((a) => a.alive);
  }
}
