import { describe, expect, it } from "vitest";
import type { WebSocket } from "ws";
import { Hub, MAX_PER_IP } from "../src/net/hub.ts";
import { createWorld } from "../src/sim/world.ts";
import { DEFAULT_SETTINGS } from "../src/settings.ts";

/** A stand-in for a ws socket that records what the hub sends it. */
function fakeSocket() {
  const sent: any[] = [];
  const handlers: Record<string, (...a: any[]) => void> = {};
  const sock = {
    OPEN: 1,
    readyState: 1,
    closedWith: undefined as number | undefined,
    send: (d: string) => sent.push(JSON.parse(d)),
    close: (code: number) => (sock.closedWith = code),
    on: (ev: string, fn: (...a: any[]) => void) => (handlers[ev] = fn),
    /** Simulate the client sending a message. */
    say: (msg: unknown) => handlers.message(JSON.stringify(msg)),
    sent,
  };
  return sock;
}

function hub(allowRemoteAdmin = false) {
  const world = createWorld(1, 16, 16);
  const settings = { ...DEFAULT_SETTINGS };
  return new Hub({
    getWorld: () => world,
    getSettings: () => settings,
    getAi: () => ({ enabled: true, keyPresent: false, spentHourUsd: 0, capUsd: 0, callsHour: 0, inflight: 0 }),
    adminToken: "secret",
    adminContext: () => ({ world, settings, reset: () => {}, saveSettings: () => {}, pickNewcomer: () => null, poke: () => {} }),
    serverInfo: () => ({ notifyConfigured: false, defaultFeeds: [] }),
    allowRemoteAdmin,
  });
}

describe("hub admin and connection rules", () => {
  it("a remote viewer with the right token is still just a viewer", () => {
    const h = hub();
    const s = fakeSocket();
    h.add(s as unknown as WebSocket, "secret", "203.0.113.9");
    expect(s.sent[0].type).toBe("snapshot");
    expect(s.sent[0].isAdmin).toBe(false);
    s.say({ type: "admin", token: "secret", command: { cmd: "pause" } });
    const result = s.sent.find((m) => m.type === "adminResult");
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/server itself/);
  });

  it("the same token from the server's own machine is admin", () => {
    const h = hub();
    const s = fakeSocket();
    h.add(s as unknown as WebSocket, "secret", "::ffff:127.0.0.1");
    expect(s.sent[0].isAdmin).toBe(true);
    s.say({ type: "admin", token: "secret", command: { cmd: "pause" } });
    expect(s.sent.find((m) => m.type === "adminResult").ok).toBe(true);
  });

  it("a wrong token from loopback is refused, and ADMIN_REMOTE opens it up", () => {
    const s1 = fakeSocket();
    hub().add(s1 as unknown as WebSocket, "nope", "127.0.0.1");
    expect(s1.sent[0].isAdmin).toBe(false);
    const s2 = fakeSocket();
    hub(true).add(s2 as unknown as WebSocket, "secret", "203.0.113.9");
    expect(s2.sent[0].isAdmin).toBe(true);
  });

  it("caps connections per address", () => {
    const h = hub();
    const socks = Array.from({ length: MAX_PER_IP + 1 }, () => fakeSocket());
    for (const s of socks) h.add(s as unknown as WebSocket, undefined, "198.51.100.4");
    expect(socks[MAX_PER_IP - 1].closedWith).toBeUndefined();
    expect(socks[MAX_PER_IP].closedWith).toBe(1013);
    const other = fakeSocket();
    h.add(other as unknown as WebSocket, undefined, "198.51.100.5");
    expect(other.closedWith).toBeUndefined();
  });
});
