// Asks the assistant questions from the terminal, as a demo role (npm run ask -- [--supervisor] "question" ["follow-up" ...]).
// Same model, instructions and tools as the chat page; later questions are follow-ups of the earlier ones.
// Runs with tsx and the react-server condition so server-only modules load outside Next.js.

import { neon } from "@neondatabase/serverless";
import type { ModelMessage } from "ai";

process.loadEnvFile(".env.local");
const { generateText } = await import("ai");
const { assistantSettings } = await import("../lib/assistant/agent");

const args = process.argv.slice(2);
const supervisor = args.includes("--supervisor");
const questions = args.filter((a) => !a.startsWith("--"));
if (!questions.length) throw new Error('Usage: npm run ask -- [--supervisor] "question" ["follow-up"]');

const owner = neon(process.env.DATABASE_URL!);
const role = supervisor ? "depot_supervisor" : "fleet_ops";
const [profile] = await owner`select user_id, display_name, role, organization_code from public.app_users where role = ${role} limit 1`;
const user = { id: String(profile.user_id), name: String(profile.display_name), role, organizationCode: profile.organization_code as string | null } as const;

const settings = await assistantSettings(user);
const messages: ModelMessage[] = [];
for (const q of questions) {
  messages.push({ role: "user", content: q });
  const started = Date.now();
  let last = Date.now();
  const result = await generateText({
    ...settings,
    messages,
    onStepEnd: () => {
      process.stdout.write(`  [step ${((Date.now() - last) / 1000).toFixed(1)} s]`);
      last = Date.now();
    },
  });
  messages.push(...result.response.messages);
  console.log(`\n=== [${user.role}] ${q}`);
  for (const step of result.steps)
    for (const call of step.toolCalls) console.log(`  tool ${call.toolName} ${JSON.stringify(call.input)}`);
  console.log(`  answer (${((Date.now() - started) / 1000).toFixed(1)} s): ${result.text.trim()}`);
}
