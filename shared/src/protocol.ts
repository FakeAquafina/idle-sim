// WebSocket messages between server and viewers.

import type { Clock, ResourceKind, Structure, Tile, Villager, WorldEvent, WorldState } from "./world.ts";

/** Villager as sent over the wire: same as Villager but without the path. */
export type VillagerView = Omit<Villager, "path">;

export interface SnapshotMessage {
  type: "snapshot";
  state: Omit<WorldState, "villagers" | "dirtyTiles" | "rngState"> & { villagers: VillagerView[] };
  viewers: number;
  isAdmin: boolean;
}

export interface DeltaMessage {
  type: "delta";
  clock: Clock;
  paused: boolean;
  speed: number;
  storehouse: Record<ResourceKind, number>;
  villagers: VillagerView[];
  structures: Structure[];
  tiles: { i: number; tile: Tile }[];
}

export interface EventMessage {
  type: "event";
  event: WorldEvent;
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

export type ServerMessage = SnapshotMessage | DeltaMessage | EventMessage | ViewersMessage | AdminResultMessage;

export type AdminCommand =
  | { cmd: "pause" }
  | { cmd: "resume" }
  | { cmd: "speed"; value: number }
  | { cmd: "reset" };

export interface AdminMessage {
  type: "admin";
  token: string;
  command: AdminCommand;
}

export type ClientMessage = AdminMessage;
