// The village chronicle: pages written by the storyteller model (or, without
// one, short plain entries). Kept in world state so it survives restarts.

import type { ChronicleEntry, WorldState } from "@idle-sim/shared";

export const MAX_CHRONICLE = 60;

type Listener = (entry: ChronicleEntry) => void;
const listeners: Listener[] = [];

export function onChronicle(l: Listener): void {
  listeners.push(l);
}

export function addChronicleEntry(w: WorldState, kind: ChronicleEntry["kind"], title: string, text: string): ChronicleEntry {
  const entry: ChronicleEntry = { id: w.nextId++, tick: w.clock.tick, day: w.clock.day, kind, title: title.slice(0, 80), text: text.slice(0, 1500) };
  w.chronicle.push(entry);
  if (w.chronicle.length > MAX_CHRONICLE) w.chronicle.splice(0, w.chronicle.length - MAX_CHRONICLE);
  for (const l of listeners) l(entry);
  return entry;
}
