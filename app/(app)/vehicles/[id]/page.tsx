import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { ArrowLeft, Check, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { KpiCard } from "@/components/app/kpi-card";
import { DowntimeTimeline } from "@/components/app/downtime-timeline";
import { getAppUser } from "@/lib/session";
import { getVehicleDetail } from "@/lib/data/vehicle";
import { formatDate, formatNumber } from "@/lib/format";

export default function VehiclePage({ params }: PageProps<"/vehicles/[id]">) {
  return (
    <Suspense fallback={<p className="text-sm text-muted-foreground">Loading vehicle…</p>}>
      <Vehicle params={params} />
    </Suspense>
  );
}

async function Vehicle({ params }: Pick<PageProps<"/vehicles/[id]">, "params">) {
  await connection();
  const user = await getAppUser();
  const { id } = await params;
  const vehicleId = Number(id);
  if (!Number.isInteger(vehicleId) || vehicleId <= 0) notFound();

  // Not found also covers vehicles of other depots: RLS hides them from supervisors.
  const detail = await getVehicleDetail(user.id, vehicleId);
  if (!detail) notFound();
  const { vehicle: v, episodes, asOf } = detail;

  const conditions = [
    { ok: v.condition_1, label: "Condition 1", rule: "3 or more episodes in the last 6 months", value: `${v.cond1_episodes} counted episodes` },
    { ok: v.condition_2, label: "Condition 2", rule: "20 or more downtime days in the last 6 months", value: `${v.cond2_days} days in counted episodes` },
  ];

  return (
    <>
      <div className="flex flex-col gap-2">
        <Link href="/" className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" aria-hidden /> Dashboard
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">Vehicle {v.vehicle_id} · {v.plate_nr}</h1>
          {v.is_critical && <Badge variant="destructive">Critical case</Badge>}
          {v.frc_active && <Badge className="bg-amber-500 text-white hover:bg-amber-500">FRC active</Badge>}
        </div>
        <p className="text-sm text-muted-foreground">
          {v.vehicle_type} ({v.vehicle_class}) · depot {v.organization_code} · built {v.manufacture_year}
        </p>
      </div>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5" aria-label="Last 12 months">
        <KpiCard label="Episodes (12 months)" value={String(v.episodes_12m)} />
        <KpiCard label="Downtime days (12 months)" value={String(v.downtime_days_12m)} />
        <KpiCard label="MTTR" value={v.mttr_days_12m ? `${formatNumber(v.mttr_days_12m, 1)} d` : "—"} hint="days per episode" />
        <KpiCard label="Days between episodes" value={v.avg_days_between_episodes_12m ? formatNumber(v.avg_days_between_episodes_12m, 1) : "—"} hint="average" />
        <KpiCard label="Availability" value={`${formatNumber(v.availability_pct_12m, 1)} %`} />
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle className="text-base">Critical-case rules</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            {v.frc_active ? (
              <p className="text-muted-foreground">An FRC is already active for this vehicle, so it is not flagged as a critical case.</p>
            ) : (
              <p className="text-muted-foreground">
                Counted episodes start in the last 6 months{v.frc_end ? ` and after the last FRC ended (${formatDate(v.frc_end)})` : ""}.
              </p>
            )}
            <ul className="flex flex-col gap-2">
              {conditions.map((c) => (
                <li key={c.label} className="flex items-start gap-2">
                  {c.ok ? <Check className="mt-0.5 size-4 text-red-600" aria-label="met" /> : <X className="mt-0.5 size-4 text-muted-foreground" aria-label="not met" />}
                  <span><span className="font-medium">{c.label}:</span> {c.rule} — <span className="tabular-nums">{c.value}</span></span>
                </li>
              ))}
              <li className="flex items-start gap-2 text-muted-foreground">
                {v.condition_3 ? <Check className="mt-0.5 size-4" aria-label="met" /> : <X className="mt-0.5 size-4" aria-label="not met" />}
                <span><span className="font-medium">Condition 3 (informational):</span> no active FRC and more than 20 downtime days in the last 12 months — {v.cond3_days} days. Not part of the critical-case flag, as in the Power BI report.</span>
              </li>
            </ul>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Fleet Review Case</CardTitle></CardHeader>
          <CardContent className="text-sm">
            {v.frc_status ? (
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
                <dt className="text-muted-foreground">Status</dt><dd>{v.frc_status.replace("Review Case ", "")}</dd>
                <dt className="text-muted-foreground">Start</dt><dd>{formatDate(v.frc_start)}</dd>
                <dt className="text-muted-foreground">End</dt><dd>{formatDate(v.frc_end)}</dd>
                <dt className="text-muted-foreground">Grace period until</dt><dd>{formatDate(v.grace_period_until)}</dd>
              </dl>
            ) : (
              <p className="text-muted-foreground">No Fleet Review Case on record.</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Downtime timeline · last 12 months</CardTitle></CardHeader>
        <CardContent>
          <DowntimeTimeline episodes={episodes} asOf={asOf} frcStart={v.frc_start} frcEnd={v.frc_end} />
        </CardContent>
      </Card>

      <section className="rounded-lg border bg-card">
        <h2 className="px-4 pt-4 text-base font-medium">Episodes ({episodes.length})</h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Category</TableHead>
              <TableHead>Start</TableHead>
              <TableHead>End</TableHead>
              <TableHead className="text-right">Days</TableHead>
              <TableHead className="hidden sm:table-cell">In 12-month window</TableHead>
              <TableHead className="hidden sm:table-cell">Counts for conditions 1–2</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {episodes.map((e) => (
              <TableRow key={e.event_id} className={e.in_analysis_window ? "" : "text-muted-foreground"}>
                <TableCell>{e.category}</TableCell>
                <TableCell className="whitespace-nowrap">{formatDate(e.start_date)}</TableCell>
                <TableCell className="whitespace-nowrap">{formatDate(e.end_date)}</TableCell>
                <TableCell className="text-right tabular-nums" title={e.days_source !== e.downtime_days ? `Source file: ${e.days_source}` : undefined}>
                  {e.downtime_days}
                </TableCell>
                <TableCell className="hidden sm:table-cell">{e.in_analysis_window ? "Yes" : "No"}</TableCell>
                <TableCell className="hidden sm:table-cell">{e.counted && !v.frc_active ? "Yes" : "No"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>
    </>
  );
}
