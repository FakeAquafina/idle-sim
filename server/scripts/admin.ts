// Dev helper: send one admin command to the running server from the terminal.
// Reads ADMIN_TOKEN from server/.env; the token is never printed.
//   npx tsx scripts/admin.ts '{"cmd":"speed","value":20}'
//   npx tsx scripts/admin.ts '{"cmd":"rumor","text":"The river is rising."}'
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = readFileSync(path.join(root, ".env"), "utf8");
const token = env.match(/^ADMIN_TOKEN=(.*)$/m)?.[1]?.trim();
if (!token) throw new Error("no ADMIN_TOKEN in server/.env");
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
