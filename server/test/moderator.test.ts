// The moderator's bookkeeping: proposals are stored, approved ones are written to docs/proposals.

import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { Moderator } from "../src/brain/moderator.ts";
import { Budget } from "../src/brain/budget.ts";
import { seedVillagers } from "../src/sim/seed.ts";
import { proposePetition } from "../src/sim/petitions.ts";
import { createWorld } from "../src/sim/world.ts";
import { establish } from "./helpers.ts";

describe("moderator", () => {
  it("needs a key to write, stores what it has, and files an approved proposal under docs/proposals", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "idle-sim-mod-"));
    const w = establish(createWorld(5));
    seedVillagers(w, [{ name: "Ada", traits: ["curious", "blunt"], quirk: "hums", skill: "farmer", ageYears: 30 }]);
    const notes: string[] = [];
    const m = new Moderator({ getWorld: () => w, client: null, budget: new Budget(), dataDir: dir, repoRoot: dir, notify: (t) => notes.push(t) });
    expect(m.request("nope").ok).toBe(false);
    const p = proposePetition(w, w.villagers[0], { ask: "seeds", amount: 5, reason: "bare fields" });
    expect(m.request(p.id)).toEqual({ ok: false, message: "No ANTHROPIC_API_KEY on the server" });

    // Pretend Opus answered.
    m.list().push({
      id: "mtest",
      petitionId: p.id,
      petitionText: "Ada asks for 5 seeds",
      createdAt: Date.now(),
      status: "pending",
      title: "A seed exchange",
      summary: "The village wants certainty about next year's planting.",
      changes: [{ area: "buildings", description: "A seed store beside the farms." }],
      flavour: "They built a little house for the seeds.",
      risks: "Could make farming too easy.",
      implementation_notes: "A new STRUCTURES entry and a goal.",
    });
    expect(m.reject("missing").ok).toBe(false);
    const approved = m.approve("mtest");
    expect(approved.ok).toBe(true);
    const file = m.list().find((x) => x.id === "mtest")!.file!;
    expect(file.startsWith(path.join("docs", "proposals"))).toBe(true);
    expect(existsSync(path.join(dir, file))).toBe(true);
    expect(readFileSync(path.join(dir, file), "utf8")).toContain("A seed exchange");
    expect(m.approve("mtest").ok).toBe(false); // already decided

    // A fresh instance reads the stored list back.
    const again = new Moderator({ getWorld: () => w, client: null, budget: new Budget(), dataDir: dir, repoRoot: dir, notify: () => {} });
    expect(again.list().find((x) => x.id === "mtest")?.status).toBe("approved");
  });
});
