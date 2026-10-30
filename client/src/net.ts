// WebSocket client plus a local mirror of the world that deltas are applied to.

import type { AdminCommand, ChronicleEntry, ClientMessage, DeltaMessage, ServerMessage, SnapshotMessage, WorldEvent } from "@idle-sim/shared";

import type { AiStatus, Settings } from "@idle-sim/shared";

export type MirrorState = SnapshotMessage["state"];

export class Mirror {
  state: MirrorState | null = null;
  settings: Settings | null = null;
  ai: AiStatus | null = null;

  applySnapshot(msg: SnapshotMessage): void {
    this.state = msg.state;
    this.settings = msg.settings;
    this.ai = msg.ai;
  }

  /** Returns true if any tiles changed (so the renderer can redraw terrain). */
  applyDelta(msg: DeltaMessage): boolean {
    const s = this.state;
    if (!s) return false;
    s.clock = msg.clock;
    s.paused = msg.paused;
    s.speed = msg.speed;
    s.storehouse = msg.storehouse;
    s.villagers = msg.villagers;
    s.structures = msg.structures;
    s.animals = msg.animals;
    for (const { i, tile } of msg.tiles) s.tiles[i] = tile;
    s.petitions = msg.petitions;
    s.rumors = msg.rumors;
    this.settings = msg.settings;
    this.ai = msg.ai;
    return msg.tiles.length > 0;
  }
}

export type ConnectionStatus = "connecting" | "connected" | "disconnected";

export interface NetHandlers {
  onSnapshot(msg: SnapshotMessage): void;
  onDelta(msg: DeltaMessage): void;
  onEvent(event: WorldEvent): void;
  onChronicle(entry: ChronicleEntry): void;
  onViewers(count: number): void;
  onAdminResult(ok: boolean, message?: string): void;
  onStatus(status: ConnectionStatus): void;
}

export interface Connection {
  sendAdmin(command: AdminCommand): void;
}

export function connect(token: string | null, handlers: NetHandlers): Connection {
  let socket: WebSocket | null = null;
  let retryMs = 1000;

  const url = () => {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const q = token ? `?token=${encodeURIComponent(token)}` : "";
    return `${proto}://${location.host}/ws${q}`;
  };

  const open = () => {
    handlers.onStatus("connecting");
    socket = new WebSocket(url());
    socket.onopen = () => {
      retryMs = 1000;
      handlers.onStatus("connected");
    };
    socket.onmessage = (ev) => {
      const msg = JSON.parse(ev.data) as ServerMessage;
      switch (msg.type) {
        case "snapshot":
          handlers.onSnapshot(msg);
          break;
        case "delta":
          handlers.onDelta(msg);
          break;
        case "event":
          handlers.onEvent(msg.event);
          break;
        case "chronicle":
          handlers.onChronicle(msg.entry);
          break;
        case "viewers":
          handlers.onViewers(msg.count);
          break;
        case "adminResult":
          handlers.onAdminResult(msg.ok, msg.message);
          break;
      }
    };
    socket.onclose = () => {
      handlers.onStatus("disconnected");
      setTimeout(open, retryMs);
      retryMs = Math.min(retryMs * 2, 10_000);
    };
    socket.onerror = () => socket?.close();
  };
  open();

  return {
    sendAdmin(command) {
      if (!token || !socket || socket.readyState !== WebSocket.OPEN) return;
      const msg: ClientMessage = { type: "admin", token, command };
      socket.send(JSON.stringify(msg));
    },
  };
}
