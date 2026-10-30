import type { Villager, WorldState } from "@idle-sim/shared";
import { stepBuild } from "./build.ts";
import { stepEat } from "./eat.ts";
import { stepFarm } from "./farm.ts";
import { stepGather } from "./gather.ts";
import type { StepResult } from "./helpers.ts";
import { stepRest } from "./rest.ts";
import { stepSocializeAt } from "./socialize.ts";
import { stepTalkTo } from "./talk.ts";
import { stepWander } from "./wander.ts";

export type { StepResult } from "./helpers.ts";

/** Advance the villager's current goal by one tick. */
export function stepGoal(w: WorldState, v: Villager): StepResult {
  const g = v.goal;
  if (!g) return "done";
  switch (g.type) {
    case "wander":
      return stepWander(w, v, g);
    case "gather":
      return stepGather(w, v, g);
    case "build":
      return stepBuild(w, v, g);
    case "farm":
      return stepFarm(w, v, g);
    case "rest":
      return stepRest(w, v, g);
    case "eat":
      return stepEat(w, v);
    case "socialize_at":
      return stepSocializeAt(w, v, g);
    case "talk_to":
      return stepTalkTo(w, v, g);
    case "petition":
      return "done"; // Phase 2
  }
}
