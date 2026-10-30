// Petitions, gifts and rumors: the loop between villagers and the unseen provider.

import {
  MAX_OPEN_PETITIONS,
  MAX_OPEN_PER_VILLAGER,
  MIN_SUPPORTERS,
  PETITION_COOLDOWN_DAYS,
  PETITION_NEED_THRESHOLD,
  PROPOSAL_DAYS,
  SHORTAGE_DAYS_BEFORE_PETITION,
  type Petition,
  type PetitionAsk,
  type PetitionRequest,
  type Villager,
  type WorldState,
} from "@idle-sim/shared";
import { emitEvent } from "./events.ts";
import { arrive } from "./population.ts";
import { remember, say, type Persona } from "./villager.ts";
import { countResourceTiles, distance, hasCoast, structuresWithFunction } from "./world.ts";

const RESOURCE_ASKS = ["wood", "stone", "food", "seeds"] as const;
type ResourceAsk = (typeof RESOURCE_ASKS)[number];

function isResourceAsk(a: PetitionAsk): a is ResourceAsk {
  return (RESOURCE_ASKS as readonly string[]).includes(a);
}

/** Is the village actually short of this right now? Used by autopilot and validation alike. */
export function villageLacks(w: WorldState, ask: PetitionAsk): boolean {
  if (isResourceAsk(ask)) return w.storehouse[ask] < PETITION_NEED_THRESHOLD[ask];
  if (ask === "newcomer") {
    const beds = structuresWithFunction(w, "shelter").reduce((n, h) => n + (2 - h.ownerIds.length), 0);
    return beds > 0 && w.villagers.filter((v) => v.alive).length < 5;
  }
  return w.clock.season === "winter" || w.clock.weather === "storm"; // a blessing is for hard times
}

/** Track how long each resource has been short. Call once per tick. */
export function updateShortages(w: WorldState): void {
  for (const k of RESOURCE_ASKS) {
    if (w.storehouse[k] < PETITION_NEED_THRESHOLD[k]) w.shortageSince[k] ??= w.clock.tick;
    else delete w.shortageSince[k];
  }
}

/**
 * The land is supposed to provide. A resource may only be asked for when the
 * village has been short for a while AND has no way left to get it itself.
 */
export function landCannotProvide(w: WorldState, ask: ResourceAsk): string | null {
  switch (ask) {
    case "wood":
      return countResourceTiles(w, "forest") > 0 ? "there are still trees to cut" : null;
    case "stone": {
      const mine = structuresWithFunction(w, "mining").some((m) => !m.depleted && (m.reserve?.stone ?? 0) > 0);
      if (mine) return "the mine still has stone in it";
      return countResourceTiles(w, "rock") > 0 ? "there is still rock to quarry" : null;
    }
    case "food": {
      if (hasCoast(w)) return "the sea is full of fish";
      if (w.animals.some((a) => a.alive && !a.tame)) return "there is game to hunt";
      if (structuresWithFunction(w, "farm").some((f) => f.growth !== undefined)) return "crops are still growing";
      return null;
    }
    case "seeds":
      if (structuresWithFunction(w, "farm").some((f) => f.growth !== undefined)) return "a growing farm will yield seeds at harvest";
      return null;
  }
}

/** Ticks since the last petition opened or lapsed; petitions are rare by design. */
function petitionCooldownLeft(w: WorldState): number {
  let last = -Infinity;
  for (const p of w.petitions) {
    const t = p.status === "proposed" ? -Infinity : (p.resolvedTick ?? p.tick);
    if (t > last) last = t;
    if (p.status === "open" && p.tick > last) last = p.tick;
  }
  const cooldown = PETITION_COOLDOWN_DAYS * w.clock.ticksPerDay;
  return Math.max(0, last + cooldown - w.clock.tick);
}

/** Why the village as a whole may not ask for this right now, or null if it may. */
export function villageMayAsk(w: WorldState, ask: PetitionAsk): string | null {
  const pending = w.petitions.filter((p) => p.status === "open" || p.status === "proposed");
  if (pending.some((p) => p.status === "proposed")) return "a gathering is already being called at the shrine; support it or wait";
  if (pending.length >= MAX_OPEN_PETITIONS) return "the shrine already has enough requests waiting";
  const same = pending.find((p) => p.ask === ask);
  if (same) return `${same.villagerName} has already asked for ${ask}`;
  const cooldownTicks = petitionCooldownLeft(w);
  if (cooldownTicks > 0) return `the provider was asked recently; wait ${Math.ceil(cooldownTicks / w.clock.ticksPerDay)} more day(s)`;
  if (isResourceAsk(ask)) {
    if (!villageLacks(w, ask)) return `the village still has enough ${ask}`;
    const since = w.shortageSince[ask];
    const lasted = since === undefined ? 0 : w.clock.tick - since;
    if (lasted < SHORTAGE_DAYS_BEFORE_PETITION * w.clock.ticksPerDay) return `the ${ask} shortage is too recent; try to fix it first`;
    const why = landCannotProvide(w, ask);
    if (why) return why;
  } else if (!villageLacks(w, ask)) {
    return ask === "newcomer" ? "there is no room or need for a newcomer" : "these are not hard times";
  }
  return null;
}

/** Asks the village could legitimately make right now (for the prompt's shrine hint). */
export function askableNow(w: WorldState): PetitionAsk[] {
  return (["wood", "stone", "food", "seeds", "newcomer", "blessing"] as PetitionAsk[]).filter((a) => villageMayAsk(w, a) === null);
}

