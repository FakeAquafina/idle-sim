// Builds the per-call user message: a compact snapshot of what this villager knows.

import { DAYS_PER_YEAR, PETITION_NEED_THRESHOLD, STRUCTURES, type Villager, type WorldState } from "@idle-sim/shared";
import { describeTime } from "../../sim/clock.ts";
import { countResourceTiles, distance, structuresWithFunction } from "../../sim/world.ts";

function describeGoal(v: Villager): string {
  const g = v.goal;
  if (!g) return "nothing";
  switch (g.type) {
    case "gather":
      return `gathering ${g.resource}`;
    case "build":
      return "working on a blueprint";
    case "socialize_at":
      return "sitting by the fire";
    case "talk_to":
      return "looking for someone to talk to";
    default:
      return g.type.replace("_", " ");
  }
}

function relationWord(score: number): string {
  if (score >= 40) return "close friend";
  if (score >= 15) return "friend";
  if (score <= -15) return "rival";
  return "acquaintance";
}

export function buildVillagerPrompt(w: WorldState, v: Villager): string {
  const c = w.clock;
  const alive = w.villagers.filter((x) => x.alive);
  const years = Math.floor(v.ageDays / DAYS_PER_YEAR);
  const s = w.storehouse;

  const buildings = Object.entries(STRUCTURES)
    .map(([kind, def]) => {
      const built = w.structures.filter((x) => x.kind === kind && x.built).length;
      const planned = w.structures.filter((x) => x.kind === kind && !x.built);
      if (!built && !planned.length) return null;
      const extra = planned.length ? ` (+${planned.length} blueprint at ${Math.round(planned[0].progress * 100)}%)` : "";
      return `${built} ${def.label.toLowerCase()}${built === 1 ? "" : "s"}${extra}`;
    })
    .filter(Boolean)
    .join(", ");

  const farms = structuresWithFunction(w, "farm");
  const farmNote = farms.length
    ? `Farms: ${farms.filter((f) => (f.growth ?? 0) >= 1).length} ready to harvest, ${farms.filter((f) => f.growth === undefined).length} unplanted, ${farms.filter((f) => f.growth !== undefined && f.growth < 1).length} growing.`
    : "No farms yet.";

  const homeless = alive.filter((x) => !x.homeId).length;
  const nearby = alive
    .filter((o) => o.id !== v.id && distance(o.pos, v.pos) < 8)
    .slice(0, 6)
    .map((o) => `${o.name} (${relationWord(v.relationships[o.id] ?? 0)}, ${describeGoal(o)})`)
    .join("; ");
  const others = alive.filter((o) => o.id !== v.id).map((o) => o.name).join(", ");

  const events = w.events
    .slice(-6)
    .map((e) => `- ${e.text}`)
    .join("\n");
  const memories = v.memory.length ? v.memory.map((m) => `- ${m}`).join("\n") : "- (nothing yet)";
  const rumors = w.rumors
    .filter((r) => c.tick - r.tick < c.ticksPerDay * 2)
    .map((r) => `- ${r.text}`)
    .join("\n");

  const mine = w.petitions.filter((p) => p.villagerId === v.id).slice(-1)[0];
  const petitionLine = mine
    ? `Your last petition (${mine.ask}${mine.amount ? ` x${mine.amount}` : ""}) is ${mine.status}${mine.response ? `; the provider whispered: "${mine.response}"` : ""}.`
    : "You have never petitioned the shrine.";
  const openPetitions = w.petitions.filter((p) => p.status === "open");
  const openCount = openPetitions.length;
  const shortages = (Object.keys(PETITION_NEED_THRESHOLD) as (keyof typeof PETITION_NEED_THRESHOLD)[])
    .filter((k) => s[k] < PETITION_NEED_THRESHOLD[k] && !openPetitions.some((p) => p.ask === k))
    .map((k) => `${k} (${s[k]})`);
  const shrineNote = shortages.length
    ? `\n## Shrine\nThe village is short of ${shortages.join(", ")} and nobody has asked the provider for ${shortages.length > 1 ? "them" : "it"} yet. Someone could go and ask; the rest should keep working.`
    : "";

  return `## You
${v.name}, ${v.stage}, ${years} years old. Traits: ${v.traits.join(", ")}. Quirk: ${v.quirk}. Skill: ${v.skill}.
Needs: hunger ${Math.round(v.needs.hunger)}, energy ${Math.round(v.needs.energy)}, social ${Math.round(v.needs.social)}, warmth ${Math.round(v.needs.warmth)}.
Carrying: ${Object.entries(v.inventory).filter(([, n]) => n).map(([k, n]) => `${n} ${k}`).join(", ") || "nothing"}. Home: ${v.homeId ? "yes" : "none"}.
Currently: ${describeGoal(v)}${v.source === "autopilot" ? " (out of habit)" : ""}.

## Now
Day ${c.dayOfSeason + 1} of ${c.season}, year ${c.year + 1}, ${describeTime(c)}${c.isNight ? " (night)" : ""}. Weather: ${c.weather}.

## The village
${alive.length} villagers: ${others}. ${homeless} without a home.
Storehouse: ${s.wood} wood, ${s.stone} stone, ${s.food} food, ${s.seeds} seeds.
Buildings: ${buildings || "only the camp"}. ${farmNote}
Forest nearby: ${countResourceTiles(w, "forest") > 0 ? "yes" : "none left"}. Rock nearby: ${countResourceTiles(w, "rock") > 0 ? "yes" : "none left"}.
Near you: ${nearby || "nobody"}.
Open petitions at the shrine: ${openCount}. ${petitionLine}${shrineNote}

## Recent happenings
${events || "- quiet"}
${rumors ? `\n## Rumors going round\n${rumors}` : ""}

## Your memories
${memories}

Decide what ${v.name} does next.`;
}
