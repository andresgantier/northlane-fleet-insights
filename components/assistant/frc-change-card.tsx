"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Check, PencilLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { confirmFrcChange, type OpenFrcOutcome } from "@/app/(app)/assistant/actions";
import { formatDate } from "@/lib/format";

type FrcState = { status: string | null; start: string | null; end: string | null };
export type FrcChange = {
  kind: "frc_change";
  found: boolean;
  can_confirm: boolean;
  reason: string | null;
  action?: "close" | "edit" | "record_past";
  request?: { status: string | null; start_date: string | null; end_date: string | null };
  vehicle?: { vehicle_id: number; plate_nr: string; vehicle_type: string; organization_code: string };
  current?: FrcState;
  after?: FrcState;
};

const TITLE = { close: "close the Fleet Review Case", edit: "correct the Fleet Review Case dates", record_past: "record a past Fleet Review Case" };
const show = (s: FrcState | undefined) =>
  s?.status ? `${s.status.replace("Review Case ", "")} · ${formatDate(s.start)} – ${s.end ? formatDate(s.end) : "open"}` : "None";

// Proposal to change an FRC. Shows before → after; nothing happens until the user clicks Confirm.
export function FrcChangeCard({ change }: { change: FrcChange }) {
  const [requestId] = useState(() => crypto.randomUUID());
  const [outcome, setOutcome] = useState<OpenFrcOutcome | null>(null);
  const [failed, setFailed] = useState(false);
  const [pending, start] = useTransition();
  const v = change.vehicle;
  if (!change.found || !v || !change.action) return <p className="rounded-lg border bg-card p-3 text-sm">{change.reason}</p>;
  const done = outcome && ["closed", "edited", "recorded"].includes(outcome.result);

  return (
    <div className="flex flex-col gap-3 rounded-lg border-2 border-sky-300 bg-sky-50/60 p-3 text-sm dark:border-sky-800 dark:bg-sky-950/30">
      <div className="flex items-center gap-2 font-medium">
        <PencilLine className="size-4 text-sky-600" aria-hidden />
        Proposal: {TITLE[change.action]}
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        <dt className="text-muted-foreground">Vehicle</dt>
        <dd><Link href={`/vehicles/${v.vehicle_id}?tab=details`} className="text-primary underline-offset-4 hover:underline">{v.vehicle_id} · {v.plate_nr}</Link> · {v.vehicle_type} · {v.organization_code}</dd>
        <dt className="text-muted-foreground">Now</dt><dd>{show(change.current)}</dd>
        <dt className="text-muted-foreground">After</dt><dd className="font-medium">{show(change.after)}</dd>
      </dl>
      {outcome ? (
        <p className={done ? "flex items-center gap-2 font-medium text-green-700 dark:text-green-400" : "text-destructive"}>
          {done && <Check className="size-4" aria-hidden />}
          {outcome.message}
        </p>
      ) : change.can_confirm ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            size="sm"
            disabled={pending}
            onClick={() =>
              start(async () => {
                try {
                  setOutcome(await confirmFrcChange({
                    vehicleId: v.vehicle_id, requestId, action: change.action!,
                    status: change.request?.status ?? null, startDate: change.request?.start_date ?? null, endDate: change.request?.end_date ?? null,
                  }));
                } catch {
                  setFailed(true);
                }
              })
            }
          >
            {pending ? "Saving…" : "Confirm"}
          </Button>
          <span className="text-xs text-muted-foreground">Nothing is changed until you confirm. Nothing is deleted: previous values stay in the audit log.</span>
        </div>
      ) : (
        <p className="text-muted-foreground">{change.reason}</p>
      )}
      {failed && <p className="text-destructive">The change couldn&apos;t be saved. Try again.</p>}
    </div>
  );
}
