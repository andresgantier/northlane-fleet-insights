import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import {
  APICallError,
  convertToModelMessages,
  createUIMessageStreamResponse,
  streamText,
  toUIMessageStream,
  type UIMessage,
} from "ai";
import { loadAppUser } from "@/lib/session";
import { queryAsUser } from "@/lib/db";
import { assistantSettings, MODEL_ID } from "@/lib/assistant/agent";

// POST /api/chat – the assistant. Runs on the server only: the Gemini key never reaches the browser.

const SESSION_LIMIT = Number(process.env.ASSISTANT_DAILY_LIMIT_PER_SESSION ?? 20);
const GLOBAL_LIMIT = Number(process.env.ASSISTANT_DAILY_LIMIT_GLOBAL ?? 200);
const HISTORY_MESSAGES = 12; // context kept for follow-up questions
const COOKIE = "nl_chat_session";

function textOf(message: UIMessage | undefined) {
  return (message?.parts ?? []).map((p) => (p.type === "text" ? p.text : "")).join(" ").trim();
}

function isRateLimit(error: unknown) {
  return APICallError.isInstance(error) && (error.statusCode === 429 || error.statusCode === 503);
}

export async function POST(req: Request) {
  const user = await loadAppUser();
  if (typeof user === "string") return new Response("Sign in to use the assistant.", { status: 401 });
  if (!process.env.GEMINI_API_KEY) return new Response("The assistant isn't configured yet.", { status: 503 });

  const body = (await req.json().catch(() => null)) as { messages?: UIMessage[] } | null;
  const messages = Array.isArray(body?.messages) ? body.messages.slice(-HISTORY_MESSAGES) : [];
  const question = textOf(messages.at(-1));
  if (!question) return new Response("Ask a question first.", { status: 400 });
  if (question.length > 500) return new Response("Keep the question under 500 characters.", { status: 400 });

  // Anonymous per-browser key for the daily limit (stored hashed, no personal data).
  const jar = await cookies();
  let sessionId = jar.get(COOKIE)?.value;
  if (!sessionId) {
    sessionId = randomBytes(16).toString("base64url");
    jar.set(COOKIE, sessionId, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 60 * 60 * 24 * 30 });
  }
  const sessionKey = createHash("sha256").update(sessionId).digest("hex");

  const log = (status: string, tools: string[], latencyMs: number | null, error: string | null): Promise<void> =>
    queryAsUser(
      user.id,
      (sql) => [sql`select app.log_assistant_question(${sessionKey}, ${question}, ${status}, ${tools}, ${MODEL_ID}, ${latencyMs}, ${error})`],
      { readOnly: false },
    ).then(
      () => undefined,
      (e) => console.error("[assistant] could not log question:", e),
    );

  const [usage] = await queryAsUser(user.id, (sql) => [sql`select * from app.assistant_usage_today(${sessionKey})`]);
  const { session_count, global_count } = usage[0] as { session_count: number; global_count: number };
  if (session_count >= SESSION_LIMIT || global_count >= GLOBAL_LIMIT) {
    await log("limit_reached", [], null, null);
    const which = session_count >= SESSION_LIMIT ? `your daily limit of ${SESSION_LIMIT} questions` : "today's limit for the demo";
    return new Response(`You've reached ${which}. The limit resets at midnight (Berlin time).`, { status: 429 });
  }

  const settings = await assistantSettings(user);
  const started = Date.now();
  const toolsUsed: string[] = [];

  const result = streamText({
    ...settings,
    messages: await convertToModelMessages(messages),
    onStepEnd: ({ toolCalls }) => {
      for (const c of toolCalls) toolsUsed.push(c.toolName);
    },
    onEnd: async () => {
      await log("ok", toolsUsed, Date.now() - started, null);
    },
    onError: ({ error }) => {
      console.error("[assistant] error:", error);
      log(isRateLimit(error) ? "rate_limited" : "error", toolsUsed, Date.now() - started, error instanceof Error ? error.message : String(error));
    },
  });

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({
      stream: result.stream,
      sendReasoning: false,
      onError: (error) =>
        isRateLimit(error)
          ? "The assistant is busy right now (free Gemini quota). Wait a minute and try again."
          : "Something went wrong while answering. Try again or rephrase the question.",
    }),
  });
}
