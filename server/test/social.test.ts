import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DAYS_PER_YEAR, TICKS_PER_DAY, type WorldState } from "@idle-sim/shared";
import { applySummary } from "../src/brain/memory.ts";
import { fallbackPersona } from "../src/brain/persona.ts";
import { runAdminCommand } from "../src/net/admin.ts";
import { DEFAULT_BLOCKLIST, filterHeadlines, parseFeed } from "../src/news.ts";
import { addChronicleEntry, MAX_CHRONICLE, onChronicle } from "../src/sim/chronicle.ts";
import { beginConversation, fillConversation, inConversation, setMeetHandler, tickConversations } from "../src/sim/conversation.ts";
import { arrive, dailyPopulation, die, EXPOSURE_FATAL_TICKS, giveBirth, trackExposure } from "../src/sim/population.ts";
import { seedVillagers } from "../src/sim/seed.ts";
import { tickWorld } from "../src/sim/tick.ts";
import { tileCenter } from "../src/sim/world.ts";
import type { Persona } from "../src/sim/villager.ts";
import { createWorld, findPlacement, placeStructure, structuresWithFunction, villageCenter } from "../src/sim/world.ts";

const personas = JSON.parse(readFileSync(new URL("../data/villagers.json", import.meta.url), "utf8")) as Persona[];
const pool = JSON.parse(readFileSync(new URL("../data/newcomers.json", import.meta.url), "utf8")) as Persona[];

function world(seed = 44): WorldState {
  const w = createWorld(seed);
  seedVillagers(w, personas);
  for (const v of w.villagers) v.needs.hunger = 100;
  return w;
}

/** Stand two villagers next to each other and have the first go talk to the second. */
function meet(w: WorldState) {
  const [a, b] = w.villagers;
  const fire = structuresWithFunction(w, "social")[0];
  a.pos = tileCenter({ x: fire.x, y: fire.y + 3 });
  b.pos = tileCenter({ x: fire.x + 1, y: fire.y + 3 });
  a.goal = { type: "talk_to", villagerId: b.id, chatted: false };
  a.goalStartedTick = w.clock.tick;
  b.goal = { type: "wander", target: { x: fire.x + 1, y: fire.y + 3 } };
  return [a, b] as const;
}

describe("conversations", () => {
  it("two villagers who meet exchange canned lines and come away a little closer", () => {
    setMeetHandler(null);
    const w = world();
    const [a, b] = meet(w);
    tickWorld(w);
    const c = inConversation(w, a.id);
    expect(c).toBeDefined();
    expect(c!.pending).toBe(false);
    expect(b.goal).toEqual({ type: "talk_to", villagerId: a.id, chatted: true });

    let spoke = 0;
    for (let i = 0; i < 400 && inConversation(w, a.id); i++) {
      tickWorld(w);
      if (a.speech || b.speech) spoke++;
    }
    expect(spoke).toBeGreaterThan(0);
    expect(inConversation(w, a.id)).toBeUndefined();
    expect(a.relationships[b.id]).toBe(2);
    expect(b.relationships[a.id]).toBe(2);
    expect(a.goal?.type === "talk_to").toBe(false); // released
  });

  it("a registered handler can supply the lines later, with tone and memories", () => {
    const w = world();
    let captured: string | null = null;
    setMeetHandler((_w, c) => {
      captured = c.id;
      return true;
    });
    const [a, b] = meet(w);
    tickWorld(w);
    expect(captured).not.toBeNull();
    expect(inConversation(w, a.id)!.pending).toBe(true);
    for (let i = 0; i < 100; i++) tickWorld(w);
    expect(inConversation(w, a.id)).toBeDefined(); // still waiting, still standing together

    fillConversation(w, captured!, [{ speakerId: a.id, text: "Hello" }, { speakerId: b.id, text: "Hello yourself" }], "warm", { a: "Had a good chat with B.", b: "A is alright." });
    for (let i = 0; i < 400 && inConversation(w, a.id); i++) tickWorld(w);
    expect(a.relationships[b.id]).toBe(6);
    expect(a.memory.at(-1)).toBe("Had a good chat with B.");
    expect(b.memory.at(-1)).toBe("A is alright.");
    setMeetHandler(null);
  });

  it("a pending chat left over from a crashed brain falls back to canned lines", () => {
    const w = world();
    setMeetHandler(() => true);
    const [a, b] = meet(w);
    tickWorld(w);
    setMeetHandler(null);
    w.clock.tick += 3000;
    tickConversations(w);
    expect(inConversation(w, a.id)!.pending).toBe(false);
    expect(inConversation(w, a.id)!.lines.length).toBe(2);
    void b;
  });
});

