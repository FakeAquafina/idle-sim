import type { AiStatus } from "@idle-sim/shared";
import type { MirrorState, ConnectionStatus } from "../net.ts";

const $ = (id: string) => document.getElementById(id)!;

export function updateTopbar(state: MirrorState): void {
  const c = state.clock;
  const hour = Math.floor(c.timeOfDay * 24);
  const minute = Math.floor((c.timeOfDay * 24 - hour) * 60);
  $("clock").textContent = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}${c.isNight ? " 🌙" : ""}`;
  $("date").textContent = `Day ${c.dayOfSeason + 1} of ${c.season}, year ${c.year + 1}`;
  $("weather").textContent = { clear: "☀ clear", rain: "🌧 rain", storm: "⛈ storm", snow: "❄ snow" }[c.weather];
  $("speed").textContent = state.paused ? "⏸ paused" : `${state.speed}x`;
  // Everything the village owns between them: every bundle plus the common store.
  const s = { ...state.storehouse };
  let coins = 0;
  for (const v of state.villagers) {
    if (!v.alive) continue;
    for (const k of Object.keys(s) as (keyof typeof s)[]) s[k] += (v.stock?.[k] ?? 0) + (v.inventory?.[k] ?? 0);
    coins += v.coins ?? 0;
  }
  $("stock").textContent = `🪵${s.wood} 🪨${s.stone} 🍞${s.food} 🌱${s.seeds}${s.ore ? ` ⛏${s.ore}` : ""}${coins ? ` 🪙${coins}` : ""}`;
  $("stock").title = "What the village owns between them (every bundle, house and the storehouse)";
}

export function updateViewers(count: number): void {
  $("viewers").textContent = `👁 ${count}`;
}

export function updateStatus(status: ConnectionStatus): void {
  const el = $("status");
  el.className = `dot ${status}`;
  el.title = status;
}

export function updateAi(ai: AiStatus | null): void {
  const el = $("ai");
  if (!ai) return;
  if (!ai.keyPresent) {
    el.textContent = "🧠 no key";
    el.title = "No ANTHROPIC_API_KEY on the server: villagers run on autopilot";
  } else if (!ai.enabled) {
    el.textContent = "🧠 off";
    el.title = "AI disabled by admin";
  } else {
    el.textContent = `🧠 $${ai.spentHourUsd.toFixed(3)}/${ai.capUsd.toFixed(2)}${ai.inflight ? " …" : ""}`;
    el.title = `${ai.callsHour} Claude calls this hour${ai.lastError ? `\nlast error: ${ai.lastError}` : ""}`;
  }
  el.classList.toggle("warn", !!ai.lastError && ai.keyPresent && ai.enabled);
}
