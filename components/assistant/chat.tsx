"use client";

import { useEffect, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import type { UIMessage } from "ai";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ChartSpec, DataResult } from "@/lib/assistant/types";
import { AnswerVisual } from "./answer-visual";
import { FrcProposalCard, type FrcProposal } from "./frc-proposal-card";

type ToolPart = { type: string; state?: string; output?: unknown };

// Collects the data results and the chart spec produced by the tools in one assistant message.
function visualsOf(message: UIMessage) {
  const results = new Map<string, DataResult>();
  let spec: ChartSpec | null = null;
  for (const part of message.parts as ToolPart[]) {
    if (!part.type.startsWith("tool-") || part.state !== "output-available") continue;
    const out = part.output as Record<string, unknown> | undefined;
    if (!out) continue;
    if (part.type === "tool-show_chart") {
      if (out.ok) spec = out.spec as ChartSpec;
    } else if (part.type === "tool-get_vehicle_details") {
      if (out.episodes_result) results.set((out.episodes_result as DataResult).result_id, out.episodes_result as DataResult);
    } else if ("result_id" in out) {
      results.set(String(out.result_id), out as unknown as DataResult);
    }
  }
  const proposals = (message.parts as ToolPart[])
    .filter((p) => p.type === "tool-propose_frc" && p.state === "output-available")
    .map((p) => p.output as FrcProposal);
  const data = spec ? results.get(spec.result_id) ?? null : proposals.length ? null : [...results.values()].at(-1) ?? null;
  return { data, spec: data && spec?.result_id === data.result_id ? spec : null, proposals };
}

export function Chat({ suggestions }: { suggestions: string[] }) {
  const { messages, sendMessage, status, error } = useChat();
  const [input, setInput] = useState("");
  const bottom = useRef<HTMLDivElement>(null);
  const busy = status === "submitted" || status === "streaming";

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, status]);

  function ask(text: string) {
    const q = text.trim();
    if (!q || busy) return;
    sendMessage({ text: q });
    setInput("");
  }

  return (
    <div className="flex flex-1 flex-col gap-4">
      {messages.length === 0 && (
        <section className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">Ask in English, Spanish or German. Try one of these:</p>
          <div className="flex flex-wrap gap-2">
            {suggestions.map((s) => (
              <Button key={s} variant="outline" size="sm" className="h-auto whitespace-normal py-1.5 text-left" onClick={() => ask(s)}>{s}</Button>
            ))}
          </div>
        </section>
      )}

      <div className="flex flex-col gap-4">
        {messages.map((m) => {
          const text = m.parts.map((p) => (p.type === "text" ? p.text : "")).join("").trim();
          if (m.role === "user")
            return <div key={m.id} className="max-w-[85%] self-end rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground">{text}</div>;
          const { data, spec, proposals } = visualsOf(m);
          return (
            <div key={m.id} className="flex max-w-full flex-col gap-3 sm:max-w-[92%]">
              {text && <div className="whitespace-pre-wrap rounded-lg border bg-card px-3 py-2 text-sm">{text}</div>}
              {proposals.map((p, i) => <FrcProposalCard key={i} proposal={p} />)}
              {data && <AnswerVisual data={data} spec={spec} />}
            </div>
          );
        })}
        {status === "submitted" && <p className="text-sm text-muted-foreground">Looking at the data…</p>}
        {error && (
          <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm">
            {error.message && !error.message.startsWith("{") ? error.message : "Something went wrong. Try again."}
          </p>
        )}
        <div ref={bottom} />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          ask(input);
        }}
        className="sticky bottom-0 mt-auto flex gap-2 border-t bg-background py-3"
      >
        <Input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask about your fleet…" maxLength={500} aria-label="Your question" />
        <Button type="submit" disabled={busy || !input.trim()} aria-label="Send"><Send className="size-4" aria-hidden /></Button>
      </form>
    </div>
  );
}
