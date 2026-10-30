// Conversations between two villagers. The simulation only plays lines out,
// tick by tick; who writes the lines (Claude, or the canned fallback) is decided
// by a handler the brain registers at startup. Everything here is deterministic
// and lives in world state, so a save mid-chat resumes cleanly.

import { TICKS_PER_SECOND, type Conversation, type Villager, type WorldState } from "@idle-sim/shared";
import { pick } from "./rng.ts";
import { remember, say } from "./villager.ts";

/** Seconds each line stays on screen before the next is spoken. */
const LINE_SECONDS = 5;
/** A pending conversation older than this gets canned lines (e.g. after a restart). */
const PENDING_GIVE_UP_TICKS = 2 * 60 * TICKS_PER_SECOND;

export const TONE_AFFINITY: Record<Conversation["tone"], number> = { warm: 6, neutral: 2, tense: -4 };

/**
 * Called when two villagers meet. Return true to take over writing the lines
 * (the conversation stays pending until fillConversation is called).
 */
export type MeetHandler = (w: WorldState, c: Conversation, a: Villager, b: Villager) => boolean;
let meetHandler: MeetHandler | null = null;
export function setMeetHandler(h: MeetHandler | null): void {
  meetHandler = h;
}

export function inConversation(w: WorldState, villagerId: string): Conversation | undefined {
  return w.conversations.find((c) => c.aId === villagerId || c.bId === villagerId);
}

/** Two villagers have met face to face: start talking. */
export function beginConversation(w: WorldState, a: Villager, b: Villager): Conversation {
  const c: Conversation = {
    id: `c${w.nextId++}`,
    aId: a.id,
    bId: b.id,
    startedTick: w.clock.tick,
    lines: [],
    nextLine: 0,
    nextTick: w.clock.tick,
    tone: "neutral",
    pending: true,
  };
  w.conversations.push(c);
  // The listener stays put too: give them a matching goal so they don't walk off.
  b.goal = { type: "talk_to", villagerId: a.id, chatted: true };
  b.goalStartedTick = w.clock.tick;
  b.path = [];
  if (!meetHandler || !meetHandler(w, c, a, b)) fillConversation(w, c.id, cannedLines(w, a, b), "neutral");
  return c;
}

/** Supply the lines (from Claude or the fallback). Safe to call for a conversation that no longer exists. */
export function fillConversation(
  w: WorldState,
  id: string,
  lines: Conversation["lines"],
  tone: Conversation["tone"],
  notes?: Conversation["notes"],
): void {
  const c = w.conversations.find((x) => x.id === id);
  if (!c || !c.pending) return;
  c.lines = lines.slice(0, 4);
  c.tone = tone;
  c.notes = notes;
  c.pending = false;
  c.nextTick = w.clock.tick;
}

/** Play out one line at a time; wrap up finished talks. Call once per tick. */
export function tickConversations(w: WorldState): void {
  for (const c of [...w.conversations]) {
    const a = w.villagers.find((v) => v.id === c.aId && v.alive);
    const b = w.villagers.find((v) => v.id === c.bId && v.alive);
    if (!a || !b) {
      remove(w, c);
      continue;
    }
    if (c.pending) {
      if (w.clock.tick - c.startedTick > PENDING_GIVE_UP_TICKS) fillConversation(w, c.id, cannedLines(w, a, b), "neutral");
      continue;
    }
    if (w.clock.tick < c.nextTick) continue;
    if (c.nextLine >= c.lines.length) {
      finish(w, c, a, b);
      continue;
    }
    const line = c.lines[c.nextLine++];
    const speaker = line.speakerId === b.id ? b : a;
    say(w, speaker, line.text.slice(0, 120), LINE_SECONDS + 1);
    c.nextTick = w.clock.tick + LINE_SECONDS * TICKS_PER_SECOND;
  }
}

function finish(w: WorldState, c: Conversation, a: Villager, b: Villager): void {
  const delta = TONE_AFFINITY[c.tone];
  a.relationships[b.id] = clampAffinity((a.relationships[b.id] ?? 0) + delta);
  b.relationships[a.id] = clampAffinity((b.relationships[a.id] ?? 0) + delta);
  const social = c.tone === "tense" ? 8 : 25;
  a.needs.social = Math.min(100, a.needs.social + social);
  b.needs.social = Math.min(100, b.needs.social + social);
  if (c.notes?.a) remember(a, c.notes.a.slice(0, 100));
  if (c.notes?.b) remember(b, c.notes.b.slice(0, 100));
  remove(w, c);
}

function remove(w: WorldState, c: Conversation): void {
  const i = w.conversations.indexOf(c);
  if (i >= 0) w.conversations.splice(i, 1);
}

export function clampAffinity(n: number): number {
  return Math.max(-100, Math.min(100, Math.round(n * 10) / 10));
}

// Small talk for when Claude is unavailable.
const OPENERS = [
  "Fine weather for it.",
  "The storehouse looked a little bare.",
  "My back aches from all that hauling.",
  "Did you hear the wind last night?",
  "We could use another pair of hands.",
  "I had the strangest dream.",
];
const REPLIES = ["Aye, that's so.", "Tell me about it.", "You always say that.", "Hm. Maybe.", "We'll manage.", "Is that right?"];

export function cannedLines(w: WorldState, a: Villager, b: Villager): Conversation["lines"] {
  return [
    { speakerId: a.id, text: pick(w, OPENERS) },
    { speakerId: b.id, text: pick(w, REPLIES) },
  ];
}
