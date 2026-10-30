// WebSocket messages between server and viewers.

import type { Petition, PetitionAsk, Rumor } from "./actions.ts";
import type { AiStatus, Animal, ChronicleEntry, Clock, ResourceKind, Settings, Structure, Tile, Villager, WorldEvent, WorldState } from "./world.ts";

/** Villager as sent over the wire: same as Villager but without the path. */
export type VillagerView = Omit<Villager, "path">;

export interface SnapshotMessage {
  type: "snapshot";
  state: Omit<WorldState, "villagers" | "dirtyTiles" | "rngState"> & { villagers: VillagerView[] };
  viewers: number;
  isAdmin: boolean;
  settings: Settings;
  ai: AiStatus;
}

export interface DeltaMessage {
  type: "delta";
  clock: Clock;
  paused: boolean;
  speed: number;
  storehouse: Record<ResourceKind, number>;
  villagers: VillagerView[];
  structures: Structure[];
  animals: Animal[];
  tiles: { i: number; tile: Tile }[];
  petitions: Petition[];
  rumors: Rumor[];
  settings: Settings;
  ai: AiStatus;
}

export interface EventMessage {
  type: "event";
  event: WorldEvent;
}

/** A new page in the village chronicle. */
export interface ChronicleMessage {
  type: "chronicle";
  entry: ChronicleEntry;
}

export interface ViewersMessage {
  type: "viewers";
  count: number;
}

export interface AdminResultMessage {
  type: "adminResult";
  ok: boolean;
  message?: string;
}

export type ServerMessage = SnapshotMessage | DeltaMessage | EventMessage | ChronicleMessage | ViewersMessage | AdminResultMessage;

export type AdminCommand =
  | { cmd: "pause" }
  | { cmd: "resume" }
  | { cmd: "speed"; value: number }
  | { cmd: "reset" }
  | { cmd: "grant"; petitionId: string; amount?: number; message?: string }
  | { cmd: "deny"; petitionId: string; message?: string }
  | { cmd: "gift"; resource: Exclude<PetitionAsk, "newcomer">; amount?: number }
  | { cmd: "rumor"; text: string }
  | { cmd: "setAi"; enabled: boolean }
  | { cmd: "setBudget"; usdPerHour: number }
  | { cmd: "setNews"; enabled: boolean }
  | { cmd: "setBigMoments"; enabled: boolean }
  | { cmd: "setPopulationMax"; value: number };

export interface AdminMessage {
  type: "admin";
  token: string;
  command: AdminCommand;
}

export type ClientMessage = AdminMessage;
