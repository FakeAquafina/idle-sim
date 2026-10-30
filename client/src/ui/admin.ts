// The admin bar: pause/speed/reset, gifts and whispers, and the settings panel.

import type { AdminCommand, ServerInfo, Settings } from "@idle-sim/shared";
import { setupSettings, updateSettingsPanel } from "./settings.ts";

export function setupAdminBar(isAdmin: boolean, send: (cmd: AdminCommand) => void): void {
  const bar = document.getElementById("admin")!;
  bar.classList.toggle("hidden", !isAdmin);
  if (!isAdmin || bar.dataset.ready) return;
  bar.dataset.ready = "1";
  bar.querySelectorAll<HTMLButtonElement>("button[data-cmd]").forEach((b) => {
    b.onclick = () => {
      const cmd = b.dataset.cmd as "pause" | "resume" | "reset";
      if (cmd === "reset" && !confirm("Reset the whole world? This cannot be undone.")) return;
      send({ cmd });
    };
  });
  bar.querySelectorAll<HTMLButtonElement>("button[data-speed]").forEach((b) => {
    b.onclick = () => send({ cmd: "speed", value: Number(b.dataset.speed) });
  });
  document.getElementById("giftBtn")!.onclick = () => {
    const what = prompt("Gift what? wood, stone, food, seeds, or blessing", "wood")?.trim().toLowerCase();
    if (!what) return;
    if (what === "blessing") return send({ cmd: "gift", resource: "blessing" });
    if (!["wood", "stone", "food", "seeds"].includes(what)) return alert("Unknown gift");
    const amount = Number(prompt("How many? (1-100)", "20"));
    if (!Number.isFinite(amount) || amount < 1) return;
    send({ cmd: "gift", resource: what as "wood" | "stone" | "food" | "seeds", amount: Math.floor(amount) });
  };
  document.getElementById("rumorBtn")!.onclick = () => {
    const text = prompt("Whisper a rumor the villagers will talk about:");
    if (text?.trim()) send({ cmd: "rumor", text: text.trim() });
  };
  setupSettings(send);
}

export function updateAdminSettings(settings: Settings, server?: ServerInfo): void {
  updateSettingsPanel(settings, server);
  const btn = document.getElementById("settingsBtn");
  if (btn) {
    const off = [!settings.aiEnabled && "AI off", !settings.newsEnabled && "news off", !settings.bigMomentsEnabled && "chronicle off"].filter(Boolean);
    btn.title = off.length ? `Settings (${off.join(", ")})` : "Settings";
  }
}

export function showAdminMessage(ok: boolean, message?: string): void {
  const el = document.getElementById("adminMsg")!;
  el.textContent = message ?? "";
  el.style.color = ok ? "" : "#f0a8a6";
  setTimeout(() => (el.textContent = ""), 3000);
}

export function highlightSpeed(speed: number, paused: boolean): void {
  document.querySelectorAll<HTMLButtonElement>("#admin button[data-speed]").forEach((b) => {
    b.classList.toggle("active", !paused && Number(b.dataset.speed) === speed);
  });
}