describe("population", () => {
  it("elders eventually die of old age and the village mourns", () => {
    const w = world();
    const v = w.villagers[0];
    v.ageDays = 85 * DAYS_PER_YEAR;
    v.stage = "elder";
    for (let i = 0; i < 200 && v.alive; i++) dailyPopulation(w, 12);
    expect(v.alive).toBe(false);
    expect(v.deathCause).toBe("old age");
    expect(w.events.some((e) => e.kind === "death")).toBe(true);
    expect(w.events.some((e) => e.kind === "funeral")).toBe(true);
    expect(w.structures.every((s) => !s.ownerIds.includes(v.id))).toBe(true);
    const other = w.villagers.find((o) => o.alive)!;
    expect(other.memory.some((m) => m.includes(v.name))).toBe(true);
    expect(other.goal?.type).toBe("socialize_at");
  });

  it("starving for too long is fatal, but eating recovers", () => {
    const w = world();
    const v = w.villagers[1];
    v.needs.hunger = 0;
    v.exposureTicks = EXPOSURE_FATAL_TICKS - 10;
    for (let i = 0; i < 5; i++) trackExposure(w, v);
    expect(v.alive).toBe(true);
    v.needs.hunger = 50;
    for (let i = 0; i < 5; i++) trackExposure(w, v);
    expect(v.exposureTicks).toBe(EXPOSURE_FATAL_TICKS - 15);
    v.needs.hunger = 0;
    for (let i = 0; i < 20; i++) trackExposure(w, v);
    expect(v.alive).toBe(false);
    expect(v.deathCause).toBe("hunger");
  });

  it("close housemates pair up and, in time, expect a child", () => {
    const w = world();
    const adults = w.villagers.filter((v) => v.stage === "adult");
    const [a, b] = adults;
    const spot = findPlacement(w, "house", villageCenter(w), 12)!;
    const house = placeStructure(w, "house", spot.x, spot.y, { built: true, free: true });
    expect(house).toBeDefined();
    for (const h of w.structures) h.ownerIds = h.ownerIds.filter((id) => id !== a.id && id !== b.id);
    house!.ownerIds = [a.id, b.id];
    a.homeId = b.homeId = house!.id;
    a.relationships[b.id] = 50;
    b.relationships[a.id] = 50;
    w.storehouse.food = 200;

    let tries = 0;
    while (!w.pendingBirth && tries++ < 200) {
      w.lastBirthTick = undefined;
      dailyPopulation(w, 12);
    }
    expect(a.partnerId).toBe(b.id);
    expect(b.partnerId).toBe(a.id);
    expect(w.pendingBirth?.parentIds.sort()).toEqual([a.id, b.id].sort());

    const child = giveBirth(w, { name: "Tam", traits: ["small", "loud"], quirk: "chews everything", skill: "child" })!;
    expect(child.stage).toBe("child");
    expect(child.parentIds).toEqual(w.events.find((e) => e.kind === "birth")!.villagerIds!.slice(1));
    expect(child.homeId).toBe(house!.id);
    expect(w.pendingBirth).toBeUndefined();
    expect(a.relationships[child.id]).toBe(60);
  });

  it("no births or arrivals once the village is at its cap", () => {
    const w = world();
    w.storehouse.food = 500;
    for (let i = 0; i < 50; i++) dailyPopulation(w, w.villagers.length);
    expect(w.pendingArrival).toBeUndefined();
    expect(w.pendingBirth).toBeUndefined();
  });

  it("a newcomer arrives from the pool when the village has room", () => {
    const w = world();
    w.pendingArrival = { sinceTick: w.clock.tick };
    const persona = fallbackPersona(w, pool, "newcomer");
    expect(pool.some((p) => p.name === persona.name)).toBe(true);
    const v = arrive(w, persona);
    expect(w.villagers.includes(v)).toBe(true);
    expect(w.pendingArrival).toBeUndefined();
    expect(w.lastArrivalTick).toBe(w.clock.tick);
    expect(w.events.at(-1)?.kind).toBe("arrival");
    // The pool skips names already in use.
    expect(fallbackPersona(w, pool, "newcomer").name).not.toBe(persona.name);
    const child = fallbackPersona(w, pool, "child");
    expect(child.ageYears).toBe(0);
    expect(child.skill).toBe("child");
  });

  it("dying mid-conversation ends it cleanly", () => {
    setMeetHandler(null);
    const w = world();
    const [a, b] = meet(w);
    tickWorld(w);
    expect(inConversation(w, b.id)).toBeDefined();
    die(w, a, "cold");
    expect(inConversation(w, b.id)).toBeUndefined();
    tickWorld(w);
    expect(b.alive).toBe(true);
  });
});

