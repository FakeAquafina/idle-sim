// Data-driven content. Adding a new building means adding an entry here;
// the simulation, the renderer, and (later) Claude's system prompt all read it.

import type { Inventory } from "./world.ts";

export type StructureFunction = "shelter" | "farm" | "storage" | "social" | "petition" | "water";

export interface StructureDef {
  label: string;
  description: string;
  w: number;
  h: number;
  cost: Inventory;
  /** Ticks of work (by one villager) to finish construction. */
  buildTicks: number;
  function: StructureFunction;
  /** Houses: how many villagers can live here. */
  capacity?: number;
  /** Hex color used by the placeholder renderer. */
  color: number;
}

export const STRUCTURES: Record<string, StructureDef> = {
  storehouse: {
    label: "Storehouse",
    description: "Shared stockpile of wood, stone, food and seeds.",
    w: 3,
    h: 2,
    cost: { wood: 30, stone: 10 },
    buildTicks: 12000,
    function: "storage",
    color: 0x8b5a2b,
  },
  house: {
    label: "House",
    description: "Shelter for up to two villagers. Needed to rest well and stay warm.",
    w: 2,
    h: 2,
    cost: { wood: 20, stone: 5 },
    buildTicks: 9000,
    function: "shelter",
    capacity: 2,
    color: 0xc98f5a,
  },
  farm: {
    label: "Farm plot",
    description: "Grows food. Needs seeds to plant and tending. Yields by season.",
    w: 2,
    h: 2,
    cost: { wood: 4 },
    buildTicks: 3000,
    function: "farm",
    color: 0x7a5c2e,
  },
  campfire: {
    label: "Campfire",
    description: "Where villagers gather to talk and warm up.",
    w: 1,
    h: 1,
    cost: { wood: 5, stone: 3 },
    buildTicks: 1200,
    function: "social",
    color: 0xe0762a,
  },
  shrine: {
    label: "Shrine",
    description: "Where villagers speak to the unseen provider.",
    w: 1,
    h: 1,
    cost: { stone: 8 },
    buildTicks: 4000,
    function: "petition",
    color: 0xb9b9c9,
  },
  well: {
    label: "Well",
    description: "Fresh water. Improves farm growth nearby.",
    w: 1,
    h: 1,
    cost: { stone: 12, wood: 4 },
    buildTicks: 6000,
    function: "water",
    color: 0x5a7ea3,
  },
};

export const RESOURCE_LABELS: Record<string, string> = {
  wood: "wood",
  stone: "stone",
  food: "food",
  seeds: "seeds",
};

/** Units of food one farm harvest produces. */
export const FARM_YIELD = 6;
/** Max resource units a villager carries before heading back. */
export const CARRY_LIMIT = 5;
