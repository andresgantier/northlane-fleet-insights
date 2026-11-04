import "server-only";
import { isStepCount } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { queryAsUser } from "@/lib/db";
import type { AppUser } from "@/lib/session";
import { buildTools, type ToolContext } from "./tools";
import { systemPrompt } from "./prompt";

// Free-tier model (official model list, Nov 2026). Tested options: gemini-3.8-flash returned 503
// "high demand"; gemini-3.6-flash allows only 20 requests per day on the free tier (~6 questions).
// gemini-3.5-flash-lite is stable, recommended by Google for new projects and has its own quota.
export const MODEL_ID = "gemini-3.5-flash-lite";

const google = createGoogleGenerativeAI({ apiKey: process.env.GEMINI_API_KEY });

// Everything the model call needs for one user: model, instructions and the user's tools.
// Shared by the chat route (streamText) and the evaluation script (generateText).
export async function assistantSettings(user: AppUser) {
  const [meta, orgs, types] = await queryAsUser(user.id, (sql) => [
    sql`select app.as_of()::text as as_of, (select min(start_date)::text from public.downtime_events) as first_episode`,
    sql`select code from public.organizations order by code`,
    sql`select name from public.vehicle_types order by name`,
  ]);
  const ctx: ToolContext = {
    userId: user.id,
    asOf: String(meta[0].as_of),
    organizations: orgs.map((r) => String(r.code)),
    vehicleTypes: types.map((r) => String(r.name)),
    isSupervisor: user.role === "depot_supervisor",
    depot: user.organizationCode,
  };
  return {
    model: google(MODEL_ID),
    system: systemPrompt({ ...ctx, firstEpisode: String(meta[0].first_episode) }),
    tools: buildTools(ctx),
    stopWhen: isStepCount(8),
    // The last allowed step must be the written answer, never another tool call.
    prepareStep: ({ stepNumber }: { stepNumber: number }) => (stepNumber >= 6 ? { toolChoice: "none" as const } : undefined),
    maxRetries: 2,
    providerOptions: { google: { thinkingConfig: { thinkingLevel: "low" as const } } },
  };
}
