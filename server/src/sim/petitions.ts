// Petitions, gifts and rumors: the loop between villagers and the unseen provider.

import {
  MAX_OPEN_PETITIONS,
  MAX_OPEN_PER_VILLAGER,
  PETITION_NEED_THRESHOLD,
  type Petition,
  type PetitionAsk,
  type PetitionRequest,
  type Villager,
  type WorldState,
} from "@idle-sim/shared";
import { emitEvent } from "./events.ts";
import { createVillager, remember, say, type Persona } from "./villager.ts";
import { assignHomes, distance, isWalkable, structuresWithFunction, villageCenter } from "./world.ts";
import { randInt } from "./rng.ts";

const RESOURCE_ASKS = ["wood", "stone", "food", "seeds"] as const;
type ResourceAsk = (typeof RESOURCE_ASKS)[number];

function isResourceAsk(a: PetitionAsk): a is ResourceAsk {
  return (RESOURCE_ASKS as readonly string[]).includes(a);
}

/** Returns a reason the petition is not allowed, or null if it is fine. */
export function canPetition(w: WorldState, v: Villager, req: PetitionRequest): string | null {
  if (structuresWithFunction(w, "petition").length === 0) return "there is no shrine";
  const open = w.petitions.filter((p) => p.status === "open");
  if (open.length >= MAX_OPEN_PETITIONS) return "the shrine already has enough open requests";
  if (open.filter((p) => p.villagerId === v.id).length >= MAX_OPEN_PER_VILLAGER) return "you already have a request waiting";
  const same = open.find((p) => p.ask === req.ask);
  if (same) return `${same.villagerName} has already asked for ${req.ask}`;
  if (isResourceAsk(req.ask)) {
    if (w.storehouse[req.ask] >= PETITION_NEED_THRESHOLD[req.ask]) return `the village still has enough ${req.ask}`;
    if (req.amount !== null && (req.amount < 1 || req.amount > 30)) return "ask for between 1 and 30 units";
  } else if (req.ask === "newcomer") {
    const houses = structuresWithFunction(w, "shelter");
    const beds = houses.reduce((n, h) => n + (2 - h.ownerIds.length), 0);
    if (beds <= 0) return "there is no spare bed for a newcomer";
  }
  return null;
}

export function openPetition(w: WorldState, v: Villager, req: { ask: PetitionAsk; amount?: number; reason: string }): Petition {
  const amount = isResourceAsk(req.ask) ? (req.amount ?? 10) : null;
  const p: Petition = {
    id: `p${w.nextId++}`,
    villagerId: v.id,
    villagerName: v.name,
    ask: req.ask,
    amount,
    reason: req.reason.slice(0, 200),
    tick: w.clock.tick,
    status: "open",
  };
  w.petitions.push(p);
  if (w.petitions.length > 50) w.petitions.splice(0, w.petitions.length - 50);
  const what = amount ? `${amount} ${req.ask}` : req.ask === "newcomer" ? "another pair of hands" : "a blessing";
  emitEvent(w, "petition", `${v.name} kneels at the shrine and asks for ${what}: "${p.reason}"`, { villagerIds: [v.id] });
  remember(v, `I asked the provider for ${what}.`);
  return p;
}

export interface GrantOptions {
  amount?: number;
  message?: string;
  /** Persona for a newcomer, when the ask was "newcomer". */
  newcomer?: Persona;
}

