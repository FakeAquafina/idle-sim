import type { Vec2, Villager, WorldState } from "@idle-sim/shared";
import { findPathToAny } from "../pathfind.ts";
import { toTileSet } from "../world.ts";
import { villagerTile } from "../villager.ts";

export type StepResult = "running" | "done" | "failed";
export type TravelState = "arrived" | "walking" | "unreachable";

/**
 * Walk toward any of the target tiles. Computes a path once; afterwards
 * reports "walking" until the villager stands on a target tile.
 */
export function travelTo(w: WorldState, v: Villager, targets: Vec2[]): TravelState {
  if (targets.length === 0) return "unreachable";
  const here = villagerTile(v);
  const set = toTileSet(w, targets);
  if (set.has(here.y * w.width + here.x) && v.path.length === 0) return "arrived";
  if (v.path.length > 0) return "walking";
  const path = findPathToAny(w, here, set);
  if (path === null) return "unreachable";
  if (path.length === 0) return "arrived";
  v.path = path;
  return "walking";
}
