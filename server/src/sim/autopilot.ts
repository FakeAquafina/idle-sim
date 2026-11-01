// Rule-based goal picker. Used for every villager when Claude is unavailable or
// the AI budget is spent, and in between Claude's decisions.
//
// Everyone owns what they gather, so most choices look at the villager's own
// (household) stock first and the village as a whole second. Buildings are
// communal projects: anyone may lay one out when the village between them
// could pay for it, and anyone with the right materials may bring them over.

import { CARRY_LIMIT, MARKET_MARGIN, PRICES, STRUCTURES, type Goal, type GoalType, type ResourceKind, type Structure, type Villager, type WorldState } from "@idle-sim/shared";
import { emitEvent } from "./events.ts";
import { currentProposal, villageLacks } from "./petitions.ts";
import { chance, randInt } from "./rng.ts";
import { foodWithinReach, hasStorehouse, householdStock, remainingCost } from "./stock.ts";
import {
  canAfford,
  countResourceTiles,
  distance,
  findPlacement,
  hasCoast,
  isWalkable,
  nearestResourceTile,
  nearestWildAnimal,
  placeStructure,
  shoreTiles,
  structureCenter,
  structuresWithFunction,
  villageCenter,
  villageStock,
} from "./world.ts";
import { villagerTile } from "./villager.ts";

const MAX_BLUEPRINTS = 2;
/** How far (in tiles) from home a child's wandering may take them. */
export const CHILD_ROAM = 4;
/** Personal stock a villager likes to keep; beyond it they donate or sell. */
const KEEP: Record<ResourceKind, number> = { food: 10, wood: 14, stone: 10, seeds: 3, ore: 6 };

