import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PlanOutputSchema, type PlanOutput, type WorldState } from "@idle-sim/shared";
import { planToGoal } from "../src/brain/apply.ts";
import { costOf } from "../src/brain/budget.ts";
import { canPetition, denyPetition, grantPetition, lapseStaleProposals, proposePetition, supportPetition, supportNeeded, updateShortages } from "../src/sim/petitions.ts";
import { TICKS_PER_DAY } from "@idle-sim/shared";
import { seedVillagers } from "../src/sim/seed.ts";
import { tickWorld } from "../src/sim/tick.ts";
import type { Persona } from "../src/sim/villager.ts";
import { createWorld } from "../src/sim/world.ts";

const personas = JSON.parse(readFileSync(new URL("../data/villagers.json", import.meta.url), "utf8")) as Persona[];

function world(): WorldState {
  const w = createWorld(21);
  seedVillagers(w, personas);
  for (let i = 0; i < 500; i++) tickWorld(w);
  return w;
}

/** Make a resource genuinely unobtainable and long-short so a petition is allowed. */
function starve(w: WorldState, ...asks: ("wood" | "stone" | "food" | "seeds")[]) {
  for (const a of asks) {
    w.storehouse[a] = 0;
    if (a === "wood") for (const t of w.tiles) if (t.kind === "forest") t.amount = 0;
    if (a === "stone") for (const t of w.tiles) if (t.kind === "rock") t.amount = 0;
    if (a === "food") {
      w.coast = undefined;
      w.animals = [];
      for (const s of w.structures) if (s.kind === "farm") s.growth = undefined;
    }
    if (a === "seeds") for (const s of w.structures) if (s.kind === "farm") s.growth = undefined;
  }
  updateShortages(w);
  w.clock.tick += TICKS_PER_DAY;
}

function plan(partial: Partial<PlanOutput>): PlanOutput {
  return { thought: "t", say: null, action: "wander", target: null, petition: null, memory_note: null, ...partial };
}

describe("plan validation", () => {
  it("accepts a well-formed plan through the schema", () => {
    const parsed = PlanOutputSchema.safeParse(plan({ action: "gather", target: "wood" }));
    expect(parsed.success).toBe(true);
  });

  it("maps gather and talk_to to real goals", () => {
    const w = world();
    const v = w.villagers[0];
    expect(planToGoal(w, v, plan({ action: "gather", target: "wood" })).goal?.type).toBe("gather");
    const other = w.villagers[1];
    const talk = planToGoal(w, v, plan({ action: "talk_to", target: other.name.toUpperCase() })).goal;
    expect(talk).toEqual({ type: "talk_to", villagerId: other.id, chatted: false });
  });

  it("rejects nonsense targets with a reason", () => {
    const w = world();
    const v = w.villagers[0];
    expect(planToGoal(w, v, plan({ action: "talk_to", target: "Nobody" })).reason).toMatch(/no villager/);
    expect(planToGoal(w, v, plan({ action: "gather", target: "gold" })).reason).toMatch(/wood or stone/);
    expect(planToGoal(w, v, plan({ action: "build", target: "castle" })).goal?.type ?? "none").not.toBe("castle");
  });

  it("refuses a second storehouse or well", () => {
    const w = world();
    w.structures = w.structures.filter((s) => s.built);
    w.storehouse.wood = 200;
    w.storehouse.stone = 200;
    const v = w.villagers[0];
    expect(planToGoal(w, v, plan({ action: "build", target: "storehouse" })).reason).toMatch(/already has/);
    expect(planToGoal(w, v, plan({ action: "build", target: "well" })).goal?.type).toBe("build");
    w.structures = w.structures.filter((s) => s.built || s.kind !== "well");
    w.structures.push({ ...w.structures[0], id: "wellx", kind: "well", x: 2, y: 2, w: 1, h: 1, built: true, progress: 1, ownerIds: [] });
    expect(planToGoal(w, v, plan({ action: "build", target: "well" })).reason).toMatch(/one well/);
  });

  it("build lays out an affordable blueprint, refuses an unaffordable one", () => {
    const w = world();
    w.structures = w.structures.filter((s) => s.built); // clear any blueprints
    const v = w.villagers[0];
    w.storehouse.wood = 100;
    w.storehouse.stone = 50;
    const ok = planToGoal(w, v, plan({ action: "build", target: "well" }));
    expect(ok.goal?.type).toBe("build");
    expect(w.structures.some((s) => s.kind === "well" && !s.built)).toBe(true);
    w.structures = w.structures.filter((s) => s.built);
    w.storehouse.wood = 0;
    expect(planToGoal(w, v, plan({ action: "build", target: "house" })).reason).toMatch(/materials/);
  });
});

