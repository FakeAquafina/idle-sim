import type { AdminCommand, Settings } from "@idle-sim/shared";

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
  document.getElementById("aiBtn")!.onclick = () => send({ cmd: "setAi", enabled: !currentAi() });
  document.getElementById("budgetBtn")!.onclick = () => {
    const v = Number(prompt("Max Claude spend in dollars per hour (0-20):", String(current.budgetUsdPerHour)));
    if (Number.isFinite(v) && v >= 0) send({ cmd: "setBudget", usdPerHour: v });
  };
  document.getElementById("newsBtn")!.onclick = () => send({ cmd: "setNews", enabled: !current.newsEnabled });
  document.getElementById("storyBtn")!.onclick = () => send({ cmd: "setBigMoments", enabled: !current.bigMomentsEnabled });
  document.getElementById("popBtn")!.onclick = () => {
    const v = Number(prompt("Stop arrivals and births once the village has this many people (2-30):", String(current.populationMax)));
    if (Number.isFinite(v) && v >= 2) send({ cmd: "setPopulationMax", value: Math.floor(v) });
  };
}

let current: Settings = { aiEnabled: true, budgetUsdPerHour: 0.15, newsEnabled: true, bigMomentsEnabled: true, populationMax: 12 };
const currentAi = () => current.aiEnabled;

export function updateAdminSettings(settings: Settings): void {
  current = settings;
  const set = (id: string, text: string) => {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  };
  set("aiBtn", `AI: ${settings.aiEnabled ? "on" : "off"}`);
  set("budgetBtn", `$${settings.budgetUsdPerHour.toFixed(2)}/h`);
  set("newsBtn", `News: ${settings.newsEnabled ? "on" : "off"}`);
  set("storyBtn", `Chronicle: ${settings.bigMomentsEnabled ? "on" : "off"}`);
  set("popBtn", `Pop ≤ ${settings.populationMax}`);
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
