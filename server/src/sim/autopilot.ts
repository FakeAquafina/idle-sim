// Rule-based goal picker. Used for every villager when Claude is unavailable or
// the AI budget is spent, and in between Claude's decisions.

import { STRUCTURES, type Goal, type GoalType, type Villager, type WorldState } from "@idle-sim/shared";
import { emitEvent } from "./events.ts";
import { currentProposal, villageLacks } from "./petitions.ts";
import { chance, randInt } from "./rng.ts";
import {
  canAfford,
  countResourceTiles,
  distance,
  findPlacement,
  hasCoast,
  isWalkable,
  nearestWildAnimal,
  placeStructure,
  shoreTiles,
  structuresWithFunction,
  villageCenter,
} from "./world.ts";
import { villagerTile } from "./villager.ts";

const MAX_BLUEPRINTS = 2;

export function chooseGoal(w: WorldState, v: Villager): Goal {
  const tick = w.clock.tick;
  const ok = (t: GoalType) => (v.cooldowns[t] ?? 0) <= tick;
  const store = structuresWithFunction(w, "storage")[0];
  const fire = structuresWithFunction(w, "social")[0];
  const n = v.needs;
  const s = w.storehouse;

  // --- personal needs ---
  if (n.hunger < 35 && store && s.food > 0 && ok("eat")) return { type: "eat" };
  if ((n.energy < 25 || (w.clock.isNight && n.energy < 70)) && ok("rest")) {
    return { type: "rest", structureId: v.homeId ?? fire?.id };
  }
  if (n.warmth < 30 && fire && ok("socialize_at")) {
    return { type: "socialize_at", structureId: fire.id, untilTick: tick + 600 };
  }
  if (n.social < 30 && ok("socialize_at")) {
    const other = nearestOther(w, v);
    if (other && chance(w, 0.5) && ok("talk_to")) return { type: "talk_to", villagerId: other.id, chatted: false };
    if (fire) return { type: "socialize_at", structureId: fire.id, untilTick: tick + 900 };
  }

  // --- a gathering at the shrine for something the village really lacks ---
  const proposal = currentProposal(w);
  if (proposal && !proposal.supporters.includes(v.id) && villageLacks(w, proposal.ask) && ok("support") && chance(w, 0.6)) {
    return { type: "support", petitionId: proposal.id };
  }

  // --- children don't work ---
  if (v.stage === "child") return wanderGoal(w, v);

  // --- village work ---
  const blueprint = w.structures.find((x) => !x.built);
  if (blueprint && ok("build") && w.clock.weather !== "storm") return { type: "build", structureId: blueprint.id };

  const farms = structuresWithFunction(w, "farm");
  const ready = farms.find((f) => (f.growth ?? 0) >= 1);
  if (ready && ok("farm")) return { type: "farm", structureId: ready.id, tendTicks: 0 };

  // Food first when it's getting low: harvest, fish, hunt.
  const alive = w.villagers.filter((x) => x.alive).length;
  if (s.food < 6 + alive * 2) {
    const food = foodGoal(w, v, ok);
    if (food) return food;
  }

  const unplanted = farms.find((f) => f.growth === undefined);
  if (unplanted && s.seeds > 0 && w.clock.season !== "winter" && ok("farm")) {
    return { type: "farm", structureId: unplanted.id, tendTicks: 0 };
  }

  const project = planProject(w, v);
  if (project) return project;

  const mine = structuresWithFunction(w, "mining").find((m) => !m.depleted);
  if (s.wood < 40 && ok("gather") && countResourceTiles(w, "forest") > 0) {
    return { type: "gather", resource: "wood", phase: "to_resource", collectTimer: 0 };
  }
  if (s.stone < 15 || (mine && (mine.reserve?.ore ?? 0) > 0 && s.ore < 10 && chance(w, 0.4))) {
    if (mine && ok("mine")) return { type: "mine", structureId: mine.id, phase: "to_mine", timer: 0 };
    if (s.stone < 15 && ok("gather") && countResourceTiles(w, "rock") > 0) {
      return { type: "gather", resource: "stone", phase: "to_resource", collectTimer: 0 };
    }
  }

  // Goats for the pen.
  const pen = structuresWithFunction(w, "livestock")[0];
  if (pen && ok("tame") && chance(w, 0.35)) {
    const herd = w.animals.filter((a) => a.alive && a.penId === pen.id).length;
    const goat = nearestWildAnimal(w, v.pos, "goat");
    if (goat && herd < (STRUCTURES[pen.kind].capacity ?? 4) && distance(goat.pos, v.pos) < 25) {
      return { type: "tame", animalId: goat.id, penId: pen.id, phase: "approach" };
    }
  }

  if (s.food < 40 && chance(w, 0.4)) {
    const food = foodGoal(w, v, ok);
    if (food) return food;
  }

  const growing = farms.find((f) => f.growth !== undefined && f.growth < 1);
  if (growing && ok("farm") && chance(w, 0.3)) return { type: "farm", structureId: growing.id, tendTicks: 0 };

  if (n.social < 60 && fire && chance(w, 0.3) && ok("socialize_at")) {
    return { type: "socialize_at", structureId: fire.id, untilTick: tick + 600 };
  }
  return wanderGoal(w, v);
}

