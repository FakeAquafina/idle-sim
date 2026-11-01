// The side panel for whatever was clicked: a villager or a building.

import { DAYS_PER_YEAR, STRUCTURES, type Structure, type VillagerView } from "@idle-sim/shared";
import type { MirrorState } from "../net.ts";

type Selection = { kind: "villager"; id: string } | { kind: "structure"; id: string } | null;

let selected: Selection = null;
let onChange: ((sel: Selection) => void) | null = null;

export function onSelectionChange(fn: (sel: Selection) => void): void {
  onChange = fn;
}

export function currentSelection(): Selection {
  return selected;
}

export function select(sel: Selection, state: MirrorState | null): void {
  selected = sel;
  const panel = document.getElementById("inspector")!;
  panel.classList.toggle("hidden", !sel);
  onChange?.(sel);
  if (sel && state) renderInspector(state);
}

export function selectVillager(id: string | null, state: MirrorState | null): void {
  select(id ? { kind: "villager", id } : null, state);
}

export function renderInspector(state: MirrorState): void {
  if (!selected) return;
  const body = document.getElementById("inspectorBody")!;
  if (selected.kind === "structure") {
    const s = state.structures.find((x) => x.id === selected!.id);
    body.innerHTML = s ? structureHtml(s, state) : "<em>gone</em>";
    return;
  }
  const v = state.villagers.find((x) => x.id === selected!.id);
  if (!v) {
    body.innerHTML = "<em>gone</em>";
    return;
  }
  const name = (id: string) => state.villagers.find((x) => x.id === id)?.name ?? "someone";
  if (!v.alive) {
    body.innerHTML = `
    <h2>${esc(v.name)}</h2>
    <div class="row gone">${v.stage}, ${Math.floor(v.ageDays / DAYS_PER_YEAR)} years · ${esc(v.skill)} · died of ${esc(v.deathCause ?? "unknown causes")}</div>
    <div class="row">${v.traits.map(esc).join(", ")}. ${esc(cap(v.quirk))}.</div>
    <div class="row"><b>Remembered:</b><ul>${v.memory.slice(-8).map((m) => `<li>${esc(m)}</li>`).join("") || "<li>little</li>"}</ul></div>`;
    return;
  }
  const family: string[] = [];
  if (v.partnerId) family.push(`partner of ${esc(name(v.partnerId))}`);
  if (v.parentIds?.length) family.push(`child of ${v.parentIds.map((id) => esc(name(id))).join(" and ")}`);
  const kids = state.villagers.filter((o) => o.alive && o.parentIds?.includes(v.id)).map((o) => esc(o.name));
  if (kids.length) family.push(`parent of ${kids.join(", ")}`);
  const bonds = Object.entries(v.relationships)
    .map(([id, score]) => ({ o: state.villagers.find((x) => x.id === id && x.alive), score }))
    .filter((b): b is { o: VillagerView; score: number } => !!b.o && Math.abs(b.score) >= 5)
    .sort((a, b) => Math.abs(b.score) - Math.abs(a.score))
    .slice(0, 4)
    .map((b) => `<span class="bond">${esc(b.o.name)} <span class="muted">${relationWord(b.score)} ${b.score > 0 ? "+" : ""}${Math.round(b.score)}</span></span>`);
  const home = v.homeId ? state.structures.find((s) => s.id === v.homeId) : undefined;
  body.innerHTML = `
    <h2>${esc(v.name)}</h2>
    <div class="row muted">${v.stage}, ${Math.floor(v.ageDays / DAYS_PER_YEAR)} years · ${esc(v.skill)}</div>
    <div class="row">${v.traits.map(esc).join(", ")}. ${esc(cap(v.quirk))}.</div>
    ${family.length ? `<div class="row"><b>Family:</b> ${family.join("; ")}</div>` : ""}
    <div class="row"><b>Bonds:</b> ${bonds.join("") || '<span class="muted">none yet</span>'}</div>
    ${bar("hunger", v.needs.hunger)}${bar("energy", v.needs.energy)}${bar("social", v.needs.social)}${bar("warmth", v.needs.warmth)}
    <div class="row"><b>Doing:</b> ${esc(describeGoal(v))} <span class="muted">(${v.source === "ai" ? "Claude" : "autopilot"})</span></div>
    ${v.lastThought ? `<div class="row"><b>Thinking:</b> <span class="muted">${esc(v.lastThought)}</span></div>` : ""}
    <div class="row"><b>Owns:</b> ${invText(v.stock)}${v.coins ? ` · ${v.coins} coin` : ""}</div>
    <div class="row"><b>Carrying:</b> ${invText(v.inventory)}</div>
    <div class="row"><b>Home:</b> ${home ? esc(home.name ?? "a house") : "none"}</div>
    <div class="row"><b>Memories:</b><ul>${v.memory.slice(-8).map((m) => `<li>${esc(m)}</li>`).join("") || "<li>none yet</li>"}</ul></div>
  `;
}

