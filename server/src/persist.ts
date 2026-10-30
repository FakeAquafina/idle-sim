import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { WorldEvent, WorldState } from "@idle-sim/shared";

const WORLD_FILE = "world.json";
const EVENTS_FILE = "events.jsonl";

export function ensureDataDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/** Atomic save: write to a temp file, then rename over the old one. */
export function saveWorld(dir: string, w: WorldState): void {
  ensureDataDir(dir);
  const tmp = path.join(dir, WORLD_FILE + ".tmp");
  writeFileSync(tmp, JSON.stringify({ ...w, dirtyTiles: [] }));
  renameSync(tmp, path.join(dir, WORLD_FILE));
}

export function loadWorld(dir: string): WorldState | null {
  const file = path.join(dir, WORLD_FILE);
  if (!existsSync(file)) return null;
  try {
    const w = JSON.parse(readFileSync(file, "utf8")) as WorldState;
    if (!w || typeof w.width !== "number" || !Array.isArray(w.tiles) || w.tiles.length !== w.width * w.height) {
      console.warn("[persist] world.json looks corrupt, starting fresh");
      return null;
    }
    w.dirtyTiles = [];
    // Fields added after a save was written get sensible defaults.
    w.petitions ??= [];
    w.rumors ??= [];
    w.animals ??= [];
    w.shortageSince ??= {};
    w.storehouse.ore ??= 0;
    for (const v of w.villagers) v.cooldowns ??= {};
    for (const p of w.petitions) {
      p.supporters ??= [p.villagerId];
      p.needed ??= 1;
      p.expiresTick ??= p.tick;
    }
    return w;
  } catch (err) {
    console.warn("[persist] could not read world.json:", err);
    return null;
  }
}

export function appendEventLog(dir: string, event: WorldEvent): void {
  ensureDataDir(dir);
  appendFileSync(path.join(dir, EVENTS_FILE), JSON.stringify(event) + "\n");
}
