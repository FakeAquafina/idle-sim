// Server entry point: runs the simulation forever and serves viewers.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import websocket from "@fastify/websocket";
import { TICKS_PER_SECOND, type WorldState } from "@idle-sim/shared";
import { onEvent } from "./sim/events.ts";
import { seedVillagers } from "./sim/seed.ts";
import { tickWorld } from "./sim/tick.ts";
import type { Persona } from "./sim/villager.ts";
import { createWorld } from "./sim/world.ts";
import { Hub } from "./net/hub.ts";
import { appendEventLog, loadWorld, saveWorld } from "./persist.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = path.resolve(here, "..");
const DATA_DIR = path.join(SERVER_ROOT, "data");
const CLIENT_DIST = path.resolve(SERVER_ROOT, "..", "client", "dist");

dotenv.config({ path: path.join(SERVER_ROOT, ".env") });
// SIM_PORT rather than PORT: dev tools often set PORT for the Vite front end.
const PORT = Number(process.env.SIM_PORT ?? 3000);
const ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? "";
if (!ADMIN_TOKEN) console.warn("[server] ADMIN_TOKEN is not set: admin commands are disabled.");

const personas = JSON.parse(readFileSync(path.join(DATA_DIR, "villagers.json"), "utf8")) as Persona[];

function newWorld(): WorldState {
  const w = createWorld((Date.now() % 2147483647) | 0);
  seedVillagers(w, personas);
  return w;
}

let world = loadWorld(DATA_DIR) ?? newWorld();
console.log(`[server] world loaded: seed ${world.seed}, tick ${world.clock.tick}, ${world.villagers.length} villagers`);

const hub = new Hub(
  () => world,
  ADMIN_TOKEN,
  () => {
    world = newWorld();
    saveWorld(DATA_DIR, world);
    console.log("[server] world reset");
  },
);

onEvent((e) => {
  hub.broadcastEvent(e);
  appendEventLog(DATA_DIR, e);
});

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
  for (let i = 0; i < n; i++) tickWorld(world);
}, 100);

setInterval(() => hub.broadcastDelta(), 200);
setInterval(() => saveWorld(DATA_DIR, world), 30_000);

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
  process.exit(0);
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
