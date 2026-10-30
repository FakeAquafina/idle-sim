import type { Vec2, WorldEvent, WorldState } from "@idle-sim/shared";

type Listener = (event: WorldEvent) => void;
const listeners: Listener[] = [];

/** Register a callback for every new world event (used by the network hub and the event log). */
export function onEvent(listener: Listener): void {
  listeners.push(listener);
}

export const MAX_RECENT_EVENTS = 200;

export function emitEvent(
  w: WorldState,
  kind: string,
  text: string,
  extra: { villagerIds?: string[]; pos?: Vec2 } = {},
): WorldEvent {
  const event: WorldEvent = { id: w.nextId++, tick: w.clock.tick, kind, text, ...extra };
  w.events.push(event);
  if (w.events.length > MAX_RECENT_EVENTS) w.events.splice(0, w.events.length - MAX_RECENT_EVENTS);
  for (const l of listeners) l(event);
  return event;
}
