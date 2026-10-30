// Dev helper: write a fresh world.json with chosen stock, so a scenario can be
// tested without history. Stop the server first or it will overwrite the file.
//   npx tsx scripts/make-world.ts --seeds 0 --food 12 --wood 30 --stone 10 --seed 777
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { createWorld } = await import("../src/sim/world.ts");
const { seedVillagers } = await import("../src/sim/seed.ts");
const { saveWorld } = await import("../src/persist.ts");

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ""), process.argv[i + 1]);
const num = (k: string, d: number) => (args.has(k) ? Number(args.get(k)) : d);

const personas = JSON.parse(readFileSync(path.join(root, "data/villagers.json"), "utf8"));
const w = createWorld(num("seed", (Date.now() % 2147483647) | 0));
seedVillagers(w, personas);
w.storehouse = { wood: num("wood", 30), stone: num("stone", 10), food: num("food", 40), seeds: num("seeds", 6) };
saveWorld(path.join(root, "data"), w);
console.log(`wrote data/world.json: seed ${w.seed}, stock`, w.storehouse);
