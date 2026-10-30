// Where the secrets live. On a deployed box they sit outside the checkout in
// /etc/idle-sim/env (root-owned, readable by the service user, loaded by
// systemd as well). In development they are server/.env. IDLE_SIM_ENV
// overrides both.

import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

export const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const SYSTEM_ENV_FILE = "/etc/idle-sim/env";

export function envFile(): string {
  if (process.env.IDLE_SIM_ENV) return process.env.IDLE_SIM_ENV;
  if (existsSync(SYSTEM_ENV_FILE)) return SYSTEM_ENV_FILE;
  return path.join(SERVER_ROOT, ".env");
}

/** Load the env file into process.env (values already set, e.g. by systemd, win). */
export function loadEnv(): string {
  const file = envFile();
  dotenv.config({ path: file });
  return file;
}
