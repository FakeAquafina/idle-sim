// Rule-based goal picker. Used for every villager in Phase 1, and later as the
// fallback whenever Claude is unavailable or the AI budget is spent.

import { STRUCTURES, type Goal, type GoalType, type Villager, type WorldState } from "@idle-sim/shared";
import { emitEvent } from "./events.ts";
import { currentProposal, villageLacks } from "./petitions.ts";
import { chance, randInt } from "./rng.ts";
import {
  canAfford,
  countResourceTiles,
  findPlacement,
  isWalkable,
  placeStructure,
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

  // --- personal needs ---
  if (n.hunger < 35 && store && w.storehouse.food > 0 && ok("eat")) return { type: "eat" };
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
  const blueprint = w.structures.find((s) => !s.built);
  if (blueprint && ok("build") && w.clock.weather !== "storm") return { type: "build", structureId: blueprint.id };

  const farms = structuresWithFunction(w, "farm");
  const ready = farms.find((f) => (f.growth ?? 0) >= 1);
  if (ready && ok("farm")) return { type: "farm", structureId: ready.id, tendTicks: 0 };
  const unplanted = farms.find((f) => f.growth === undefined);
  if (unplanted && w.storehouse.seeds > 0 && w.clock.season !== "winter" && ok("farm")) {
    return { type: "farm", structureId: unplanted.id, tendTicks: 0 };
  }

  const project = planProject(w, v);
  if (project) return project;

  if (ok("gather")) {
    if (w.storehouse.wood < 40 && countResourceTiles(w, "forest") > 0) {
      return { type: "gather", resource: "wood", phase: "to_resource", collectTimer: 0 };
    }
    if (w.storehouse.stone < 15 && countResourceTiles(w, "rock") > 0) {
      return { type: "gather", resource: "stone", phase: "to_resource", collectTimer: 0 };
    }
  }

  const growing = farms.find((f) => f.growth !== undefined && f.growth < 1);
  if (growing && ok("farm") && chance(w, 0.3)) return { type: "farm", structureId: growing.id, tendTicks: 0 };

  if (n.social < 60 && fire && chance(w, 0.3) && ok("socialize_at")) {
    return { type: "socialize_at", structureId: fire.id, untilTick: tick + 600 };
  }
  return wanderGoal(w, v);
}

/** Decide whether the village should start a new building, and lay it out if so. */
function planProject(w: WorldState, v: Villager): Goal | null {
  if (w.structures.filter((s) => !s.built).length >= MAX_BLUEPRINTS) return null;
  const alive = w.villagers.filter((x) => x.alive);
  const center = villageCenter(w);

  const tryPlace = (kind: string): Goal | null => {
    if (!canAfford(w, STRUCTURES[kind].cost)) return null;
    const spot = findPlacement(w, kind, center);
    if (!spot) return null;
    const s = placeStructure(w, kind, spot.x, spot.y);
    if (!s) return null;
    emitEvent(w, "blueprint", `${v.name} laid out a new ${STRUCTURES[kind].label.toLowerCase()}.`, {
      villagerIds: [v.id],
      pos: spot,
    });
    return { type: "build", structureId: s.id };
  };

  const homeless = alive.filter((x) => !x.homeId).length;
  const housesPlanned = w.structures.filter((s) => s.kind === "house" && !s.built).length;
  if (homeless > housesPlanned * (STRUCTURES.house.capacity ?? 2)) {
    const g = tryPlace("house");
    if (g) return g;
  }

  const farms = w.structures.filter((s) => s.kind === "farm").length;
  if (farms < Math.ceil(alive.length / 2)) {
    const g = tryPlace("farm");
    if (g) return g;
  }

  if (alive.length >= 6 && structuresWithFunction(w, "water", false).length === 0) {
    const g = tryPlace("well");
    if (g) return g;
  }
  return null;
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
