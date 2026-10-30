// Data-driven content. Adding a new building means adding an entry here;
// the simulation, the renderer, and (later) Claude's system prompt all read it.

import type { Inventory } from "./world.ts";

export type StructureFunction =
  | "shelter"
  | "farm"
  | "storage"
  | "social"
  | "petition"
  | "water"
  | "fishing"
  | "mining"
  | "livestock"
  | "crafting";

/** Extra placement rule: the footprint must touch at least one tile of this kind. */
export type PlacementNeed = "water" | "rock";

export interface StructureDef {
  label: string;
  description: string;
  w: number;
  h: number;
  cost: Inventory;
  /** Ticks of work (by one villager) to finish construction. */
  buildTicks: number;
  function: StructureFunction;
  /** Houses: how many villagers can live here. Pens: how many animals. */
  capacity?: number;
  /** Docks must touch water, mines must touch rock or ore. */
  mustTouch?: PlacementNeed;
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
  dock: {
    label: "Dock",
    description: "A wooden jetty on the shore. Fishing from it is much faster than from the beach.",
    w: 2,
    h: 1,
    cost: { wood: 10 },
    buildTicks: 4000,
    function: "fishing",
    mustTouch: "water",
    color: 0x9c7a4a,
  },
  mine: {
    label: "Mine",
    description: "A shaft dug beside rock. Yields stone and, if the vein is good, ore. Veins run dry eventually.",
    w: 2,
    h: 2,
    cost: { wood: 12 },
    buildTicks: 6000,
    function: "mining",
    mustTouch: "rock",
    color: 0x4c4852,
  },
  pen: {
    label: "Pen",
    description: "A fenced yard for goats. Tame goats give food over time and breed slowly.",
    w: 3,
    h: 2,
    cost: { wood: 12 },
    buildTicks: 3500,
    function: "livestock",
    capacity: 4,
    color: 0xa38a5a,
  },
  workshop: {
    label: "Workshop",
    description: "Tools and a bench. Needs ore. Everyone works a quarter faster once it stands.",
    w: 2,
    h: 2,
    cost: { wood: 15, stone: 10, ore: 5 },
    buildTicks: 8000,
    function: "crafting",
    color: 0x7a6250,
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
  ore: "ore",
};

/** Food per animal caught. */
export const HUNT_YIELD: Record<string, number> = { deer: 5, goat: 3 };
/** Food each fish is worth. */
export const FISH_FOOD = 2;
/** Target number of wild animals roaming the map. */
export const WILD_ANIMAL_TARGET = 9;

/** Units of food one farm harvest produces. */
export const FARM_YIELD = 6;
/** Max resource units a villager carries before heading back. */
export const CARRY_LIMIT = 5;
