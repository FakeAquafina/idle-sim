// Turns Claude's answer into a real goal, refusing anything the world can't support.
// Pure game logic: no network, easy to test.

import {
  STRUCTURES,
  type Goal,
  type PlanOutput,
  type Villager,
  type WorldState,
} from "@idle-sim/shared";
import { emitEvent } from "../sim/events.ts";
import { canPetition, currentProposal } from "../sim/petitions.ts";
import { canAfford, countResourceTiles, findPlacement, placeStructure, structuresWithFunction, villageCenter } from "../sim/world.ts";

export interface ApplyResult {
  goal: Goal | null;
  /** Why the plan was rejected, when goal is null. */
  reason?: string;
}

export function planToGoal(w: WorldState, v: Villager, plan: PlanOutput): ApplyResult {
  const tick = w.clock.tick;
  const fire = structuresWithFunction(w, "social")[0];
  const store = structuresWithFunction(w, "storage")[0];

  switch (plan.action) {
    case "wander":
      return { goal: null, reason: "wander handled by autopilot" };

    case "rest":
      return { goal: { type: "rest", structureId: v.homeId ?? fire?.id } };

    case "eat":
      if (!store || w.storehouse.food <= 0) return { goal: null, reason: "no food in the storehouse" };
      return { goal: { type: "eat" } };

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

    case "farm": {
      if (v.stage === "child") return { goal: null, reason: "children don't farm" };
      const farms = structuresWithFunction(w, "farm");
      const pick =
        farms.find((f) => (f.growth ?? 0) >= 1) ??
        (w.storehouse.seeds > 0 && w.clock.season !== "winter" ? farms.find((f) => f.growth === undefined) : undefined) ??
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
      if (!canAfford(w, STRUCTURES[kind].cost)) return { goal: null, reason: `not enough materials for a ${kind}` };
      const spot = findPlacement(w, kind, villageCenter(w));
      if (!spot) return { goal: null, reason: "no room to build" };
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

/** One-of-a-kind buildings, and sensible ceilings for the rest. */
function tooManyOfKind(w: WorldState, kind: string): string | null {
  const count = w.structures.filter((s) => s.kind === kind).length;
  const alive = w.villagers.filter((v) => v.alive).length;
  const fn = STRUCTURES[kind].function;
  if ((fn === "storage" || fn === "social" || fn === "petition") && count >= 1) return `the village already has a ${kind}`;
  if (fn === "water" && count >= 1 + Math.floor(w.structures.filter((s) => s.kind === "farm").length / 6)) return "one well is enough for now";
  if (fn === "shelter" && count * (STRUCTURES[kind].capacity ?? 2) >= alive + 2) return "there are already enough houses";
  if (fn === "farm" && count >= alive + 2) return "there are already plenty of farms";
  return null;
}
