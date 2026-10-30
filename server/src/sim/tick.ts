// Advances the world by exactly one tick. Pure function of world state + its RNG,
// so the same seed always produces the same history.

import { TICKS_PER_DAY, TICKS_PER_SECOND, type WorldState } from "@idle-sim/shared";
import { chooseGoal } from "./autopilot.ts";
import { updateClock } from "./clock.ts";
import { emitEvent } from "./events.ts";
import { stepGoal } from "./goals/index.ts";
import { lapseStaleProposals, updateShortages } from "./petitions.ts";
import { tickAnimals } from "./animals.ts";
import { tickConversations } from "./conversation.ts";
import { dailyPopulation, trackExposure } from "./population.ts";
import { ageOneDay, moveAlongPath, updateNeeds } from "./villager.ts";
import { assignHomes, distance, structureCenter, structuresWithFunction } from "./world.ts";

const FAIL_COOLDOWN_TICKS = 60 * TICKS_PER_SECOND;

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
  tickAnimals(w, newDay);
  updateShortages(w);
  lapseStaleProposals(w);
  if (newDay) assignHomes(w);
  if (newDay) dailyPopulation(w, opts.populationMax ?? 12);
  tickConversations(w);

  for (const v of w.villagers) {
    if (!v.alive) continue;
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
