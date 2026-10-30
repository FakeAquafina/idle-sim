import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Settings } from "@idle-sim/shared";

const FILE = "settings.json";

export const DEFAULT_SETTINGS: Settings = {
  aiEnabled: true,
  budgetUsdPerHour: 0.15, // about $3.60/day if the village runs flat out
  newsEnabled: true,
  bigMomentsEnabled: true,
  populationMax: 12,
  newsFeeds: [],
  notifyEnabled: true,
};

export function loadSettings(dir: string): Settings {
  const file = path.join(dir, FILE);
  if (!existsSync(file)) return { ...DEFAULT_SETTINGS };
  try {
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(readFileSync(file, "utf8")) as Partial<Settings>) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(dir: string, s: Settings): void {
  writeFileSync(path.join(dir, FILE), JSON.stringify(s, null, 2));
}
