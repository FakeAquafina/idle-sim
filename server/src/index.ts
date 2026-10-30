// Server entry point: runs the simulation forever and serves viewers.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import websocket from "@fastify/websocket";
import { TICKS_PER_SECOND, type WorldState } from "@idle-sim/shared";

const here = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = path.resolve(here, "..");
const DATA_DIR = path.join(SERVER_ROOT, "data");
const CLIENT_DIST = path.resolve(SERVER_ROOT, "..", "client", "dist");

// Load .env before importing anything that reads process.env at module load.
dotenv.config({ path: path.join(SERVER_ROOT, ".env") });

const { onEvent } = await import("./sim/events.ts");
const { seedVillagers } = await import("./sim/seed.ts");
const { tickWorld } = await import("./sim/tick.ts");
const { createWorld } = await import("./sim/world.ts");
const { Hub } = await import("./net/hub.ts");
const { appendEventLog, loadWorld, saveWorld } = await import("./persist.ts");
const { loadSettings, saveSettings } = await import("./settings.ts");
const { Notifier } = await import("./notify.ts");
const { makeClient } = await import("./brain/claude.ts");
const { Budget } = await import("./brain/budget.ts");
const { Scheduler } = await import("./brain/scheduler.ts");
const { buildSystemPrompt } = await import("./brain/prompts/system.ts");
const { ConversationBrain } = await import("./brain/converse.ts");
const { MemoryBrain } = await import("./brain/memory.ts");
const { PopulationBrain } = await import("./brain/population.ts");
const { MomentsBrain } = await import("./brain/moments.ts");
const { NewsBrain, DEFAULT_FEEDS } = await import("./news.ts");
const { onChronicle } = await import("./sim/chronicle.ts");
type Persona = import("./sim/villager.ts").Persona;

// SIM_PORT rather than PORT: dev tools often set PORT for the Vite front end.
const PORT = Number(process.env.SIM_PORT ?? 3000);
const ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? "";
if (!ADMIN_TOKEN) console.warn("[server] ADMIN_TOKEN is not set: admin commands are disabled.");

const personas = JSON.parse(readFileSync(path.join(DATA_DIR, "villagers.json"), "utf8")) as Persona[];
const newcomerPool = JSON.parse(readFileSync(path.join(DATA_DIR, "newcomers.json"), "utf8")) as Persona[];

function newWorld(): WorldState {
  const w = createWorld((Date.now() % 2147483647) | 0);
  seedVillagers(w, personas);
  return w;
}

let world = loadWorld(DATA_DIR) ?? newWorld();
const settings = loadSettings(DATA_DIR);
console.log(`[server] world loaded: seed ${world.seed}, tick ${world.clock.tick}, ${world.villagers.length} villagers`);

// ---- AI, notifications ---------------------------------------------------------
const client = makeClient();
const budget = new Budget();
const systemPrompt = buildSystemPrompt();
const brainDeps = { getWorld: () => world, client, budget, getSettings: () => settings, systemPrompt };
const scheduler = new Scheduler(brainDeps);
new ConversationBrain(brainDeps); // registers itself as the handler for villagers meeting
const memoryBrain = new MemoryBrain(brainDeps);
const populationBrain = new PopulationBrain({ ...brainDeps, pool: newcomerPool });
const moments = new MomentsBrain(brainDeps);
const envFeeds = process.env.NEWS_FEEDS?.split(",").map((f) => f.trim()).filter(Boolean);
const news = new NewsBrain({
  ...brainDeps,
  feeds: envFeeds?.length ? envFeeds : undefined,
  blocklist: process.env.NEWS_BLOCKLIST ? process.env.NEWS_BLOCKLIST.split(",").map((b) => b.trim()).filter(Boolean) : undefined,
});
console.log(client ? `[brain] Claude enabled (cap $${settings.budgetUsdPerHour}/hour)` : "[brain] no ANTHROPIC_API_KEY: villagers run on autopilot");

