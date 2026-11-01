// Builds the per-call user message: a compact snapshot of what this villager knows.

import { DAYS_PER_YEAR, DISCOVERIES, STRUCTURES, type Villager, type WorldState } from "@idle-sim/shared";
import { describeTime } from "../../sim/clock.ts";
import { askableNow, currentProposal, describeAsk } from "../../sim/petitions.ts";
import { hasStorehouse, householdOf, householdStock, remainingCost } from "../../sim/stock.ts";
import { countResourceTiles, distance, hasCoast, structuresWithFunction, villageStock } from "../../sim/world.ts";

function describeGoal(v: Villager): string {
  const g = v.goal;
  if (!g) return "nothing";
  switch (g.type) {
    case "gather":
      return g.resource === "food" ? "foraging" : `gathering ${g.resource}`;
    case "build":
      return g.phase === "working" ? "building" : "bringing materials to a blueprint";
    case "donate":
      return "taking surplus to the storehouse";
    case "trade":
      return g.side === "sell" ? `selling ${g.resource} at the stall` : `buying ${g.resource} at the stall`;
    case "journey":
      return "setting out on a journey";
    case "socialize_at":
      return "sitting by the fire";
    case "fish":
      return "fishing";
    case "hunt":
      return "out hunting";
    case "tame":
      return "wrangling a goat";
    case "mine":
      return "working the mine";
    case "talk_to":
      return "looking for someone to talk to";
    default:
      return g.type.replace("_", " ");
  }
}

export function relationWord(score: number): string {
  if (score >= 40) return "close friend";
  if (score >= 15) return "friend";
  if (score <= -15) return "rival";
  return "acquaintance";
}

/** What travellers have brought home, and who is away now. */
function knownLine(w: WorldState): string {
  const known = (w.discoveries ?? []).map((d) => DISCOVERIES[d.effect].name);
  const away = w.villagers.filter((v) => v.alive && v.away).map((v) => v.name);
  const parts = [known.length ? `The village has learned: ${known.join(", ")}.` : "Nobody has yet brought anything new home from beyond the hills.", away.length ? `Away on a journey: ${away.join(", ")}.` : ""];
  return parts.filter(Boolean).join(" ");
}

function stockLine(inv: Partial<Record<string, number>>): string {
  const parts = Object.entries(inv).filter(([, n]) => n).map(([k, n]) => `${n} ${k}`);
  return parts.length ? parts.join(", ") : "nothing";
}

/** Partner, parents, children: the people who matter most. */
function familyLine(w: WorldState, v: Villager): string {
  const name = (id: string) => w.villagers.find((x) => x.id === id)?.name ?? "someone";
  const parts: string[] = [];
  if (v.partnerId) parts.push(`partner ${name(v.partnerId)}`);
  if (v.parentIds?.length) parts.push(`child of ${v.parentIds.map(name).join(" and ")}`);
  const children = w.villagers.filter((o) => o.alive && o.parentIds?.includes(v.id)).map((o) => o.name);
  if (children.length) parts.push(`parent of ${children.join(", ")}`);
  return parts.length ? parts.join("; ") : "none";
}

/** The two or three people this villager feels most strongly about. */
function bondsLine(w: WorldState, v: Villager): string {
  const bonds = Object.entries(v.relationships)
    .map(([id, score]) => ({ o: w.villagers.find((x) => x.id === id && x.alive), score }))
    .filter((b): b is { o: Villager; score: number } => !!b.o && Math.abs(b.score) >= 15)
    .sort((a, b) => Math.abs(b.score) - Math.abs(a.score))
    .slice(0, 3)
    .map((b) => `${b.o.name} (${relationWord(b.score)})`);
  return bonds.length ? bonds.join(", ") : "no strong bonds yet";
}

function rumorsSection(w: WorldState): string {
  const c = w.clock;
  const rumors = w.rumors
    .filter((r) => c.tick - r.tick < c.ticksPerDay * 2)
    .map((r) => `- ${r.source === "news" ? "(a traveller's tale) " : ""}${r.text}`)
    .join("\n");
  return rumors ? `\n## Rumors going round\n${rumors}` : "";
}