describe("petitions", () => {
  it("only allows asking for what the village lacks", () => {
    const w = world();
    const v = w.villagers[0];
    w.storehouse.wood = 100;
    expect(canPetition(w, v, { ask: "wood", amount: 10, reason: "r" })).toMatch(/enough wood/);
    starve(w, "wood");
    expect(canPetition(w, v, { ask: "wood", amount: 10, reason: "r" })).toBeNull();
    expect(canPetition(w, v, { ask: "wood", amount: 500, reason: "r" })).toMatch(/between/);
  });

  it("needs half the village to gather before a petition opens", () => {
    const w = world();
    starve(w, "seeds", "wood");
    const [a, b, c, d] = w.villagers;
    expect(supportNeeded(w)).toBe(3); // 6 villagers
    const p = proposePetition(w, a, { ask: "seeds", amount: 5, reason: "bare fields" });
    expect(p.status).toBe("proposed");
    expect(p.supporters).toEqual([a.id]);
    expect(canPetition(w, b, { ask: "wood", amount: 5, reason: "r" })).toMatch(/gathering is already/);
    expect(grantPetition(w, p.id)).toMatch(/not gathered/);
    expect(supportPetition(w, b, p.id)).toBe(false);
    expect(supportPetition(w, b, p.id)).toBe(false); // same voice twice doesn't count
    expect(p.supporters.length).toBe(2);
    expect(supportPetition(w, c, p.id)).toBe(true);
    expect(p.status).toBe("open");
    expect(w.events.some((e) => e.kind === "petition" && e.text.includes(c.name))).toBe(true);
    expect(c.memory.some((m) => m.includes("gathered"))).toBe(true);
    expect(supportPetition(w, d, p.id)).toBe(false); // already open
  });

  it("a proposal nobody joins lapses after a day", () => {
    const w = world();
    starve(w, "food");
    const a = w.villagers[0];
    const p = proposePetition(w, a, { ask: "food", amount: 10, reason: "hunger" });
    w.clock.tick = p.expiresTick;
    lapseStaleProposals(w);
    expect(p.status).toBe("lapsed");
    expect(a.memory.some((m) => m.includes("Nobody came"))).toBe(true);
    expect(canPetition(w, a, { ask: "food", amount: 10, reason: "r" })).toMatch(/asked recently/); // cooldown now
  });

  it("caps open petitions per villager, per resource, and village-wide", () => {
    const w = world();
    starve(w, "wood", "stone", "food", "seeds");
    const [a, b, c, d, e, f] = w.villagers;
    const openWith = (proposer: typeof a, ask: "wood" | "stone" | "food" | "seeds") => {
      const p = proposePetition(w, proposer, { ask, amount: 5, reason: "r" });
      for (const s of [a, b, c, d, e, f]) if (p.status === "proposed") supportPetition(w, s, p.id);
      return p;
    };
    openWith(a, "wood");
    expect(canPetition(w, a, { ask: "stone", amount: 10, reason: "r" })).toMatch(/already have/);
    expect(canPetition(w, b, { ask: "wood", amount: 10, reason: "r" })).toMatch(/already asked for wood/);
    openWith(b, "stone");
    openWith(c, "food");
    expect(canPetition(w, d, { ask: "seeds", amount: 5, reason: "r" })).toMatch(/enough requests|asked recently/);
  });

  it("granting delivers resources and leaves memories for everyone who gathered", () => {
    const w = world();
    starve(w, "wood", "food");
    const [a, b, c, d] = w.villagers;
    const p1 = proposePetition(w, a, { ask: "wood", amount: 20, reason: "the roofs leak" });
    supportPetition(w, b, p1.id);
    supportPetition(w, c, p1.id);
    expect(grantPetition(w, p1.id, { amount: 10, message: "make it last" })).toBeNull();
    expect(w.storehouse.wood).toBe(10);
    expect(a.memory.some((m) => m.includes("less than I asked"))).toBe(true);
    expect(a.memory.some((m) => m.includes("make it last"))).toBe(true);
    expect(b.memory.some((m) => m.includes("asked for together"))).toBe(true);
    const p2 = proposePetition(w, d, { ask: "food", amount: 10, reason: "we hunger" });
    supportPetition(w, b, p2.id);
    supportPetition(w, c, p2.id);
    expect(denyPetition(w, p2.id)).toBeNull();
    expect(d.memory.some((m) => m.includes("silent"))).toBe(true);
    expect(grantPetition(w, p2.id)).toMatch(/already resolved/);
  });

  it("a petition goal walks to the shrine and calls the gathering; autopilot villagers join", () => {
    const w = world();
    starve(w, "seeds");
    const v = w.villagers[0];
    v.goal = { type: "petition", ask: "seeds", amount: 5, reason: "the fields lie bare" };
    v.goalStartedTick = w.clock.tick;
    v.path = [];
    v.source = "ai";
    for (let i = 0; i < 1500 && w.petitions.length === 0; i++) tickWorld(w);
    expect(w.petitions.length).toBe(1);
    expect(w.petitions[0].status).toBe("proposed");
    for (let i = 0; i < 6000 && w.petitions[0].status === "proposed"; i++) tickWorld(w);
    expect(w.petitions[0].status).toBe("open");
    expect(w.petitions[0].supporters.length).toBeGreaterThanOrEqual(3);
  });
});

describe("budget", () => {
  it("prices Haiku calls in fractions of a cent", () => {
    const usd = costOf("claude-haiku-5-5", {
      input_tokens: 500,
      output_tokens: 200,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 2500,
      cache_creation: null,
      server_tool_use: null,
      service_tier: null,
      inference_geo: null,
      speed: null,
      iterations: null,
    } as never);
    expect(usd).toBeGreaterThan(0);
    expect(usd).toBeLessThan(0.001);
  });
});