/** Returns a reason the petition is not allowed, or null if it is fine. */
export function canPetition(w: WorldState, v: Villager, req: PetitionRequest): string | null {
  if (structuresWithFunction(w, "petition").length === 0) return "there is no shrine";
  const pending = w.petitions.filter((p) => p.status === "open" || p.status === "proposed");
  if (pending.filter((p) => p.villagerId === v.id).length >= MAX_OPEN_PER_VILLAGER) return "you already have a request waiting";
  const village = villageMayAsk(w, req.ask);
  if (village) return village;
  if (isResourceAsk(req.ask) && req.amount !== null && (req.amount < 1 || req.amount > 30)) return "ask for between 1 and 30 units";
  return null;
}

/** Voices needed for a proposal to open: at least MIN_SUPPORTERS, at least half the village, never more than everyone. */
export function supportNeeded(w: WorldState): number {
  const alive = w.villagers.filter((v) => v.alive).length;
  return Math.max(1, Math.min(alive, Math.max(MIN_SUPPORTERS, Math.ceil(alive / 2))));
}

export function currentProposal(w: WorldState): Petition | undefined {
  return w.petitions.find((p) => p.status === "proposed");
}

export function describeAsk(p: { ask: PetitionAsk; amount: number | null }): string {
  return p.amount ? `${p.amount} ${p.ask}` : p.ask === "newcomer" ? "another pair of hands" : "a blessing";
}

/** A villager proposes a petition at the shrine. It opens only once enough villagers gather to support it. */
export function proposePetition(w: WorldState, v: Villager, req: { ask: PetitionAsk; amount?: number; reason: string }): Petition {
  const amount = isResourceAsk(req.ask) ? (req.amount ?? 10) : null;
  const needed = supportNeeded(w);
  const p: Petition = {
    id: `p${w.nextId++}`,
    villagerId: v.id,
    villagerName: v.name,
    ask: req.ask,
    amount,
    reason: req.reason.slice(0, 200),
    tick: w.clock.tick,
    status: "proposed",
    supporters: [v.id],
    needed,
    expiresTick: w.clock.tick + PROPOSAL_DAYS * w.clock.ticksPerDay,
  };
  w.petitions.push(p);
  if (w.petitions.length > 50) w.petitions.splice(0, w.petitions.length - 50);
  const what = describeAsk(p);
  if (needed <= 1) {
    openPetition(w, p);
  } else {
    emitEvent(w, "proposal", `${v.name} calls the village to the shrine to ask for ${what}: "${p.reason}"`, { villagerIds: [v.id] });
    remember(v, `I called a gathering at the shrine to ask for ${what}.`);
  }
  return p;
}

/** Another villager arrives at the shrine to back the proposal. Returns true if that opened it. */
export function supportPetition(w: WorldState, v: Villager, id: string): boolean {
  const p = w.petitions.find((x) => x.id === id);
  if (!p || p.status !== "proposed" || p.supporters.includes(v.id)) return false;
  p.supporters.push(v.id);
  remember(v, `I stood with ${p.villagerName} at the shrine asking for ${describeAsk(p)}.`);
  if (p.supporters.length >= p.needed) {
    openPetition(w, p);
    return true;
  }
  emitEvent(w, "support", `${v.name} joins ${p.villagerName} at the shrine (${p.supporters.length} of ${p.needed} voices).`, { villagerIds: [v.id] });
  return false;
}

function openPetition(w: WorldState, p: Petition): void {
  p.status = "open";
  const names = p.supporters.map((id) => w.villagers.find((v) => v.id === id)?.name ?? "someone");
  const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0];
  emitEvent(w, "petition", `${list} gather at the shrine and ask the provider for ${describeAsk(p)}: "${p.reason}"`, { villagerIds: p.supporters });
  for (const id of p.supporters) {
    const v = w.villagers.find((x) => x.id === id && x.alive);
    if (v) remember(v, `We gathered at the shrine and asked the provider for ${describeAsk(p)}.`);
  }
}

/** Proposals nobody joined in time break up. Call once per tick. */
export function lapseStaleProposals(w: WorldState): void {
  for (const p of w.petitions) {
    if (p.status !== "proposed" || w.clock.tick < p.expiresTick) continue;
    p.status = "lapsed";
    p.resolvedTick = w.clock.tick;
    emitEvent(w, "lapsed", `The gathering ${p.villagerName} called at the shrine breaks up; too few came.`, { villagerIds: [p.villagerId] });
    const v = w.villagers.find((x) => x.id === p.villagerId && x.alive);
    if (v) remember(v, `Nobody came when I called the village to the shrine for ${describeAsk(p)}.`);
  }
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
  if (p.status === "proposed") return "the village has not gathered for this yet";
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
      if (!o.alive || o.id === petitioner.id) continue;
      if (p.supporters.includes(o.id)) remember(o, `The provider answered what we asked for together at the shrine.`);
      else if (distance(o.pos, petitioner.pos) < 8) remember(o, `${petitioner.name}'s prayer at the shrine was answered.`);
    }
  }
  return null;
}

export function denyPetition(w: WorldState, id: string, message?: string): string | null {
  const p = w.petitions.find((x) => x.id === id);
  if (!p) return "no such petition";
  if (p.status === "proposed") return "the village has not gathered for this yet";
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
    const v = arrive(w, newcomer);
    remember(v, "I came to this village because something called me here.");
  }
}

export function addRumor(w: WorldState, text: string, source: "whisper" | "news" = "whisper"): void {
  const clean = text.trim().slice(0, 240);
  if (!clean) return;
  w.rumors.push({ text: clean, tick: w.clock.tick, source });
  if (w.rumors.length > 5) w.rumors.splice(0, w.rumors.length - 5);
  emitEvent(w, source === "news" ? "news" : "rumor", source === "news" ? `A traveller passing through says: "${clean}"` : `Word goes round the village: "${clean}"`);
}