/** The user message for a conversation between two villagers who have just met. */
export function buildConversePrompt(w: WorldState, a: Villager, b: Villager): string {
  const c = w.clock;
  const s = villageStock(w);
  const who = (v: Villager, other: Villager) =>
    `${v.name}: ${v.stage}, ${v.skill}. Traits: ${v.traits.join(", ")}. Quirk: ${v.quirk}. Hunger ${Math.round(v.needs.hunger)}, energy ${Math.round(v.needs.energy)}, social ${Math.round(v.needs.social)}. Owns ${stockLine(v.stock)}${v.coins ? `, ${v.coins} coin` : ""}. Was ${describeGoal(v)}. Thinks of ${other.name} as a ${relationWord(v.relationships[other.id] ?? 0)}. Family: ${familyLine(w, v)}.
  Remembers: ${v.memory.slice(-5).join(" / ") || "nothing in particular"}`;
  const events = w.events
    .slice(-5)
    .map((e) => `- ${e.text}`)
    .join("\n");
  return `## A conversation
${a.name} has come over to talk to ${b.name}. Day ${c.dayOfSeason + 1} of ${c.season}, year ${c.year + 1}, ${describeTime(c)}, ${c.weather}. The village owns between them ${s.wood} wood, ${s.stone} stone, ${s.food} food, ${s.seeds} seeds.

${who(a, b)}
${who(b, a)}

## Recent happenings
${events || "- quiet"}${rumorsSection(w)}

Write their exchange: two to four lines, ${a.name} speaks first, alternating. Use the names "${a.name}" and "${b.name}" as speakers.`;
}

