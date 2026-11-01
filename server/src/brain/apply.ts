// Turns Claude's answer into a real goal, refusing anything the world can't support.
// Pure game logic: no network, easy to test.

import {
  CARRY_LIMIT,
  MARKET_MARGIN,
  PRICES,
  STRUCTURES,
  type Goal,
  type PlanOutput,
  type ResourceKind,
  type Villager,
  type WorldState,
} from "@idle-sim/shared";
import { exploreTarget } from "../sim/autopilot.ts";
import { emitEvent } from "../sim/events.ts";
import { canPetition, currentProposal } from "../sim/petitions.ts";
import { RESOURCES, foodWithinReach, hasStorehouse, householdStock } from "../sim/stock.ts";
import { canAfford, countResourceTiles, distance, findPlacement, hasCoast, nearestWildAnimal, placeStructure, shoreTiles, structuresWithFunction, villageCenter } from "../sim/world.ts";
import { villagerTile } from "../sim/villager.ts";

export interface ApplyResult {
  goal: Goal | null;
  /** Why the plan was rejected, when goal is null. */
  reason?: string;
}

export function planToGoal(w: WorldState, v: Villager, plan: PlanOutput): ApplyResult {
  const tick = w.clock.tick;
  const fire = structuresWithFunction(w, "social")[0];
  const market = structuresWithFunction(w, "market")[0];

  switch (plan.action) {
    case "wander":
      return { goal: null, reason: "wander handled by autopilot" };

    case "explore": {
      const far = exploreTarget(w, v);
      if (!far) return { goal: null, reason: "nowhere new to walk to" };
      return { goal: { type: "wander", target: far } };
    }

    case "rest":
      return { goal: { type: "rest", structureId: v.homeId ?? fire?.id } };

    case "eat": {
      if (foodWithinReach(w, v) > 0) return { goal: { type: "eat" } };
      if (market && (market.goods?.food ?? 0) > 0 && v.coins >= PRICES.food + MARKET_MARGIN) return { goal: { type: "eat" } };
      return { goal: null, reason: "no food to be had: forage, fish or hunt" };
    }

    case "forage": {
      if (countResourceTiles(w, "forest") === 0) return { goal: null, reason: "no woods to forage in" };
      return { goal: { type: "gather", resource: "food", phase: "to_resource", collectTimer: 0 } };
    }

    case "donate": {
      if (!hasStorehouse(w)) return { goal: null, reason: "there is no storehouse to give to" };
      const res = resourceNamed(plan.target);
      if (!res) return { goal: null, reason: "donate needs a resource name" };
      const have = v.stock[res] ?? 0;
      if (have <= 0) return { goal: null, reason: `you have no ${res} of your own to give` };
      return { goal: { type: "donate", resource: res, amount: Math.min(CARRY_LIMIT, have), phase: "fetching" } };
    }

    case "trade": {
      if (!market) return { goal: null, reason: "there is no market stall" };
      const words = (plan.target ?? "").trim().toLowerCase().split(/\s+/);
      const side = words[0] === "buy" ? "buy" : words[0] === "sell" ? "sell" : null;
      const res = resourceNamed(words[1]);
      if (!side || !res) return { goal: null, reason: `trade target must be "sell <resource>" or "buy <resource>"` };
      if (side === "sell") {
        const have = v.stock[res] ?? 0;
        if (have <= 0) return { goal: null, reason: `you have no ${res} to sell` };
        if ((market.till ?? 0) < PRICES[res]) return { goal: null, reason: "the stall's till is empty; wait for the merchant" };
        return { goal: { type: "trade", side, resource: res, amount: Math.min(CARRY_LIMIT, have), phase: "fetching" } };
      }
      const price = PRICES[res] + MARKET_MARGIN;
      if ((market.goods?.[res] ?? 0) <= 0) return { goal: null, reason: `the stall has no ${res}` };
      if (v.coins < price) return { goal: null, reason: `${res} costs ${price} coin and you have ${v.coins}` };
      return { goal: { type: "trade", side, resource: res, amount: Math.min(4, Math.floor(v.coins / price)), phase: "to_market" } };
    }

    case "socialize":
      if (!fire) return { goal: null, reason: "no campfire" };
      return { goal: { type: "socialize_at", structureId: fire.id, untilTick: tick + 900 } };

    case "talk_to": {
      const name = (plan.target ?? "").trim().toLowerCase();
      const other = w.villagers.find((o) => o.alive && o.id !== v.id && o.name.toLowerCase() === name);
      if (!other) return { goal: null, reason: `no villager named "${plan.target}"` };
      return { goal: { type: "talk_to", villagerId: other.id, chatted: false } };
    }

    case "gather": {
      const res = plan.target === "stone" ? "stone" : plan.target === "wood" ? "wood" : null;
      if (!res) return { goal: null, reason: `gather target must be wood or stone` };
      if (countResourceTiles(w, res === "wood" ? "forest" : "rock") === 0) return { goal: null, reason: `no ${res} left to gather` };
      if (v.stage === "child") return { goal: null, reason: "children don't gather" };
      return { goal: { type: "gather", resource: res, phase: "to_resource", collectTimer: 0 } };
    }

    case "fish": {
      if (v.stage === "child") return { goal: null, reason: "children don't fish alone" };
      if (!hasCoast(w) || shoreTiles(w, villagerTile(v), 1).length === 0) return { goal: null, reason: "no shore to fish from" };
      return { goal: { type: "fish", phase: "to_shore", timer: 0 } };
    }

    case "hunt": {
      if (v.stage === "child") return { goal: null, reason: "children don't hunt" };
      const kind = plan.target === "deer" || plan.target === "goat" ? plan.target : undefined;
      const prey = nearestWildAnimal(w, v.pos, kind);
      if (!prey) return { goal: null, reason: kind ? `no wild ${kind} about` : "no game about" };
      if (distance(prey.pos, v.pos) > 30) return { goal: null, reason: "the game is too far off" };
      return { goal: { type: "hunt", animalId: prey.id, phase: "chasing" } };
    }

    case "tame": {
      if (v.stage === "child") return { goal: null, reason: "children don't wrangle goats" };
      const pen = structuresWithFunction(w, "livestock")[0];
      if (!pen) return { goal: null, reason: "no pen to keep animals in" };
      const herd = w.animals.filter((a) => a.alive && a.penId === pen.id).length;
      if (herd >= (STRUCTURES[pen.kind].capacity ?? 4)) return { goal: null, reason: "the pen is full" };
      const goat = nearestWildAnimal(w, v.pos, "goat");
      if (!goat) return { goal: null, reason: "no wild goats about" };
      return { goal: { type: "tame", animalId: goat.id, penId: pen.id, phase: "approach" } };
    }

    case "mine": {
      if (v.stage === "child") return { goal: null, reason: "children don't mine" };
      const mine = structuresWithFunction(w, "mining").find((m) => !m.depleted);
      if (!mine) return { goal: null, reason: structuresWithFunction(w, "mining").length ? "the mine is worked out" : "no mine yet" };
      return { goal: { type: "mine", structureId: mine.id, phase: "to_mine", timer: 0 } };
    }

    case "farm": {
      if (v.stage === "child") return { goal: null, reason: "children don't farm" };
      const farms = structuresWithFunction(w, "farm");
      const seeds = householdStock(w, v).seeds + (hasStorehouse(w) ? w.storehouse.seeds : 0);
      const pick =
        farms.find((f) => (f.growth ?? 0) >= 1) ??
        (seeds > 0 && w.clock.season !== "winter" ? farms.find((f) => f.growth === undefined) : undefined) ??
        farms.find((f) => f.growth !== undefined && f.growth < 1);
      if (!pick) return { goal: null, reason: farms.length ? "nothing to do on the farms right now" : "no farms" };
      return { goal: { type: "farm", structureId: pick.id, tendTicks: 0 } };
    }

    case "build": {
      if (v.stage === "child") return { goal: null, reason: "children don't build" };
      if (w.clock.weather === "storm") return { goal: null, reason: "too stormy to build" };
      const kind = (plan.target ?? "").trim().toLowerCase();
      const existing = w.structures.find((s) => !s.built && (!kind || s.kind === kind)) ?? w.structures.find((s) => !s.built);
      if (existing && (!kind || existing.kind === kind || !STRUCTURES[kind])) return { goal: { type: "build", structureId: existing.id } };
      if (!STRUCTURES[kind]) return { goal: null, reason: `unknown building "${plan.target}"` };
      const tooMany = tooManyOfKind(w, kind);
      if (tooMany) return { goal: null, reason: tooMany };
      if (w.structures.filter((s) => !s.built).length >= 2) return { goal: null, reason: "two blueprints already waiting" };
      if (!canAfford(w, STRUCTURES[kind].cost)) return { goal: null, reason: `the village does not own enough materials for a ${kind} yet` };
      let near = villageCenter(w);
      let radius = 18;
      if (STRUCTURES[kind].mustTouch === "water") {
        const shore = shoreTiles(w, near, 1)[0];
        if (!shore) return { goal: null, reason: "no shore to build on" };
        near = shore;
        radius = 10;
      } else if (STRUCTURES[kind].mustTouch === "rock") {
        radius = 40;
      }
      const spot = findPlacement(w, kind, near, radius);
      if (!spot) return { goal: null, reason: "no suitable spot to build" };
      const s = placeStructure(w, kind, spot.x, spot.y);
      if (!s) return { goal: null, reason: "could not place the blueprint" };
      emitEvent(w, "blueprint", `${v.name} laid out a new ${STRUCTURES[kind].label.toLowerCase()}.`, { villagerIds: [v.id], pos: spot });
      return { goal: { type: "build", structureId: s.id } };
    }

    case "support": {
      const p = currentProposal(w);
      if (!p) return { goal: null, reason: "nobody is calling a gathering right now" };
      if (p.supporters.includes(v.id)) return { goal: null, reason: "you already stand with that request" };
      return { goal: { type: "support", petitionId: p.id } };
    }

    case "petition": {
      if (!plan.petition) return { goal: null, reason: "petition without details" };
      const problem = canPetition(w, v, plan.petition);
      if (problem) return { goal: null, reason: problem };
      return {
        goal: { type: "petition", ask: plan.petition.ask, amount: plan.petition.amount ?? undefined, reason: plan.petition.reason },
      };
    }
  }
}

