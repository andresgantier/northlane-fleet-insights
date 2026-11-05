import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { ArrowLeft, Check, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { KpiCard } from "@/components/app/kpi-card";
import { VehicleMonthlyChart } from "@/components/app/vehicle-monthly-chart";
import { getAppUser } from "@/lib/session";
import { getVehicleDetail, type VehicleDetail } from "@/lib/data/vehicle";
import { formatDate, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

export default function VehiclePage({ params, searchParams }: PageProps<"/vehicles/[id]">) {
  return (
    <Suspense fallback={<p className="text-sm text-muted-foreground">Loading vehicle…</p>}>
      <Vehicle params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Vehicle({ params, searchParams }: Pick<PageProps<"/vehicles/[id]">, "params" | "searchParams">) {
  await connection();
  const user = await getAppUser();
  const { id } = await params;
  const { tab } = await searchParams;
  const vehicleId = Number(id);
  if (!Number.isInteger(vehicleId) || vehicleId <= 0) notFound();

  // Not found also covers vehicles of other depots: RLS hides them from supervisors.
  const detail = await getVehicleDetail(user.id, vehicleId);
  if (!detail) notFound();
  const v = detail.vehicle;
  const showDetails = tab === "details";

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
          {v.vehicle_type} ({v.vehicle_class}) · depot {v.organization_code} · built {v.manufacture_year} ·{" "}
          {v.frc_status
            ? `FRC ${v.frc_status.replace("Review Case ", "")} since ${formatDate(v.frc_start)}${v.frc_end ? `, ended ${formatDate(v.frc_end)}` : ""}`
            : "no Fleet Review Case on record"}
        </p>
      </div>

      <nav className="flex gap-1 border-b text-sm" aria-label="Vehicle sections">
        {[
          { href: `/vehicles/${v.vehicle_id}`, label: "Timeline", active: !showDetails },
          { href: `/vehicles/${v.vehicle_id}?tab=details`, label: "Indicators and rules", active: showDetails },
        ].map((t) => (
          <Link
            key={t.label}
            href={t.href}
            className={cn(
              "-mb-px border-b-2 px-3 py-2",
              t.active ? "border-primary font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {showDetails ? <DetailsTab detail={detail} /> : <TimelineTab detail={detail} />}
    </>
  );
}

function TimelineTab({ detail }: { detail: VehicleDetail }) {
  const { vehicle: v, episodes, months, asOf } = detail;
  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Downtime days per month · last 12 months</CardTitle>
          <p className="text-sm text-muted-foreground">
            {v.episodes_12m} episodes and {v.downtime_days_12m} downtime days in the last 12 months. Hover a bar for the breakdown.
          </p>
        </CardHeader>
        <CardContent>
          <VehicleMonthlyChart months={months} frcStart={v.frc_start} frcEnd={v.frc_end} asOf={asOf} />
        </CardContent>
      </Card>

      <section className="rounded-lg border bg-card">
        <h2 className="px-4 pt-4 text-base font-medium">Episodes ({episodes.length})</h2>
        <p className="px-4 text-xs text-muted-foreground">Greyed rows are older than 12 months.</p>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Category</TableHead>
              <TableHead>Start</TableHead>
              <TableHead>End</TableHead>
              <TableHead className="text-right">Days</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {episodes.length === 0 && (
              <TableRow><TableCell colSpan={4} className="py-6 text-center text-muted-foreground">No episodes on record.</TableCell></TableRow>
            )}
            {episodes.map((e) => (
              <TableRow key={e.event_id} className={e.in_analysis_window ? "" : "text-muted-foreground"}>
                <TableCell>{e.category}</TableCell>
                <TableCell className="whitespace-nowrap">{formatDate(e.start_date)}</TableCell>
                <TableCell className="whitespace-nowrap">{formatDate(e.end_date)}</TableCell>
                <TableCell className="text-right tabular-nums" title={e.days_source !== e.downtime_days ? `Source file: ${e.days_source}` : undefined}>
                  {e.downtime_days}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>
    </>
  );
}

function DetailsTab({ detail }: { detail: VehicleDetail }) {
  const { vehicle: v, episodes, actions } = detail;
  const counted = episodes.filter((e) => e.counted && !v.frc_active);
  const conditions = [
    { ok: v.condition_1, label: "Condition 1", rule: "3 or more counted episodes", value: `${v.cond1_episodes} episodes` },
    { ok: v.condition_2, label: "Condition 2", rule: "20 or more downtime days in counted episodes", value: `${v.cond2_days} days` },
  ];

  return (
    <>
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5" aria-label="Last 12 months">
        <KpiCard label="Episodes (12 months)" value={String(v.episodes_12m)} />
        <KpiCard label="Downtime days (12 months)" value={String(v.downtime_days_12m)} />
        <KpiCard label="MTTR" value={v.mttr_days_12m ? `${formatNumber(v.mttr_days_12m, 1)} d` : "—"} hint="days per episode" />
        <KpiCard label="Days between episodes" value={v.avg_days_between_episodes_12m ? formatNumber(v.avg_days_between_episodes_12m, 1) : "—"} hint="average" />
        <KpiCard label="Availability (12 months)" value={`${formatNumber(v.availability_pct_12m, 1)} %`} />
      </section>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Is this a critical case?</CardTitle>
          <p className="text-sm text-muted-foreground">
            A Fleet Review Case should be opened when the vehicle has no active FRC and meets condition 1 or 2.
            Only <span className="font-medium text-foreground">counted episodes</span> are used: those that started in the
            last 6 months{v.frc_end ? ` and after the last FRC ended (${formatDate(v.frc_end)})` : ""}.
          </p>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 text-sm">
          <div className={cn("rounded-md border p-3 font-medium", v.is_critical ? "border-red-300 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300" : "bg-muted/40")}>
            {v.frc_active
              ? "No: an FRC is already active for this vehicle."
              : v.is_critical
                ? "Yes: an FRC should be opened."
                : "No: neither condition is met."}
          </div>
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr><th className="py-1 font-normal">Rule</th><th className="py-1 font-normal">Threshold</th><th className="py-1 font-normal">This vehicle</th><th className="py-1 font-normal">Met</th></tr>
            </thead>
            <tbody>
              <tr className="border-t"><td className="py-2">No active FRC</td><td>required</td><td>{v.frc_active ? "FRC active" : "none active"}</td><td>{v.frc_active ? <X className="size-4" aria-label="no" /> : <Check className="size-4 text-green-600" aria-label="yes" />}</td></tr>
              {conditions.map((c) => (
                <tr key={c.label} className="border-t">
                  <td className="py-2">{c.label}</td><td>{c.rule}</td><td className="tabular-nums">{c.value}</td>
                  <td>{c.ok ? <Check className="size-4 text-red-600" aria-label="met" /> : <X className="size-4 text-muted-foreground" aria-label="not met" />}</td>
                </tr>
              ))}
              <tr className="border-t text-muted-foreground">
                <td className="py-2">Condition 3 (informational)</td><td>more than 20 days in 12 months</td><td className="tabular-nums">{v.cond3_days} days</td>
                <td>{v.condition_3 ? <Check className="size-4" aria-label="met" /> : <X className="size-4" aria-label="not met" />}</td>
              </tr>
            </tbody>
          </table>
          <p className="text-xs text-muted-foreground">Condition 3 is shown for information only and is not part of the critical-case flag, as in the Power BI report.</p>
          {counted.length > 0 && (
            <div>
              <h3 className="mb-1 text-sm font-medium">Counted episodes ({counted.length})</h3>
              <ul className="text-sm text-muted-foreground">
                {counted.map((e) => <li key={e.event_id}>{formatDate(e.start_date)} – {formatDate(e.end_date)} · {e.category} · {e.downtime_days} d</li>)}
              </ul>
            </div>
          )}
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
          {actions.length > 0 && (
            <div className="mt-4 border-t pt-3">
              <h3 className="mb-1 text-sm font-medium">FRC actions (audit)</h3>
              <ul className="flex flex-col gap-1">
                {actions.map((a) => (
                  <li key={a.created_at} className="flex flex-wrap gap-x-2">
                    <span className="text-muted-foreground">{a.created_at.slice(0, 16)}</span>
                    <span>{a.user_name}</span>
                    <Badge variant={a.result === "opened" ? "secondary" : "outline"}>{a.result.replace("_", " ")}</Badge>
                    <span className="text-muted-foreground">{a.message}{a.previous_status ? ` (before: ${a.previous_status.replace("Review Case ", "")})` : ""}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
