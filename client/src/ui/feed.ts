import type { WorldEvent } from "@idle-sim/shared";
import { TICKS_PER_DAY } from "@idle-sim/shared";

const MAX = 60;

export function addEvent(e: WorldEvent): void {
  const feed = document.getElementById("feed")!;
  const div = document.createElement("div");
  div.className = "ev";
  const day = Math.floor(e.tick / TICKS_PER_DAY) + 1;
  const tod = (e.tick % TICKS_PER_DAY) / TICKS_PER_DAY;
  const hh = String(Math.floor(tod * 24)).padStart(2, "0");
  div.innerHTML = `<span class="t">d${day} ${hh}h</span>`;
  div.appendChild(document.createTextNode(e.text));
  feed.prepend(div);
  while (feed.childElementCount > MAX) feed.lastElementChild?.remove();
}

export function resetFeed(events: WorldEvent[]): void {
  const feed = document.getElementById("feed")!;
  feed.innerHTML = "";
  for (const e of events.slice(-MAX)) addEvent(e);
}