export function grantPetition(w: WorldState, id: string, opts: GrantOptions = {}): string | null {
  const p = w.petitions.find((x) => x.id === id);
  if (!p) return "no such petition";
  if (p.status !== "open") return "petition already resolved";
  const amount = isResourceAsk(p.ask) ? Math.max(0, Math.floor(opts.amount ?? p.amount ?? 10)) : undefined;
  p.status = "granted";
  p.grantedAmount = amount;
  p.response = opts.message?.slice(0, 200);
  p.resolvedTick = w.clock.tick;

  const petitioner = w.villagers.find((v) => v.id === p.villagerId && v.alive);
  const partial = amount !== undefined && p.amount !== null && amount < p.amount;
  deliverGift(w, p.ask, amount, opts.newcomer);

  if (petitioner) {
    const what = amount !== undefined ? `${amount} ${p.ask}` : p.ask;
    remember(petitioner, partial ? `The provider sent ${what}, less than I asked, but something.` : `The provider answered my plea for ${what}.`);
    say(w, petitioner, partial ? "Something is better than nothing. Thank you." : "The provider heard me!", 8);
    if (p.response) remember(petitioner, `The provider whispered: "${p.response}"`);
    for (const o of w.villagers) {
      if (o.alive && o.id !== petitioner.id && distance(o.pos, petitioner.pos) < 8) remember(o, `${petitioner.name}'s prayer at the shrine was answered.`);
    }
  }
  return null;
}

export function denyPetition(w: WorldState, id: string, message?: string): string | null {
  const p = w.petitions.find((x) => x.id === id);
  if (!p) return "no such petition";
  if (p.status !== "open") return "petition already resolved";
  p.status = "denied";
  p.response = message?.slice(0, 200);
  p.resolvedTick = w.clock.tick;
  const petitioner = w.villagers.find((v) => v.id === p.villagerId && v.alive);
  emitEvent(w, "petition_denied", `The shrine stays silent to ${p.villagerName}'s request.`, { villagerIds: [p.villagerId] });
  if (petitioner) {
    remember(petitioner, `The provider was silent when I asked for ${p.ask}.`);
    if (p.response) {
      remember(petitioner, `The provider whispered: "${p.response}"`);
      say(w, petitioner, `A whisper: "${p.response.slice(0, 90)}"`, 8);
    }
  }
  return null;
}

/** A gift from the provider, prompted or not. */
export function deliverGift(w: WorldState, ask: PetitionAsk, amount?: number, newcomer?: Persona): void {
  if (isResourceAsk(ask)) {
    const n = Math.max(0, Math.floor(amount ?? 10));
    if (n === 0) return;
    w.storehouse[ask] += n;
    const store = structuresWithFunction(w, "storage")[0];
    emitEvent(w, "gift", `A crate holding ${n} ${ask} appeared beside the storehouse overnight.`, store ? { pos: { x: store.x, y: store.y } } : {});
    return;
  }
  if (ask === "blessing") {
    for (const v of w.villagers) {
      if (!v.alive) continue;
      v.needs.social = Math.min(100, v.needs.social + 25);
      v.needs.warmth = Math.min(100, v.needs.warmth + 25);
      v.needs.energy = Math.min(100, v.needs.energy + 15);
      remember(v, "A gentle warmth settled over the village, as if someone were watching kindly.");
    }
    emitEvent(w, "blessing", "A gentle warmth settles over the village.");
    return;
  }
  if (ask === "newcomer") {
    if (!newcomer) {
      emitEvent(w, "gift", "A traveller was seen on the road, but passed by.");
      return;
    }
    const c = villageCenter(w);
    let tile = { x: 1, y: Math.floor(w.height / 2) };
    for (let i = 0; i < 60; i++) {
      const cand = { x: randInt(w, 1, w.width - 2), y: randInt(w, 1, 3) };
      if (isWalkable(w, cand.x, cand.y)) {
        tile = cand;
        break;
      }
    }
    const v = createVillager(w, newcomer, tile);
    v.goal = { type: "wander", target: { x: c.x, y: c.y + 2 } };
    v.goalStartedTick = w.clock.tick;
    remember(v, "I came to this village because something called me here.");
    w.villagers.push(v);
    assignHomes(w);
    emitEvent(w, "arrival", `A stranger arrives from the north road: ${v.name}, a ${v.skill}.`, { villagerIds: [v.id], pos: tile });
  }
}

export function addRumor(w: WorldState, text: string): void {
  const clean = text.trim().slice(0, 240);
  if (!clean) return;
  w.rumors.push({ text: clean, tick: w.clock.tick });
  if (w.rumors.length > 5) w.rumors.splice(0, w.rumors.length - 5);
  emitEvent(w, "rumor", `Word goes round the village: "${clean}"`);
}