/** Fish if there's a shore, otherwise hunt whatever is nearest. */
function foodGoal(w: WorldState, v: Villager, ok: (t: GoalType) => boolean): Goal | null {
  const canFish = hasCoast(w) && ok("fish") && shoreTiles(w, villagerTile(v), 1).length > 0;
  const prey = ok("hunt") ? nearestWildAnimal(w, v.pos) : undefined;
  const preyClose = prey && distance(prey.pos, v.pos) < 22;
  if (canFish && (!preyClose || chance(w, 0.6) || v.skill === "fisher")) return { type: "fish", phase: "to_shore", timer: 0 };
  if (preyClose) return { type: "hunt", animalId: prey!.id, phase: "chasing" };
  if (canFish) return { type: "fish", phase: "to_shore", timer: 0 };
  return null;
}

/** Decide whether the village should start a new building, and lay it out if so. */
function planProject(w: WorldState, v: Villager): Goal | null {
  if (w.structures.filter((s) => !s.built).length >= MAX_BLUEPRINTS) return null;
  const alive = w.villagers.filter((x) => x.alive);
  const center = villageCenter(w);
  const s = w.storehouse;

  const tryPlace = (kind: string, near = center, radius = 18): Goal | null => {
    if (!canAfford(w, STRUCTURES[kind].cost)) return null;
    const spot = findPlacement(w, kind, near, radius);
    if (!spot) return null;
    const placed = placeStructure(w, kind, spot.x, spot.y);
    if (!placed) return null;
    emitEvent(w, "blueprint", `${v.name} laid out a new ${STRUCTURES[kind].label.toLowerCase()}.`, { villagerIds: [v.id], pos: spot });
    return { type: "build", structureId: placed.id };
  };
  const count = (kind: string) => w.structures.filter((x) => x.kind === kind).length;

  const homeless = alive.filter((x) => !x.homeId).length;
  const housesPlanned = w.structures.filter((x) => x.kind === "house" && !x.built).length;
  if (homeless > housesPlanned * (STRUCTURES.house.capacity ?? 2)) {
    const g = tryPlace("house");
    if (g) return g;
  }
  if (count("farm") < Math.ceil(alive.length / 2) && (s.seeds > 0 || count("farm") === 0)) {
    const g = tryPlace("farm");
    if (g) return g;
  }
  if (hasCoast(w) && count("dock") === 0 && s.food < 40) {
    const shore = shoreTiles(w, center, 1)[0];
    if (shore) {
      const g = tryPlace("dock", shore, 10);
      if (g) return g;
    }
  }
  if (count("mine") === 0 && (s.stone < 20 || countResourceTiles(w, "ore") > 0) && alive.length >= 4) {
    const rock = nearestRockLike(w, center);
    if (rock) {
      const g = tryPlace("mine", rock, 6);
      if (g) return g;
    }
  }
  if (count("pen") === 0 && w.animals.some((a) => a.alive && a.kind === "goat" && !a.tame) && alive.length >= 5) {
    const g = tryPlace("pen");
    if (g) return g;
  }
  if (count("workshop") === 0 && s.ore >= 5) {
    const g = tryPlace("workshop");
    if (g) return g;
  }
  if (alive.length >= 6 && count("well") === 0) {
    const g = tryPlace("well");
    if (g) return g;
  }
  return null;
}

function nearestRockLike(w: WorldState, from: { x: number; y: number }): { x: number; y: number } | null {
  let best: { x: number; y: number } | null = null;
  let bestD = Infinity;
  for (let y = 0; y < w.height; y++) {
    for (let x = 0; x < w.width; x++) {
      const k = w.tiles[y * w.width + x].kind;
      if (k !== "rock" && k !== "ore") continue;
      const d = Math.abs(x - from.x) + Math.abs(y - from.y);
      if (d < bestD) {
        best = { x, y };
        bestD = d;
      }
    }
  }
  return best;
}

function nearestOther(w: WorldState, v: Villager): Villager | undefined {
  let best: Villager | undefined;
  let bestD = Infinity;
  for (const o of w.villagers) {
    if (o.id === v.id || !o.alive) continue;
    const d = Math.hypot(o.pos.x - v.pos.x, o.pos.y - v.pos.y);
    if (d < bestD) {
      best = o;
      bestD = d;
    }
  }
  return best;
}

function wanderGoal(w: WorldState, v: Villager): Goal {
  const here = villagerTile(v);
  for (let i = 0; i < 12; i++) {
    const x = here.x + randInt(w, -8, 8);
    const y = here.y + randInt(w, -8, 8);
    if (isWalkable(w, x, y)) return { type: "wander", target: { x, y } };
  }
  return { type: "wander", target: here };
}
