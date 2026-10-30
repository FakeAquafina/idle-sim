import { DAYS_PER_YEAR, type VillagerView } from "@idle-sim/shared";
import type { MirrorState } from "../net.ts";

let selectedId: string | null = null;

export function selectVillager(id: string | null, state: MirrorState | null): void {
  selectedId = id;
  const panel = document.getElementById("inspector")!;
  if (!id) {
    panel.classList.add("hidden");
    return;
  }
  panel.classList.remove("hidden");
  if (state) renderInspector(state);
}

export function renderInspector(state: MirrorState): void {
  if (!selectedId) return;
  const v = state.villagers.find((x) => x.id === selectedId);
  const body = document.getElementById("inspectorBody")!;
  if (!v) {
    body.innerHTML = "<em>gone</em>";
    return;
  }
  body.innerHTML = `
    <h2>${esc(v.name)}</h2>
    <div class="row muted">${v.stage}, ${Math.floor(v.ageDays / DAYS_PER_YEAR)} years · ${esc(v.skill)}</div>
    <div class="row">${v.traits.map(esc).join(", ")}. ${esc(cap(v.quirk))}.</div>
    ${bar("hunger", v.needs.hunger)}${bar("energy", v.needs.energy)}${bar("social", v.needs.social)}${bar("warmth", v.needs.warmth)}
    <div class="row"><b>Doing:</b> ${esc(describeGoal(v))} <span class="muted">(${v.source === "ai" ? "Claude" : "autopilot"})</span></div>
    ${v.lastThought ? `<div class="row"><b>Thinking:</b> <span class="muted">${esc(v.lastThought)}</span></div>` : ""}
    <div class="row"><b>Carrying:</b> ${Object.entries(v.inventory).filter(([, n]) => n).map(([k, n]) => `${n} ${k}`).join(", ") || "nothing"}</div>
    <div class="row"><b>Home:</b> ${v.homeId ? "yes" : "none"}</div>
    <div class="row"><b>Memories:</b><ul>${v.memory.slice(-8).map((m) => `<li>${esc(m)}</li>`).join("") || "<li>none yet</li>"}</ul></div>
  `;
}

function bar(label: string, value: number): string {
  return `<div class="row"><span class="muted">${label}</span> ${Math.round(value)}<div class="bar"><div style="width:${Math.max(0, Math.min(100, value))}%"></div></div></div>`;
}

function describeGoal(v: VillagerView): string {
  const g = v.goal;
  if (!g) return "deciding";
  switch (g.type) {
    case "wander": return "wandering";
    case "gather": return g.phase === "to_storehouse" ? `hauling ${g.resource} back` : `gathering ${g.resource}`;
    case "build": return "building";
    case "farm": return "working the farm";
    case "rest": return "resting";
    case "eat": return "going to eat";
    case "talk_to": return "looking for a chat";
    case "socialize_at": return "warming up by the fire";
    case "petition": return "calling a gathering at the shrine";
    case "fish": return g.phase === "to_storehouse" ? "bringing fish home" : "fishing";
    case "hunt": return g.phase === "chasing" ? "hunting" : "bringing meat home";
    case "tame": return g.phase === "approach" ? "sneaking up on a goat" : "leading a goat to the pen";
    case "mine": return g.phase === "to_storehouse" ? "hauling from the mine" : "working the mine";
    case "support": return "going to stand at the shrine";
  }
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}
function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
