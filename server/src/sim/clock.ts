import {
  DAYS_PER_SEASON,
  DAYS_PER_YEAR,
  SEASONS,
  TICKS_PER_DAY,
  type Clock,
  type Season,
  type Weather,
  type WorldState,
} from "@idle-sim/shared";
import { nextRandom } from "./rng.ts";

/** Fresh clock starting mid-morning of day 0, spring. */
export function makeClock(): Clock {
  return {
    tick: Math.floor(TICKS_PER_DAY * 0.3),
    ticksPerDay: TICKS_PER_DAY,
    day: 0,
    dayOfSeason: 0,
    season: "spring",
    year: 0,
    weather: "clear",
    timeOfDay: 0.3,
    isNight: false,
  };
}

const WEATHER_ORDER: Weather[] = ["clear", "rain", "storm", "snow"];

/** Probability of each weather per season: [clear, rain, storm, snow]. */
const WEATHER_TABLE: Record<Season, number[]> = {
  spring: [0.5, 0.4, 0.1, 0.0],
  summer: [0.7, 0.15, 0.15, 0.0],
  autumn: [0.45, 0.4, 0.15, 0.0],
  winter: [0.4, 0.05, 0.1, 0.45],
};

function nextWeather(w: WorldState, season: Season, current: Weather): Weather {
  // Half the time the weather simply persists, so it changes in stretches.
  if (nextRandom(w) < 0.5) return current;
  const table = WEATHER_TABLE[season];
  let r = nextRandom(w);
  for (let i = 0; i < table.length; i++) {
    r -= table[i];
    if (r <= 0) return WEATHER_ORDER[i];
  }
  return "clear";
}

/** Derive day/season/time fields from the tick counter. Call once per tick after incrementing. */
export function updateClock(w: WorldState): { newDay: boolean; newSeason: boolean } {
  const c = w.clock;
  const prevDay = c.day;
  const prevSeason = c.season;

  c.day = Math.floor(c.tick / c.ticksPerDay);
  c.timeOfDay = (c.tick % c.ticksPerDay) / c.ticksPerDay;
  c.isNight = c.timeOfDay < 0.22 || c.timeOfDay > 0.88;
  c.season = SEASONS[Math.floor(c.day / DAYS_PER_SEASON) % SEASONS.length];
  c.dayOfSeason = c.day % DAYS_PER_SEASON;
  c.year = Math.floor(c.day / DAYS_PER_YEAR);

  const quarterDay = Math.floor(c.ticksPerDay / 4);
  if (c.tick % quarterDay === 0) c.weather = nextWeather(w, c.season, c.weather);

  return { newDay: c.day !== prevDay, newSeason: c.season !== prevSeason };
}

export function describeTime(c: Clock): string {
  const hour = Math.floor(c.timeOfDay * 24);
  const minute = Math.floor((c.timeOfDay * 24 - hour) * 60);
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}
