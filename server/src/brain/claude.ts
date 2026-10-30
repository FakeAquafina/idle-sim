// The only file that talks to the Anthropic API.

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { PlanOutputSchema, type PlanOutput } from "@idle-sim/shared";

export const PLAN_MODEL = "claude-haiku-5-5";

/** Null when no API key is configured; the village then runs on autopilot. */
export function makeClient(): Anthropic | null {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  return new Anthropic({ maxRetries: 1, timeout: 30_000 });
}

export interface PlanResult {
  plan: PlanOutput | null;
  usage: Anthropic.Usage | null;
  error?: string;
}

export async function requestPlan(client: Anthropic, systemPrompt: string, userPrompt: string): Promise<PlanResult> {
  try {
    const res = await client.messages.parse({
      model: PLAN_MODEL,
      max_tokens: 2000,
      system: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: userPrompt }],
      output_config: { effort: "low", format: zodOutputFormat(PlanOutputSchema) },
    });
    if (res.stop_reason === "refusal") return { plan: null, usage: res.usage, error: "refused" };
    if (!res.parsed_output) return { plan: null, usage: res.usage, error: `unparseable (${res.stop_reason})` };
    return { plan: res.parsed_output, usage: res.usage };
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) return { plan: null, usage: null, error: "invalid API key" };
    if (err instanceof Anthropic.RateLimitError) return { plan: null, usage: null, error: "rate limited" };
    if (err instanceof Anthropic.APIError) return { plan: null, usage: null, error: `API error ${err.status}: ${err.message}` };
    return { plan: null, usage: null, error: `unexpected: ${(err as Error).message}` };
  }
}