function invText(inv: Partial<Record<string, number>> | undefined): string {
  return Object.entries(inv ?? {}).filter(([, n]) => n).map(([k, n]) => `${n} ${k}`).join(", ") || "nothing";
}

function structureHtml(s: Structure, state: MirrorState): string {
  const def = STRUCTURES[s.kind];
  const rows: string[] = [];
  if (s.hidden) rows.push(`<div class="row muted"><i>Standing out here unnoticed. Nobody in the village has found it yet.</i></div>`);
  if (!s.built) {
    const need = Object.entries(def.cost)
      .map(([k, n]) => ({ k, left: n - (s.delivered?.[k as keyof typeof s.delivered] ?? 0) }))
      .filter((x) => x.left > 0)
      .map((x) => `${x.left} ${x.k}`);
    rows.push(need.length ? `<div class="row"><b>Still needs:</b> ${need.join(", ")}</div>` : `<div class="row">${Math.round(s.progress * 100)}% built</div>${bar("progress", s.progress * 100)}`);
  }
  if (s.kind === "storehouse" && s.built) rows.push(`<div class="row"><b>Common store:</b> ${invText(state.storehouse)}</div>`);
  if (s.kind === "market" && s.built) rows.push(`<div class="row"><b>For sale:</b> ${invText(s.goods)}</div><div class="row"><b>Till:</b> ${s.till ?? 0} coin</div>`);
  const residents = s.ownerIds.map((id) => state.villagers.find((v) => v.id === id)).filter((v): v is VillagerView => !!v && v.alive);
  if (s.kind === "house") rows.push(`<div class="row"><b>Home of:</b> ${residents.map((v) => esc(v.name)).join(" and ") || '<span class="muted">nobody yet</span>'}</div>`);
  if (s.kind === "farm") rows.push(`<div class="row"><b>Crop:</b> ${farmWord(s.growth)}</div>`);
  if (s.kind === "mine" && s.reserve) rows.push(`<div class="row"><b>Vein:</b> ${s.depleted ? "worked out" : `${s.reserve.stone} stone, ${s.reserve.ore} ore left`}</div>`);
  if (s.kind === "pen") {
    const n = (state.animals ?? []).filter((a) => a.alive && a.penId === s.id).length;
    rows.push(`<div class="row"><b>Goats:</b> ${n} of ${def.capacity ?? 0}</div>`);
  }
  const cost = Object.entries(def.cost).map(([k, n]) => `${n} ${k}`).join(", ");
  return `
    <h2>${esc(s.name ?? def.label)}</h2>
    <div class="row muted">${s.name ? `${def.label.toLowerCase()} · ` : ""}${s.w}×${s.h} at ${s.x}, ${s.y}</div>
    <div class="row">${esc(def.description)}</div>
    ${rows.join("")}
    <div class="row muted">Cost ${cost}</div>`;
}

export function farmWord(growth: number | undefined): string {
  if (growth === undefined) return "nothing planted";
  if (growth >= 1) return "ripe";
  if (growth > 0.6) return "growing well";
  if (growth > 0.2) return "sprouting";
  return "just sown";
}

function bar(label: string, value: number): string {
  return `<div class="row"><span class="muted">${label}</span> ${Math.round(value)}<div class="bar"><div style="width:${Math.max(0, Math.min(100, value))}%"></div></div></div>`;
}

export function describeGoal(v: VillagerView): string {
  const g = v.goal;
  if (!g) return "deciding";
  switch (g.type) {
    case "wander": return "wandering";
    case "gather": return g.phase === "returning" ? (g.deliverTo ? `carrying ${g.resource} to a blueprint` : `carrying ${g.resource} home`) : g.resource === "food" ? "foraging" : `gathering ${g.resource}`;
    case "build": return g.phase === "fetching" ? "fetching materials" : g.phase === "delivering" ? "bringing materials to a blueprint" : "building";
    case "donate": return `taking ${g.resource} to the storehouse`;
    case "trade": return g.side === "sell" ? `off to sell ${g.resource}` : `off to buy ${g.resource}`;
    case "farm": return "working the farm";
    case "rest": return "resting";
    case "eat": return "going to eat";
    case "talk_to": return g.chatted ? "chatting" : "looking for a chat";
    case "socialize_at": return "warming up by the fire";
    case "petition": return "calling a gathering at the shrine";
    case "fish": return g.phase === "returning" ? "bringing fish home" : "fishing";
    case "hunt": return g.phase === "chasing" ? "hunting" : "bringing meat home";
    case "tame": return g.phase === "approach" ? "sneaking up on a goat" : "leading a goat to the pen";
    case "mine": return g.phase === "returning" ? "hauling from the mine" : "working the mine";
    case "support": return "going to stand at the shrine";
  }
}

function relationWord(score: number): string {
  if (score >= 40) return "close friend";
  if (score >= 15) return "friend";
  if (score <= -15) return "rival";
  return "acquaintance";
}

export function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}
function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
