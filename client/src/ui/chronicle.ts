// The village chronicle: a panel of pages written by the storyteller model.

import type { ChronicleEntry } from "@idle-sim/shared";

let entries: ChronicleEntry[] = [];
let open = false;

export function setupChronicle(): void {
  const btn = document.getElementById("chronicleBtn")!;
  const panel = document.getElementById("chronicle")!;
  btn.onclick = () => {
    open = !open;
    panel.classList.toggle("hidden", !open);
    btn.classList.toggle("active", open);
    if (open) render();
  };
  document.getElementById("chronicleClose")!.onclick = () => {
    open = false;
    panel.classList.add("hidden");
    btn.classList.remove("active");
  };
}

let learned: string[] = [];

/** Discoveries travellers have brought home, shown at the top of the chronicle. */
export function setLearned(names: string[]): void {
  const key = names.join("|");
  if (key === learned.join("|")) return;
  learned = names;
  if (open) render();
}

export function resetChronicle(list: ChronicleEntry[]): void {
  entries = [...list];
  updateCount();
  if (open) render();
}

export function addChronicleEntry(entry: ChronicleEntry): void {
  entries.push(entry);
  if (entries.length > 60) entries.splice(0, entries.length - 60);
  updateCount();
  if (open) render();
  else document.getElementById("chronicleBtn")!.classList.add("new");
}

function updateCount(): void {
  const el = document.getElementById("chronicleBtn")!;
  el.textContent = `📜 ${entries.length}`;
  el.title = entries.length ? "Open the village chronicle" : "The chronicle is still blank";
}

function render(): void {
  document.getElementById("chronicleBtn")!.classList.remove("new");
  const body = document.getElementById("chronicleBody")!;
  const learnedHtml = learned.length ? `<div class="page learned"><span class="page-title">What the village has learned</span><div class="page-text">${learned.map(esc).join(" · ")}</div></div>` : "";
  if (!entries.length) {
    body.innerHTML = `${learnedHtml}<div class="muted">Nothing has been written yet. The chronicler writes a page at the end of each village day, and marks births, arrivals, deaths, journeys and the naming of buildings.</div>`;
    return;
  }
  body.innerHTML = learnedHtml + [...entries]
    .reverse()
    .map(
      (e) => `<div class="page ${e.kind}">
        <div class="page-head"><span class="page-title">${esc(e.title)}</span><span class="muted">${label(e)}</span></div>
        <div class="page-text">${esc(e.text)}</div>
      </div>`,
    )
    .join("");
}

function label(e: ChronicleEntry): string {
  const kind = { day: "", obituary: "in memoriam · ", welcome: "welcome · ", naming: "naming · ", discovery: "a discovery · ", journey: "the road · " }[e.kind];
  return `${kind}day ${e.day + 1}`;
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}