export function buildVillagerPrompt(w: WorldState, v: Villager): string {
  const c = w.clock;
  const alive = w.villagers.filter((x) => x.alive && !x.away);
  const years = Math.floor(v.ageDays / DAYS_PER_YEAR);
  const s = villageStock(w);
  const household = householdStock(w, v);
  const mates = householdOf(w, v).filter((o) => o.id !== v.id).map((o) => o.name);
  const ownLine = `You own: ${stockLine(v.stock)}; ${v.coins} coin.${mates.length ? ` With your household (${mates.join(", ")}): ${stockLine(household)}.` : ""}`;
  const storeLine = hasStorehouse(w) ? `Common store: ${stockLine(w.storehouse)}.` : "No storehouse yet: everyone keeps their own bundle at the camp.";
  const market = structuresWithFunction(w, "market")[0];
  const marketLine = market ? `Market stall: ${stockLine(market.goods ?? {})} for sale; ${market.till ?? 0} coin in the till.` : "No market stall yet.";
  const merchantLine = w.merchant
    ? w.merchant.phase === "trading"
      ? "A travelling merchant is at the stall right now."
      : w.merchant.phase === "arriving"
        ? "A travelling merchant is coming down the north road."
        : ""
    : "";
  const blueprints = w.structures
    .filter((x) => !x.built)
    .map((x) => {
      const need = remainingCost(x, STRUCTURES[x.kind].cost);
      const list = Object.entries(need).map(([k, n]) => `${n} ${k}`).join(", ");
      return `${STRUCTURES[x.kind].label.toLowerCase()} blueprint ${list ? `still needs ${list}` : `has all its materials, ${Math.round(x.progress * 100)}% built`}`;
    })
    .join("; ");

  const buildings = Object.entries(STRUCTURES)
    .map(([kind, def]) => {
      const built = w.structures.filter((x) => x.kind === kind && x.built && !x.hidden).length;
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
  const wild = w.animals.filter((a) => a.alive && !a.tame);
  const deer = wild.filter((a) => a.kind === "deer").length;
  const goats = wild.filter((a) => a.kind === "goat").length;
  const pen = structuresWithFunction(w, "livestock")[0];
  const herd = pen ? w.animals.filter((a) => a.alive && a.penId === pen.id).length : 0;
  const mineShaft = structuresWithFunction(w, "mining")[0];
  const landParts = [
    hasCoast(w) ? `Coast: yes (${structuresWithFunction(w, "fishing").length ? "dock built" : "no dock yet"}).` : "Coast: none.",
    `Wild game about: ${deer} deer, ${goats} goats.`,
    pen ? `Pen: ${herd} goat${herd === 1 ? "" : "s"}.` : "",
    mineShaft ? (mineShaft.depleted ? "Mine: worked out." : `Mine: ${mineShaft.reserve?.stone ?? 0} stone and ${mineShaft.reserve?.ore ?? 0} ore left in the vein.`) : "",
  ];
  const landNote = landParts.filter(Boolean).join(" ");
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

  const mine = w.petitions.filter((p) => p.villagerId === v.id).slice(-1)[0];
  const petitionLine = mine
    ? `Your last petition (${mine.ask}${mine.amount ? ` x${mine.amount}` : ""}) is ${mine.status}${mine.response ? `; the provider whispered: "${mine.response}"` : ""}.`
    : "You have never petitioned the shrine.";
  const openPetitions = w.petitions.filter((p) => p.status === "open");
  const openCount = openPetitions.length;
  const proposal = currentProposal(w);
  const shortages = proposal ? [] : askableNow(w).filter((a) => a !== "newcomer" && a !== "blessing");
  let shrineNote = "";
  if (proposal) {
    const mineAlready = proposal.supporters.includes(v.id);
    const who = proposal.supporters.map((id) => w.villagers.find((x) => x.id === id)?.name ?? "someone").join(", ");
    shrineNote += `\n## Shrine\n${proposal.villagerName} has called a gathering to ask the provider for ${describeAsk(proposal)}: "${proposal.reason}". Standing there now: ${who} (${proposal.supporters.length} of ${proposal.needed} voices needed).` +
      (mineAlready ? " You are already among them." : " You may go and support it (action support) or stay away if you disagree.");
  }
  if (shortages.length) {
    shrineNote += `\n## Shrine\nThe village has been short of ${shortages.join(" and ")} for a while and the land offers no way to get more. Asking the provider is possible now, if you judge it right.`;
  }

  return `## You
${v.name}, ${v.stage}, ${years} years old. Traits: ${v.traits.join(", ")}. Quirk: ${v.quirk}. Skill: ${v.skill}.
Needs: hunger ${Math.round(v.needs.hunger)}, energy ${Math.round(v.needs.energy)}, social ${Math.round(v.needs.social)}, warmth ${Math.round(v.needs.warmth)}.
Carrying: ${stockLine(v.inventory)}. ${ownLine} Home: ${v.homeId ? "yes" : "none (sleeping at the camp)"}. Family: ${familyLine(w, v)}. Bonds: ${bondsLine(w, v)}.
Currently: ${describeGoal(v)}${v.source === "autopilot" ? " (out of habit)" : ""}.

## Now
Day ${c.dayOfSeason + 1} of ${c.season}, year ${c.year + 1}, ${describeTime(c)}${c.isNight ? " (night)" : ""}. Weather: ${c.weather}.

## The village
${alive.length} villagers: ${others}. ${homeless} without a home.
Between everyone the village owns ${s.wood} wood, ${s.stone} stone, ${s.food} food, ${s.seeds} seeds, ${s.ore} ore. ${storeLine} ${marketLine} ${merchantLine}
Buildings: ${buildings || "only the camp"}. ${blueprints ? `Blueprints: ${blueprints}.` : ""} ${farmNote}
Shrine: ${structuresWithFunction(w, "petition").length ? "found; petitions are possible." : "none found yet. Somewhere out in the land there may be old things worth finding."}
${knownLine(w)}
Forest: ${countResourceTiles(w, "forest") > 0 ? "yes" : "none left"}. Rock to quarry: ${countResourceTiles(w, "rock") > 0 ? "yes" : "none left"}. ${landNote}
Near you: ${nearby || "nobody"}.
Open petitions at the shrine: ${openCount}. ${petitionLine}${shrineNote}

## Recent happenings
${events || "- quiet"}
${rumorsSection(w)}

## Your memories
${memories}

Decide what ${v.name} does next.`;
}