describe("memory, chronicle, news, admin", () => {
  it("condensing replaces the oldest notes and keeps the rest in order", () => {
    const w = world();
    const v = w.villagers[0];
    v.memory = Array.from({ length: 20 }, (_, i) => `note ${i}`);
    applySummary(v, 12, ["I remember the early days.", "Tobias owes me a favour."]);
    expect(v.memory.length).toBe(10);
    expect(v.memory[0]).toBe("I remember the early days.");
    expect(v.memory[2]).toBe("note 12");
    expect(v.memory.at(-1)).toBe("note 19");
  });

  it("the chronicle is capped and notifies listeners", () => {
    const w = world();
    let seen = 0;
    onChronicle(() => seen++);
    for (let i = 0; i < MAX_CHRONICLE + 5; i++) addChronicleEntry(w, "day", `Day ${i}`, "Things happened.");
    expect(w.chronicle.length).toBe(MAX_CHRONICLE);
    expect(w.chronicle[0].title).toBe("Day 5");
    expect(seen).toBe(MAX_CHRONICLE + 5);
  });

  it("parses RSS titles and drops blocked or duplicate headlines", () => {
    const xml = `<?xml version="1.0"?><rss><channel><title>Feed</title>
      <item><title><![CDATA[Scientists find a new kind of deep-sea fish &amp; name it]]></title></item>
      <item><title>Dozens killed in highway pile-up overnight</title></item>
      <item><title>Scientists find a new kind of deep-sea fish &amp; name it</title></item>
      <item><title>Short</title></item>
      <item><title>Village bakery wins national award for sourdough</title></item>
    </channel></rss>`;
    const titles = parseFeed(xml);
    expect(titles.length).toBe(5);
    expect(titles[0]).toBe("Scientists find a new kind of deep-sea fish & name it");
    const kept = filterHeadlines(titles, DEFAULT_BLOCKLIST);
    expect(kept).toEqual(["Scientists find a new kind of deep-sea fish & name it", "Village bakery wins national award for sourdough"]);
  });

  it("admin can change the new settings within bounds", () => {
    const w = world();
    const settings = { aiEnabled: true, budgetUsdPerHour: 0.15, newsEnabled: true, bigMomentsEnabled: true, populationMax: 12 };
    let saved = 0;
    const ctx = { world: w, settings, reset: () => {}, saveSettings: () => saved++, pickNewcomer: () => null, poke: () => {} };
    expect(runAdminCommand({ cmd: "setNews", enabled: false }, ctx).ok).toBe(true);
    expect(settings.newsEnabled).toBe(false);
    expect(runAdminCommand({ cmd: "setPopulationMax", value: 1 }, ctx).ok).toBe(false);
    expect(runAdminCommand({ cmd: "setPopulationMax", value: 8 }, ctx).ok).toBe(true);
    expect(settings.populationMax).toBe(8);
    expect(runAdminCommand({ cmd: "setBigMoments", enabled: false }, ctx).ok).toBe(true);
    expect(saved).toBe(3);
  });

  it("the sim stops growing the village past the cap it is given", () => {
    const w = world();
    w.storehouse.food = 500;
    for (let i = 0; i < 3; i++) {
      w.clock.tick += TICKS_PER_DAY;
      tickWorld(w, { populationMax: 3 });
    }
    expect(w.pendingArrival).toBeUndefined();
  });
});