const notifier = new Notifier(process.env.NTFY_URL, process.env.DISCORD_WEBHOOK);
console.log(notifier.enabled ? "[notify] notifications on" : "[notify] no NTFY_URL / DISCORD_WEBHOOK: notifications off");

const hub = new Hub({
  getWorld: () => world,
  getSettings: () => settings,
  getAi: () => scheduler.status(),
  adminToken: ADMIN_TOKEN,
  adminContext: () => ({
    world,
    settings,
    reset: () => {
      world = newWorld();
      saveWorld(DATA_DIR, world);
      console.log("[server] world reset");
    },
    saveSettings: () => saveSettings(DATA_DIR, settings),
    pickNewcomer: () => newcomerPool.find((p) => !world.villagers.some((v) => v.name === p.name)) ?? null,
    poke: (id) => scheduler.poke(id),
  }),
  serverInfo: () => ({ notifyConfigured: notifier.enabled, defaultFeeds: envFeeds?.length ? envFeeds : DEFAULT_FEEDS }),
});

const NOTIFY_KINDS = new Set(["petition", "arrival", "season", "built", "death", "birth", "partners", "naming"]);
onEvent((e) => {
  hub.broadcastEvent(e);
  appendEventLog(DATA_DIR, e);
  if (settings.notifyEnabled && NOTIFY_KINDS.has(e.kind)) notifier.send(e.text);
  moments.onEvent(e);
});
onChronicle((entry) => hub.broadcastChronicle(entry));

// ---- Simulation loop: wall-clock driven so 1 sim day really is 1 real hour ----
const MAX_TICKS_PER_STEP = 2000;
let lastStep = performance.now();
let tickAccumulator = 0;
setInterval(() => {
  const now = performance.now();
  const dt = (now - lastStep) / 1000;
  lastStep = now;
  if (world.paused) return;
  tickAccumulator += dt * TICKS_PER_SECOND * world.speed;
  const n = Math.min(Math.floor(tickAccumulator), MAX_TICKS_PER_STEP);
  tickAccumulator -= n;
  for (let i = 0; i < n; i++) tickWorld(world, { populationMax: settings.populationMax });
}, 100);

setInterval(() => hub.broadcastDelta(), 200);
setInterval(() => saveWorld(DATA_DIR, world), 30_000);
setInterval(() => scheduler.check(() => settings.notifyEnabled && notifier.send("Hourly Claude budget reached; villagers are on autopilot until it resets.")), 1000);
setInterval(() => {
  memoryBrain.check();
  populationBrain.check();
  moments.check();
  news.check();
}, 5000);

// ---- HTTP + WebSocket -------------------------------------------------------
const app = Fastify({ logger: false });
await app.register(websocket, { options: { maxPayload: 64 * 1024 } });

app.get("/api/health", async () => ({
  ok: true,
  tick: world.clock.tick,
  day: world.clock.day,
  season: world.clock.season,
  villagers: world.villagers.filter((v) => v.alive).length,
  viewers: hub.viewerCount,
  paused: world.paused,
  speed: world.speed,
  ai: scheduler.status(),
  news: { lastHeadlines: news.lastHeadlines, lastError: news.lastError },
}));

app.get("/api/state", async () => hub.snapshot(false).state);

app.get("/ws", { websocket: true }, (socket, req) => {
  const token = (req.query as Record<string, string | undefined>).token;
  hub.add(socket, token);
});

if (existsSync(CLIENT_DIST)) {
  await app.register(fastifyStatic, { root: CLIENT_DIST, prefix: "/" });
  console.log(`[server] serving client from ${CLIENT_DIST}`);
} else {
  console.log("[server] client/dist not found; run the Vite dev server or `npm run build`.");
}

await app.listen({ port: PORT, host: "0.0.0.0" });
console.log(`[server] listening on http://0.0.0.0:${PORT}`);

function shutdown(signal: string) {
  console.log(`[server] ${signal} received, saving world...`);
  saveWorld(DATA_DIR, world);
  saveSettings(DATA_DIR, settings);
  process.exit(0);
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
