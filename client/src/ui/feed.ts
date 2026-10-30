// The event feed in the bottom-left corner. Entries with a place attached can
// be clicked to swing the camera there.

import type { Vec2, WorldEvent } from "@idle-sim/shared";
import { TICKS_PER_DAY } from "@idle-sim/shared";

const MAX = 60;
let jump: ((target: { pos?: Vec2; villagerId?: string }) => void) | null = null;

export function setupFeed(onJump: (target: { pos?: Vec2; villagerId?: string }) => void): void {
  jump = onJump;
}

export function addEvent(e: WorldEvent): void {
  const feed = document.getElementById("feed")!;
  const div = document.createElement("div");
  div.className = `ev k-${e.kind}`;
  const day = Math.floor(e.tick / TICKS_PER_DAY) + 1;
  const tod = (e.tick % TICKS_PER_DAY) / TICKS_PER_DAY;
  const hh = String(Math.floor(tod * 24)).padStart(2, "0");
  div.innerHTML = `<span class="t">d${day} ${hh}h</span>`;
  div.appendChild(document.createTextNode(e.text));
  if (e.pos || e.villagerIds?.length) {
    div.classList.add("link");
    div.title = "Show me";
    div.onclick = () => jump?.({ pos: e.pos, villagerId: e.villagerIds?.[0] });
  }
  feed.prepend(div);
  while (feed.childElementCount > MAX) feed.lastElementChild?.remove();
}

export function resetFeed(events: WorldEvent[]): void {
  const feed = document.getElementById("feed")!;
  feed.innerHTML = "";
  for (const e of events.slice(-MAX)) addEvent(e);
}
