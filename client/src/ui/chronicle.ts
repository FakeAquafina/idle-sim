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
  if (!entries.length) {
    body.innerHTML = `<div class="muted">Nothing has been written yet. The chronicler writes a page at the end of each village day, and marks births, arrivals, deaths and the naming of buildings.</div>`;
    return;
  }
  body.innerHTML = [...entries]
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
  const kind = { day: "", obituary: "in memoriam · ", welcome: "welcome · ", naming: "naming · " }[e.kind];
  return `${kind}day ${e.day + 1}`;
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}
