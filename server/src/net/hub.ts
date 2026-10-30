// Tracks connected viewers and pushes world updates to them.

import type { WebSocket } from "ws";
import type {
  AiStatus,
  ChronicleEntry,
  ClientMessage,
  DeltaMessage,
  ServerMessage,
  ServerInfo,
  Settings,
  SnapshotMessage,
  VillagerView,
  WorldEvent,
  WorldState,
} from "@idle-sim/shared";
import { runAdminCommand, tokenMatches, type AdminContext } from "./admin.ts";

interface Client {
  socket: WebSocket;
  isAdmin: boolean;
  ip: string;
}

export const MAX_VIEWERS = 25;
/** One person opening a few tabs is fine; a flood from one address is not. */
export const MAX_PER_IP = 5;

/** True for connections made from the server machine itself (SSH tunnels and scripts land here). */
export function isLoopback(addr: string | undefined): boolean {
  if (!addr) return false;
  const a = addr.replace(/^::ffff:/, "");
  return a === "127.0.0.1" || a === "::1" || a.startsWith("127.");
}

export interface HubDeps {
  getWorld: () => WorldState;
  getSettings: () => Settings;
  getAi: () => AiStatus;
  adminToken: string;
  adminContext: () => AdminContext;
  serverInfo: () => ServerInfo;
  /**
   * Admin commands are honoured only from loopback unless this is true, so a
   * server on the open internet never has a usable admin path, even with the
   * token. Reach the admin UI through an SSH tunnel or scripts/admin.ts.
   */
  allowRemoteAdmin?: boolean;
}

export class Hub {
  private clients = new Set<Client>();

  constructor(private deps: HubDeps) {}

  get viewerCount(): number {
    return this.clients.size;
  }

  add(socket: WebSocket, token?: string, remoteAddress?: string): void {
    const ip = remoteAddress ?? "unknown";
    if (this.clients.size >= MAX_VIEWERS) {
      socket.close(1013, "Too many viewers");
      return;
    }
    let fromSameIp = 0;
    for (const c of this.clients) if (c.ip === ip) fromSameIp++;
    if (fromSameIp >= MAX_PER_IP) {
      socket.close(1013, "Too many connections from your address");
      return;
    }
    const client: Client = { socket, ip, isAdmin: this.adminAllowed(ip) && tokenMatches(token, this.deps.adminToken) };
    this.clients.add(client);
    socket.on("message", (raw) => this.onMessage(client, raw.toString()));
    socket.on("close", () => {
      this.clients.delete(client);
      this.broadcast({ type: "viewers", count: this.clients.size });
    });
    socket.on("error", () => socket.close());
    this.send(client, this.snapshot(client.isAdmin));
    this.broadcast({ type: "viewers", count: this.clients.size });
  }

  snapshot(isAdmin: boolean): SnapshotMessage {
    const w = this.deps.getWorld();
    const { villagers, dirtyTiles: _d, rngState: _r, ...rest } = w;
    return {
      type: "snapshot",
      state: { ...rest, villagers: villagers.map(stripPath) },
      viewers: this.clients.size,
      isAdmin,
      settings: this.deps.getSettings(),
      ai: this.deps.getAi(),
      server: this.deps.serverInfo(),
    };
  }

  broadcastSnapshot(): void {
    for (const c of this.clients) this.send(c, this.snapshot(c.isAdmin));
  }

  broadcastDelta(): void {
    const w = this.deps.getWorld();
    if (this.clients.size === 0) {
      w.dirtyTiles = [];
      return;
    }
    const tiles = [...new Set(w.dirtyTiles)].map((i) => ({ i, tile: w.tiles[i] }));
    w.dirtyTiles = [];
    const msg: DeltaMessage = {
      type: "delta",
      clock: w.clock,
      paused: w.paused,
      speed: w.speed,
      storehouse: w.storehouse,
      villagers: w.villagers.map(stripPath),
      structures: w.structures,
      animals: w.animals,
      tiles,
      petitions: w.petitions,
      rumors: w.rumors,
      settings: this.deps.getSettings(),
      ai: this.deps.getAi(),
    };
    this.broadcast(msg);
  }

  broadcastEvent(event: WorldEvent): void {
    this.broadcast({ type: "event", event });
  }

  broadcastChronicle(entry: ChronicleEntry): void {
    this.broadcast({ type: "chronicle", entry });
  }

  private onMessage(client: Client, raw: string): void {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (msg.type !== "admin") return;
    if (!this.adminAllowed(client.ip)) {
      this.send(client, { type: "adminResult", ok: false, message: "Admin only works from the server itself (SSH tunnel or scripts/admin.ts)" });
      return;
    }
    if (!tokenMatches(msg.token, this.deps.adminToken)) {
      this.send(client, { type: "adminResult", ok: false, message: "Bad admin token" });
      return;
    }
    const result = runAdminCommand(msg.command, this.deps.adminContext());
    this.send(client, { type: "adminResult", ...result });
    if (msg.command.cmd === "reset") this.broadcastSnapshot();
    else this.broadcastDelta();
  }

  private adminAllowed(ip: string): boolean {
    return !!this.deps.allowRemoteAdmin || isLoopback(ip);
  }

  private send(client: Client, msg: ServerMessage): void {
    if (client.socket.readyState === client.socket.OPEN) client.socket.send(JSON.stringify(msg));
  }

  private broadcast(msg: ServerMessage): void {
    const data = JSON.stringify(msg);
    for (const c of this.clients) if (c.socket.readyState === c.socket.OPEN) c.socket.send(data);
  }
}

function stripPath(v: WorldState["villagers"][number]): VillagerView {
  const { path: _p, ...rest } = v;
  return rest;
}
