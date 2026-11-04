"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Check, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { confirmOpenFrc, type OpenFrcOutcome } from "@/app/(app)/assistant/actions";

export type FrcProposal = {
  kind: "frc_proposal";
  found: boolean;
  can_confirm: boolean;
  reason: string | null;
  vehicle?: {
    vehicle_id: number; plate_nr: string; vehicle_type: string; organization_code: string; frc_status: string | null;
    cond1_episodes: number | null; cond2_days: number | null; condition_1: boolean; condition_2: boolean;
  };
};

// Proposal to open a Fleet Review Case. Nothing happens until the user clicks Confirm.
export function FrcProposalCard({ proposal }: { proposal: FrcProposal }) {
  const [requestId] = useState(() => crypto.randomUUID()); // one per card: repeated clicks are ignored by the database
  const [outcome, setOutcome] = useState<OpenFrcOutcome | null>(null);
  const [failed, setFailed] = useState(false);
  const [pending, start] = useTransition();
  const v = proposal.vehicle;

  if (!proposal.found || !v) return <p className="rounded-lg border bg-card p-3 text-sm">{proposal.reason}</p>;

  return (
    <div className="flex flex-col gap-3 rounded-lg border-2 border-amber-300 bg-amber-50/60 p-3 text-sm dark:border-amber-800 dark:bg-amber-950/30">
      <div className="flex items-center gap-2 font-medium">
        <ShieldAlert className="size-4 text-amber-600" aria-hidden />
        Proposal: open a Fleet Review Case (Active – Standard)
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        <dt className="text-muted-foreground">Vehicle</dt>
        <dd><Link href={`/vehicles/${v.vehicle_id}`} className="text-primary underline-offset-4 hover:underline">{v.vehicle_id} · {v.plate_nr}</Link> · {v.vehicle_type} · {v.organization_code}</dd>
        <dt className="text-muted-foreground">Condition 1</dt><dd>{v.condition_1 ? "Met" : "Not met"} · {v.cond1_episodes} counted episodes (≥ 3)</dd>
        <dt className="text-muted-foreground">Condition 2</dt><dd>{v.condition_2 ? "Met" : "Not met"} · {v.cond2_days} days in counted episodes (≥ 20)</dd>
        <dt className="text-muted-foreground">Current FRC</dt><dd>{v.frc_status?.replace("Review Case ", "") ?? "None"}</dd>
      </dl>
      {outcome ? (
        <p className={outcome.result === "opened" ? "flex items-center gap-2 font-medium text-green-700 dark:text-green-400" : "text-destructive"}>
          {outcome.result === "opened" && <Check className="size-4" aria-hidden />}
          {outcome.message}
        </p>
      ) : proposal.can_confirm ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            size="sm"
            disabled={pending}
            onClick={() =>
              start(async () => {
                try {
                  setOutcome(await confirmOpenFrc(v.vehicle_id, requestId));
                } catch {
                  setFailed(true);
                }
              })
            }
          >
            {pending ? "Opening…" : "Confirm"}
          </Button>
          <span className="text-xs text-muted-foreground">Nothing is changed until you confirm. The action is recorded in the audit log.</span>
        </div>
      ) : (
        <p className="text-muted-foreground">{proposal.reason}</p>
      )}
      {failed && <p className="text-destructive">The case couldn&apos;t be opened. Try again.</p>}
    </div>
  );
}