export function chooseGoal(w: WorldState, v: Villager): Goal {
  const tick = w.clock.tick;
  const ok = (t: GoalType) => (v.cooldowns[t] ?? 0) <= tick;
  const fire = structuresWithFunction(w, "social")[0];
  const n = v.needs;
  const mine = householdStock(w, v);
  const village = villageStock(w);
  const alive = w.villagers.filter((x) => x.alive);

  // --- personal needs ---
  if (n.hunger < 35 && ok("eat")) {
    if (foodWithinReach(w, v) > 0) return { type: "eat" };
    const market = structuresWithFunction(w, "market")[0];
    if (market && (market.goods?.food ?? 0) > 0 && v.coins >= PRICES.food + MARKET_MARGIN) return { type: "eat" };
    const food = foodGoal(w, v, ok);
    if (food) return food;
  }
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

  // --- children pick berries near home, otherwise play ---
  if (v.stage === "child") {
    const home = w.structures.find((s) => s.id === v.homeId);
    const anchor = home ? structureCenter(home) : w.camp;
    const wood = nearestResourceTile(w, { x: Math.floor(anchor.x), y: Math.floor(anchor.y) }, "forest");
    if (wood && distance(wood, anchor) <= CHILD_ROAM + 3 && mine.food < KEEP.food && ok("gather") && chance(w, 0.4)) {
      return { type: "gather", resource: "food", phase: "to_resource", collectTimer: 0 };
    }
    return wanderGoal(w, v);
  }

  // --- the blueprint on the ground comes first: bring what it needs, or fetch it from the land ---
  const blueprint = w.structures.find((x) => !x.built);
  if (blueprint && ok("build") && w.clock.weather !== "storm") {
    const need = remainingCost(blueprint, STRUCTURES[blueprint.kind].cost);
    const needed = Object.keys(need) as ResourceKind[];
    if (needed.length === 0) return { type: "build", structureId: blueprint.id };
    if (needed.some((k) => mine[k] > 0) || (hasStorehouse(w) && needed.some((k) => w.storehouse[k] > 0))) {
      return { type: "build", structureId: blueprint.id };
    }
    const fetch = gatherFor(w, v, needed, ok, blueprint);
    if (fetch) return fetch;
  }

  // --- food on the table ---
  const farms = structuresWithFunction(w, "farm");
  const ready = farms.find((f) => (f.growth ?? 0) >= 1);
  if (ready && ok("farm")) return { type: "farm", structureId: ready.id, tendTicks: 0 };
  const householdSize = Math.max(1, alive.filter((o) => o.homeId && o.homeId === v.homeId).length);
  if (mine.food < 4 * householdSize) {
    const food = foodGoal(w, v, ok);
    if (food) return food;
  }

  const unplanted = farms.find((f) => f.growth === undefined);
  const seedsAtHand = mine.seeds > 0 || (hasStorehouse(w) && w.storehouse.seeds > 0);
  if (unplanted && seedsAtHand && w.clock.season !== "winter" && ok("farm")) {
    return { type: "farm", structureId: unplanted.id, tendTicks: 0 };
  }

  const project = planProject(w, v, village);
  if (project) return project;

  // --- stocking one's own bundle ---
  const shaft = structuresWithFunction(w, "mining").find((m) => !m.depleted);
  if (mine.wood < KEEP.wood && ok("gather") && countResourceTiles(w, "forest") > 0) {
    return { type: "gather", resource: "wood", phase: "to_resource", collectTimer: 0 };
  }
  if (mine.stone < KEEP.stone || (shaft && (shaft.reserve?.ore ?? 0) > 0 && mine.ore < KEEP.ore && chance(w, 0.4))) {
    if (shaft && ok("mine")) return { type: "mine", structureId: shaft.id, phase: "to_mine", timer: 0 };
    if (mine.stone < KEEP.stone && ok("gather") && countResourceTiles(w, "rock") > 0) {
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

  // --- surplus: the common store, or the market ---
  const surplus = surplusOf(v);
  if (surplus && hasStorehouse(w) && ok("donate") && chance(w, 0.2)) {
    return { type: "donate", resource: surplus.k, amount: Math.min(CARRY_LIMIT, surplus.n), phase: "fetching" };
  }
  const market = structuresWithFunction(w, "market")[0];
  if (market && ok("trade")) {
    if (surplus && (market.till ?? 0) >= PRICES[surplus.k] && chance(w, 0.5)) {
      return { type: "trade", side: "sell", resource: surplus.k, amount: Math.min(CARRY_LIMIT, surplus.n), phase: "fetching" };
    }
    const buy = wantToBuy(w, v, market);
    if (buy) return buy;
  }

  if (mine.food < KEEP.food && chance(w, 0.4)) {
    const food = foodGoal(w, v, ok);
    if (food) return food;
  }

  const growing = farms.find((f) => f.growth !== undefined && f.growth < 1);
  if (growing && ok("farm") && chance(w, 0.3)) return { type: "farm", structureId: growing.id, tendTicks: 0 };

  if (n.social < 60 && fire && chance(w, 0.3) && ok("socialize_at")) {
    return { type: "socialize_at", structureId: fire.id, untilTick: tick + 600 };
  }
  // Now and then someone goes to see what lies further off.
  if (!w.clock.isNight && chance(w, 0.08)) {
    const far = exploreTarget(w, v);
    if (far) return { type: "wander", target: far };
  }
  return wanderGoal(w, v);
}

/** Forage in the woods, fish if there's a shore, or hunt whatever is nearest. */
function foodGoal(w: WorldState, v: Villager, ok: (t: GoalType) => boolean): Goal | null {
  const here = villagerTile(v);
  const wood = ok("gather") ? nearestResourceTile(w, here, "forest") : null;
  const woodClose = wood && distance(wood, here) < 14;
  const canFish = hasCoast(w) && ok("fish") && shoreTiles(w, here, 1).length > 0;
  const shoreClose = canFish && distance(shoreTiles(w, here, 1)[0], here) < 20;
  const prey = ok("hunt") ? nearestWildAnimal(w, v.pos) : undefined;
  const preyClose = prey && distance(prey.pos, v.pos) < 22;
  if (canFish && (v.skill === "fisher" || (shoreClose && chance(w, 0.5)))) return { type: "fish", phase: "to_shore", timer: 0 };
  if (preyClose && (v.skill === "hunter" || chance(w, 0.4))) return { type: "hunt", animalId: prey!.id, phase: "chasing" };
  if (woodClose) return { type: "gather", resource: "food", phase: "to_resource", collectTimer: 0 };
  if (canFish) return { type: "fish", phase: "to_shore", timer: 0 };
  if (preyClose) return { type: "hunt", animalId: prey!.id, phase: "chasing" };
  if (wood) return { type: "gather", resource: "food", phase: "to_resource", collectTimer: 0 };
  return null;
}

/** Go and get, from the land, something a blueprint still needs; the haul goes straight to it. */
function gatherFor(w: WorldState, v: Villager, needed: ResourceKind[], ok: (t: GoalType) => boolean, s: Structure): Goal | null {
  if (!ok("gather")) return null;
  for (const k of needed) {
    if (k === "wood" && countResourceTiles(w, "forest") > 0) return { type: "gather", resource: "wood", phase: "to_resource", collectTimer: 0, deliverTo: s.id };
    if (k === "stone") {
      const shaft = structuresWithFunction(w, "mining").find((m) => !m.depleted);
      if (shaft && ok("mine")) return { type: "mine", structureId: shaft.id, phase: "to_mine", timer: 0 };
      if (countResourceTiles(w, "rock") > 0) return { type: "gather", resource: "stone", phase: "to_resource", collectTimer: 0, deliverTo: s.id };
    }
  }
  return null;
}

/** What this villager has more of than they need, if anything. */
function surplusOf(v: Villager): { k: ResourceKind; n: number } | null {
  let best: { k: ResourceKind; n: number } | null = null;
  for (const k of Object.keys(KEEP) as ResourceKind[]) {
    const extra = (v.stock[k] ?? 0) - KEEP[k];
    if (extra >= 3 && (!best || extra > best.n)) best = { k, n: extra };
  }
  return best;
}

/** Buy seeds when there are none to plant, food when the larder is bare. */
function wantToBuy(w: WorldState, v: Villager, market: Structure): Goal | null {
  const goods = market.goods ?? {};
  const mine = householdStock(w, v);
  const price = (k: ResourceKind) => PRICES[k] + MARKET_MARGIN;
  const farmsWaiting = structuresWithFunction(w, "farm").some((f) => f.growth === undefined);
  if (farmsWaiting && mine.seeds === 0 && (goods.seeds ?? 0) > 0 && v.coins >= price("seeds")) {
    return { type: "trade", side: "buy", resource: "seeds", amount: Math.min(2, Math.floor(v.coins / price("seeds"))), phase: "to_market" };
  }
  if (mine.food < 3 && (goods.food ?? 0) > 0 && v.coins >= price("food")) {
    return { type: "trade", side: "buy", resource: "food", amount: Math.min(4, Math.floor(v.coins / price("food"))), phase: "to_market" };
  }
  return null;
}

/** Decide whether the village should start a new building, and lay it out if so. */
function planProject(w: WorldState, v: Villager, village: Record<ResourceKind, number>): Goal | null {
  if (w.structures.filter((s) => !s.built).length >= MAX_BLUEPRINTS) return null;
  const alive = w.villagers.filter((x) => x.alive);
  const center = villageCenter(w);

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
  const totalGoods = village.wood + village.stone + village.food;

  // A fire before anything else: warmth, and somewhere to sit together.
  if (count("campfire") === 0) {
    const g = tryPlace("campfire", w.camp, 4);
    if (g) return g;
    return null;
  }
  const homeless = alive.filter((x) => !x.homeId).length;
  const housesPlanned = w.structures.filter((x) => x.kind === "house" && !x.built).length;
  if (homeless > housesPlanned * (STRUCTURES.house.capacity ?? 2)) {
    const g = tryPlace("house");
    if (g) return g;
  }
  // Bundles piling up at the camp is what makes people think of a common store.
  if (count("storehouse") === 0 && alive.length >= 4 && totalGoods > 10 * alive.length && chance(w, 0.05)) {
    const g = tryPlace("storehouse");
    if (g) return g;
  }
  if (count("farm") < Math.ceil(alive.length / 2) && (village.seeds > 0 || count("farm") === 0)) {
    const g = tryPlace("farm");
    if (g) return g;
  }
  if (hasCoast(w) && count("dock") === 0 && village.food < 40) {
    const shore = shoreTiles(w, center, 1)[0];
    if (shore) {
      const g = tryPlace("dock", shore, 10);
      if (g) return g;
    }
  }
  // A stall once there is something to sell, or once the merchant has dropped his hint.
  if (count("market") === 0 && alive.length >= 5 && (totalGoods > 14 * alive.length || w.merchantHinted) && chance(w, 0.05)) {
    const g = tryPlace("market");
    if (g) return g;
  }
  if (count("mine") === 0 && (village.stone < 20 || countResourceTiles(w, "ore") > 0) && alive.length >= 4) {
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
  if (count("workshop") === 0 && village.ore >= 5) {
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

/** A walkable spot a good way off, for a look at the wider land. */
export function exploreTarget(w: WorldState, v: Villager): { x: number; y: number } | null {
  const here = villagerTile(v);
  for (let i = 0; i < 20; i++) {
    const x = randInt(w, 1, w.width - 2);
    const y = randInt(w, 1, w.height - 2);
    const d = Math.abs(x - here.x) + Math.abs(y - here.y);
    if (d >= 12 && d <= 30 && isWalkable(w, x, y)) return { x, y };
  }
  return null;
}

/**
 * Adults drift from wherever they stand. Children stay close to home: each
 * wander is picked around their house (or the camp), so a string of them never
 * random-walks a toddler to the edge of the map.
 */
function wanderGoal(w: WorldState, v: Villager): Goal {
  const here = villagerTile(v);
  const home = v.stage === "child" ? w.structures.find((s) => s.id === v.homeId) : undefined;
  const anchor = v.stage === "child" ? (home ? structureCenter(home) : w.camp) : here;
  const reach = v.stage === "child" ? CHILD_ROAM : 8;
  for (let i = 0; i < 12; i++) {
    const x = Math.floor(anchor.x) + randInt(w, -reach, reach);
    const y = Math.floor(anchor.y) + randInt(w, -reach, reach);
    if (isWalkable(w, x, y)) return { type: "wander", target: { x, y } };
  }
  return { type: "wander", target: here };
}
