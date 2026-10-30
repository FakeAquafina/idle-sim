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
  const s = state.storehouse;
  $("stock").textContent = `🪵${s.wood} 🪨${s.stone} 🍞${s.food} 🌱${s.seeds}`;
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
