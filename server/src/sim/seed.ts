// Populate a fresh world with the starting villagers.

import type { WorldState } from "@idle-sim/shared";
import { seedAnimals } from "./animals.ts";
import { emitEvent } from "./events.ts";
import { randInt } from "./rng.ts";
import { createVillager, type Persona } from "./villager.ts";
import { assignHomes, isWalkable, villageCenter } from "./world.ts";

export function seedVillagers(w: WorldState, personas: Persona[]): void {
  const c = villageCenter(w);
  for (const p of personas) {
    let tile = { x: c.x, y: c.y + 3 };
    for (let i = 0; i < 40; i++) {
      const candidate = { x: c.x + randInt(w, -4, 4), y: c.y + randInt(w, -2, 5) };
      if (isWalkable(w, candidate.x, candidate.y)) {
        tile = candidate;
        break;
      }
    }
    w.villagers.push(createVillager(w, p, tile));
  }
  assignHomes(w);
  if (w.animals.length === 0) seedAnimals(w);
  emitEvent(w, "founded", `${personas.length} settlers arrive and make camp around the fire.`);
}
