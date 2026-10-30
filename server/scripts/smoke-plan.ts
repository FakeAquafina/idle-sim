// One real Claude call for one villager, printed in full. Run from server/:
//   npx tsx scripts/smoke-plan.ts
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "../src/env.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadEnv();

const { createWorld } = await import("../src/sim/world.ts");
const { seedVillagers } = await import("../src/sim/seed.ts");
const { tickWorld } = await import("../src/sim/tick.ts");
const { makeClient, requestPlan, PLAN_MODEL } = await import("../src/brain/claude.ts");
const { buildSystemPrompt } = await import("../src/brain/prompts/system.ts");
const { buildVillagerPrompt } = await import("../src/brain/prompts/villager.ts");
const { planToGoal } = await import("../src/brain/apply.ts");
const { costOf } = await import("../src/brain/budget.ts");

const client = makeClient();
if (!client) {
  console.error("No ANTHROPIC_API_KEY in the env file");
  process.exit(1);
}
const personas = JSON.parse(readFileSync(path.join(root, "data/villagers.json"), "utf8"));
const w = createWorld(12345);
seedVillagers(w, personas);
for (let i = 0; i < 3000; i++) tickWorld(w);
w.storehouse.wood = 8; // make a petition plausible

const system = buildSystemPrompt();
for (const v of w.villagers.slice(0, Number(process.argv[2] ?? 2))) {
  const prompt = buildVillagerPrompt(w, v);
  const t0 = Date.now();
  const res = await requestPlan(client, system, prompt);
  const ms = Date.now() - t0;
  console.log(`\n=== ${v.name} (${ms} ms) ===`);
  if (res.error) console.log("error:", res.error);
  if (res.usage) console.log("usage:", JSON.stringify(res.usage), `cost $${costOf(PLAN_MODEL, res.usage).toFixed(5)}`);
  if (res.plan) {
    console.log(JSON.stringify(res.plan, null, 2));
    console.log("-> applied:", JSON.stringify(planToGoal(w, v, res.plan)));
  }
}
