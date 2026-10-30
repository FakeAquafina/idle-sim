// The only file that talks to the Anthropic API.
//
// Two models: Haiku for the many small, cheap decisions (plans, chats, memory
// notes, personas, gossip) and Opus for the few "big moments" a day (chronicle,
// obituaries, welcomes, names). Everything comes back as validated JSON.

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { PlanOutputSchema, type PlanOutput } from "@idle-sim/shared";
import type { z } from "zod/v4";

export const PLAN_MODEL = "claude-haiku-5-5";
export const STORY_MODEL = "claude-opus-5-5";

/** Null when no API key is configured; the village then runs on autopilot. */
export function makeClient(): Anthropic | null {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  return new Anthropic({ maxRetries: 1, timeout: 45_000 });
}

export interface StructuredResult<T> {
  output: T | null;
  usage: Anthropic.Usage | null;
  error?: string;
}

export interface StructuredOptions {
  model?: string;
  maxTokens?: number;
  effort?: "low" | "medium" | "high";
  /** Cache the system prompt (worth it for the Haiku prompt that is reused all day). */
  cacheSystem?: boolean;
}

/** Ask for JSON matching a schema. Never throws: errors come back as a short reason. */
export async function requestStructured<S extends z.ZodType>(
  client: Anthropic,
  systemPrompt: string,
  userPrompt: string,
  schema: S,
  opts: StructuredOptions = {},
): Promise<StructuredResult<z.infer<S>>> {
  const model = opts.model ?? PLAN_MODEL;
  const story = model === STORY_MODEL;
  try {
    const res = await client.beta.messages.parse({
      model,
      max_tokens: opts.maxTokens ?? 2000,
      system: [{ type: "text", text: systemPrompt, ...(opts.cacheSystem !== false ? { cache_control: { type: "ephemeral" as const } } : {}) }],
      messages: [{ role: "user", content: userPrompt }],
      output_config: { effort: opts.effort ?? "low", format: zodOutputFormat(schema) },
      // Opus can decline a request outright; let the API re-run it on a fallback model when that happens.
      ...(story ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
    });
    const usage = res.usage as unknown as Anthropic.Usage;
    if (res.stop_reason === "refusal") return { output: null, usage, error: "refused" };
    if (!res.parsed_output) return { output: null, usage, error: `unparseable (${res.stop_reason})` };
    return { output: res.parsed_output as z.infer<S>, usage };
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) return { output: null, usage: null, error: "invalid API key" };
    if (err instanceof Anthropic.RateLimitError) return { output: null, usage: null, error: "rate limited" };
    if (err instanceof Anthropic.APIError) return { output: null, usage: null, error: `API error ${err.status}: ${err.message}` };
    return { output: null, usage: null, error: `unexpected: ${(err as Error).message}` };
  }
}

export interface PlanResult {
  plan: PlanOutput | null;
  usage: Anthropic.Usage | null;
  error?: string;
}

export async function requestPlan(client: Anthropic, systemPrompt: string, userPrompt: string): Promise<PlanResult> {
  const r = await requestStructured(client, systemPrompt, userPrompt, PlanOutputSchema);
  return { plan: r.output, usage: r.usage, error: r.error };
}
