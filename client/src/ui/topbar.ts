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
