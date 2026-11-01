// Who owns what. Every villager has a personal stock (kept at home, or in a
// bundle at the camp when they have no house); people sharing a house share
// theirs; the storehouse, once built, is a common store anyone may draw on.

import { CARRY_LIMIT, type Inventory, type ResourceKind, type Structure, type Vec2, type Villager, type WorldState } from "@idle-sim/shared";
import { adjacentToStructure, isWalkable, ringAround, structuresWithFunction } from "./world.ts";

export const RESOURCES: ResourceKind[] = ["wood", "stone", "food", "seeds", "ore"];

export function amountOf(inv: Inventory, k: ResourceKind): number {
  return inv[k] ?? 0;
}

export function addTo(inv: Inventory, k: ResourceKind, n: number): void {
  if (n <= 0) return;
  inv[k] = (inv[k] ?? 0) + n;
}

/** Take up to n of k out of inv; returns how much actually came out. */
export function takeFrom(inv: Inventory, k: ResourceKind, n: number): number {
  const have = inv[k] ?? 0;
  const taken = Math.max(0, Math.min(have, Math.floor(n)));
  if (taken > 0) inv[k] = have - taken;
  return taken;
}

export function totalUnits(inv: Inventory): number {
  return RESOURCES.reduce((n, k) => n + (inv[k] ?? 0), 0);
}

/** Everyone sharing this villager's house (including them); just them when homeless. */
export function householdOf(w: WorldState, v: Villager): Villager[] {
  if (!v.homeId) return [v];
  const mates = w.villagers.filter((o) => o.alive && o.homeId === v.homeId && o.id !== v.id);
  return [v, ...mates];
}

/** What the household owns between them. */
export function householdStock(w: WorldState, v: Villager): Record<ResourceKind, number> {
  const out = { wood: 0, stone: 0, food: 0, seeds: 0, ore: 0 };
  for (const m of householdOf(w, v)) for (const k of RESOURCES) out[k] += m.stock[k] ?? 0;
  return out;
}

/** Take up to n of k from this villager's own stock first, then from housemates'. */
export function takeFromHousehold(w: WorldState, v: Villager, k: ResourceKind, n: number): number {
  let got = 0;
  for (const m of householdOf(w, v)) {
    if (got >= n) break;
    got += takeFrom(m.stock, k, n - got);
  }
  return got;
}

export function hasStorehouse(w: WorldState): boolean {
  return structuresWithFunction(w, "storage").length > 0;
}

/** Walkable tiles around the camp: where the homeless keep their bundles. */
export function campSpots(w: WorldState): Vec2[] {
  const c = w.camp;
  const spots = ringAround(w, c.x, c.y, 1, 1);
  if (isWalkable(w, c.x, c.y)) spots.push({ x: c.x, y: c.y });
  return spots;
}

/** Where a villager keeps their things: beside their house, or at the camp. */
export function homeSpot(w: WorldState, v: Villager): Vec2[] {
  const house = v.homeId ? w.structures.find((s) => s.id === v.homeId && s.built) : undefined;
  return house ? adjacentToStructure(w, house) : campSpots(w);
}

/** Put everything carried into the villager's own stock. */
export function depositInventory(v: Villager): void {
  for (const k of RESOURCES) {
    const n = v.inventory[k] ?? 0;
    if (n > 0) addTo(v.stock, k, n);
    v.inventory[k] = 0;
  }
}

/** What a blueprint still needs. */
export function remainingCost(s: Structure, cost: Inventory): Inventory {
  const out: Inventory = {};
  for (const k of RESOURCES) {
    const left = (cost[k] ?? 0) - (s.delivered?.[k] ?? 0);
    if (left > 0) out[k] = left;
  }
  return out;
}

/** Load up to CARRY_LIMIT units of what `need` lists out of `source` into the villager's hands. */
export function loadFor(v: Villager, need: Inventory, source: Inventory): number {
  let room = CARRY_LIMIT - totalUnits(v.inventory);
  let loaded = 0;
  for (const k of RESOURCES) {
    if (room <= 0) break;
    const want = Math.min(need[k] ?? 0, room);
    if (want <= 0) continue;
    const got = takeFrom(source, k, want);
    addTo(v.inventory, k, got);
    room -= got;
    loaded += got;
  }
  return loaded;
}

/** Hand carried materials to a blueprint. Leftovers go back into the villager's own stock. */
export function deliverMaterials(s: Structure, cost: Inventory, v: Villager): number {
  s.delivered ??= {};
  const need = remainingCost(s, cost);
  let given = 0;
  for (const k of RESOURCES) {
    const give = Math.min(need[k] ?? 0, v.inventory[k] ?? 0);
    if (give > 0) {
      addTo(s.delivered, k, give);
      v.inventory[k] = (v.inventory[k] ?? 0) - give;
      given += give;
    }
  }
  depositInventory(v);
  return given;
}

/** Food this villager can lay hands on without buying: carried, own, household, common store. */
export function foodWithinReach(w: WorldState, v: Villager): number {
  return (v.inventory.food ?? 0) + householdStock(w, v).food + (hasStorehouse(w) ? w.storehouse.food : 0);
}
