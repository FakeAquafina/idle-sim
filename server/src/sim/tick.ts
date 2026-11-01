// Advances the world by exactly one tick. Pure function of world state + its RNG,
// so the same seed always produces the same history.

import { DISCOVERY_RADIUS, STRUCTURES, TICKS_PER_DAY, TICKS_PER_SECOND, type WorldState } from "@idle-sim/shared";
import { chooseGoal } from "./autopilot.ts";
import { updateClock } from "./clock.ts";
import { emitEvent } from "./events.ts";
import { stepGoal } from "./goals/index.ts";
import { lapseStaleProposals, updateShortages } from "./petitions.ts";
import { tickAnimals } from "./animals.ts";
import { tickConversations } from "./conversation.ts";
import { tickMerchant } from "./merchant.ts";
import { tickJourneys } from "./journey.ts";
import { remember, say } from "./villager.ts";
import { dailyPopulation, trackExposure } from "./population.ts";
import { ageOneDay, moveAlongPath, updateNeeds, villagerTile } from "./villager.ts";
import { chance, randInt } from "./rng.ts";
import { assignHomes, distance, inBounds, setTile, structureCenter, structuresWithFunction, tileAt } from "./world.ts";

const FAIL_COOLDOWN_TICKS = 60 * TICKS_PER_SECOND;
/** How often the land is checked for new growth (eight times a sim day). */
const REGROW_EVERY = Math.floor(TICKS_PER_DAY / 8);
/** Fullest a regrown forest tile gets. */
const FOREST_FULL = 12;

export interface TickOptions {
  /** No arrivals or births beyond this many living villagers. */
  populationMax?: number;
}

export function tickWorld(w: WorldState, opts: TickOptions = {}): void {
  w.clock.tick++;
  const { newDay, newSeason } = updateClock(w);
  if (newSeason) emitEvent(w, "season", `${capitalize(w.clock.season)} has come to the village.`);
  else if (newDay) emitEvent(w, "day", `Day ${w.clock.dayOfSeason + 1} of ${w.clock.season}, year ${w.clock.year + 1}.`);

  growFarms(w);
  if (w.clock.tick % REGROW_EVERY === 0) regrowForests(w);
  tickAnimals(w, newDay);
  updateShortages(w);
  lapseStaleProposals(w);
  if (newDay) assignHomes(w);
  if (newDay) dailyPopulation(w, opts.populationMax ?? 20);
  tickConversations(w);
  tickMerchant(w);
  tickJourneys(w);
  if (w.clock.tick % 20 === 0) discoverLandmarks(w);

  for (const v of w.villagers) {
    if (!v.alive) continue;
    if (v.away) {
      if (newDay) ageOneDay(v);
      continue; // off the map: no needs, no goals, no walking
    }
    updateNeeds(w, v);
    trackExposure(w, v);
    if (!v.alive) continue;
    if (newDay) ageOneDay(v);

    if (!v.goal) {
      v.goal = chooseGoal(w, v);
      v.goalStartedTick = w.clock.tick;
      v.source = "autopilot";
      v.path = [];
    }
    const result = stepGoal(w, v);
    if (result !== "running") {
      if (result === "failed" && v.goal) v.cooldowns[v.goal.type] = w.clock.tick + FAIL_COOLDOWN_TICKS;
      v.goal = null;
      v.path = [];
    }
    moveAlongPath(v);
    if (v.speech && w.clock.tick > v.speech.untilTick) v.speech = undefined;
  }
}

/**
 * Trees grow back. Standing forest thickens slowly, and in spring and summer it
 * seeds the grass beside it, so a cleared wood returns over a few seasons. The
 * sample is random, so the cost is tiny whatever the map size.
 */
function regrowForests(w: WorldState): void {
  if (w.clock.season === "winter") return;
  const spreading = w.clock.season === "spring" || w.clock.season === "summer";
  const samples = Math.ceil((w.width * w.height) / 12);
  for (let i = 0; i < samples; i++) {
    const x = randInt(w, 0, w.width - 1);
    const y = randInt(w, 0, w.height - 1);
    const t = tileAt(w, x, y);
    if (t.kind === "forest") {
      if (t.amount < FOREST_FULL && chance(w, 0.5)) setTile(w, x, y, { kind: "forest", amount: t.amount + 1 });
      continue;
    }
    if (t.kind !== "grass" || !spreading || !chance(w, 0.12)) continue;
    // A seed only takes beside established trees, and never on the village's doorstep.
    const neighbours = [tileAt(w, x - 1, y), tileAt(w, x + 1, y), tileAt(w, x, y - 1), tileAt(w, x, y + 1)];
    if (!neighbours.some((n, k) => n && inBounds(w, x + [-1, 1, 0, 0][k], y + [0, 0, -1, 1][k]) && n.kind === "forest" && n.amount >= 4)) continue;
    if (w.structures.some((s) => distance({ x, y }, structureCenter(s)) < 5)) continue;
    setTile(w, x, y, { kind: "forest", amount: 1 });
  }
}

/** Hidden landmarks (the old shrine) are found by whoever first wanders close. */
function discoverLandmarks(w: WorldState): void {
  for (const s of w.structures) {
    if (!s.hidden) continue;
    const c = structureCenter(s);
    const finder = w.villagers.find((v) => v.alive && distance(v.pos, c) <= DISCOVERY_RADIUS);
    if (!finder) continue;
    s.hidden = false;
    const label = STRUCTURES[s.kind].label.toLowerCase();
    say(w, finder, "What is this place?", 8);
    remember(finder, `I found an old ${label} standing alone in the land. It felt watched.`);
    for (const o of w.villagers) if (o.alive && o.id !== finder.id) remember(o, `${finder.name} found an old ${label} out beyond the camp.`);
    emitEvent(w, "discovery", `${finder.name} finds an old ${label} standing alone, moss on its stones. The village has a place to speak to the provider now.`, {
      villagerIds: [finder.id],
      pos: villagerTile(finder),
    });
  }
}

/** Crops grow by season and weather; a well nearby helps. */
function growFarms(w: WorldState): void {
  const seasonRate: Record<string, number> = {
    spring: 1 / (2 * TICKS_PER_DAY),
    summer: 1 / (1.5 * TICKS_PER_DAY),
    autumn: 1 / (3 * TICKS_PER_DAY),
    winter: 0,
  };
  const base = seasonRate[w.clock.season] ?? 0;
  if (base === 0) return;
  const weatherMult = w.clock.weather === "rain" ? 1.3 : w.clock.weather === "storm" ? 0.8 : 1;
  const wells = structuresWithFunction(w, "water");
  for (const f of structuresWithFunction(w, "farm")) {
    if (f.growth === undefined || f.growth >= 1) continue;
    const nearWell = wells.some((well) => distance(structureCenter(well), structureCenter(f)) < 7);
    f.growth = Math.min(1, f.growth + base * weatherMult * (nearWell ? 1.25 : 1));
  }
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
