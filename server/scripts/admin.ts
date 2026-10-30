// Dev helper: send one admin command to the running server from the terminal.
// Reads ADMIN_TOKEN from the env file (/etc/idle-sim/env on a deployed box,
// server/.env in development); the token is never printed.
//   npx tsx scripts/admin.ts '{"cmd":"speed","value":20}'
//   npx tsx scripts/admin.ts '{"cmd":"rumor","text":"The river is rising."}'
import { readFileSync } from "node:fs";
import WebSocket from "ws";
import { envFile } from "../src/env.ts";

const env = readFileSync(envFile(), "utf8");
const token = env.match(/^ADMIN_TOKEN=(.*)$/m)?.[1]?.trim();
if (!token) throw new Error(`no ADMIN_TOKEN in ${envFile()}`);
const command = JSON.parse(process.argv[2] ?? "{}");
const port = process.env.SIM_PORT ?? 3000;

const ws = new WebSocket(`ws://localhost:${port}/ws?token=${encodeURIComponent(token)}`);
ws.on("open", () => ws.send(JSON.stringify({ type: "admin", token, command })));
ws.on("message", (raw) => {
  const msg = JSON.parse(raw.toString());
  if (msg.type === "adminResult") {
    console.log(msg.ok ? "ok:" : "failed:", msg.message ?? "");
    ws.close();
    process.exit(msg.ok ? 0 : 1);
  }
});
setTimeout(() => {
  console.log("timeout: is the server running?");
  process.exit(2);
}, 5000);