function resourceNamed(s: string | null | undefined): ResourceKind | null {
  const k = (s ?? "").trim().toLowerCase().replace(/s$/, "");
  const match = RESOURCES.find((r) => r === k || r === `${k}s` || r.replace(/s$/, "") === k);
  return match ?? null;
}

/** One-of-a-kind buildings, and sensible ceilings for the rest. */
function tooManyOfKind(w: WorldState, kind: string): string | null {
  const count = w.structures.filter((s) => s.kind === kind).length;
  const alive = w.villagers.filter((v) => v.alive).length;
  const fn = STRUCTURES[kind].function;
  if ((fn === "storage" || fn === "social" || fn === "petition" || fn === "fishing" || fn === "livestock" || fn === "crafting" || fn === "market") && count >= 1) return `the village already has a ${kind}`;
  if (fn === "mining" && w.structures.some((s) => s.kind === kind && !s.depleted)) return "the current mine is not worked out yet";
  if (fn === "fishing" && !hasCoast(w)) return "there is no coast here";
  if (fn === "water" && count >= 1 + Math.floor(w.structures.filter((s) => s.kind === "farm").length / 6)) return "one well is enough for now";
  if (fn === "shelter" && count * (STRUCTURES[kind].capacity ?? 2) >= alive + 2) return "there are already enough houses";
  if (fn === "farm" && count >= alive + 2) return "there are already plenty of farms";
  return null;
}
