import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { KpiCard } from "@/components/app/kpi-card";
import { getAppUser } from "@/lib/session";
import { getDashboardData, PAGE_SIZE, type DashboardFilters } from "@/lib/data/dashboard";
import { formatDate, formatInt } from "@/lib/format";

const FRC_OPTIONS = [
  { value: "", label: "Any" },
  { value: "active", label: "Active FRC" },
  { value: "none", label: "No FRC" },
  { value: "Review Case Closed – With Action Plan", label: "Closed – With Action Plan" },
  { value: "Review Case Closed – No Action Plan", label: "Closed – No Action Plan" },
  { value: "Review Case Declined", label: "Declined" },
  { value: "Review Case Aborted", label: "Aborted" },
];

export default function DashboardPage({ searchParams }: PageProps<"/">) {
  return (
    <Suspense fallback={<p className="text-sm text-muted-foreground">Loading dashboard…</p>}>
      <Dashboard searchParams={searchParams} />
    </Suspense>
  );
}

function param(value: string | string[] | undefined): string | null {
  const v = Array.isArray(value) ? value[0] : value;
  return v && v.trim() ? v.trim().slice(0, 100) : null;
}

async function Dashboard({ searchParams }: Pick<PageProps<"/">, "searchParams">) {
  await connection();
  const user = await getAppUser();
  const sp = await searchParams;
  const filters: DashboardFilters = {
    org: param(sp.org),
    type: param(sp.type),
    frc: param(sp.frc),
    q: param(sp.q),
    page: Math.max(1, Number.parseInt(param(sp.page) ?? "1", 10) || 1),
  };
  const data = await getDashboardData(user.id, filters);
  const s = data.summary;
  const pages = Math.max(1, Math.ceil(data.totalRows / PAGE_SIZE));
  const isSupervisor = user.role === "depot_supervisor";

  const pageHref = (page: number) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ org: filters.org, type: filters.type, frc: filters.frc, q: filters.q }))
      if (v) p.set(k, v);
    if (page > 1) p.set("page", String(page));
    const qs = p.toString();
    return qs ? `/?${qs}` : "/";
  };

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">Vehicle downtime overview</h1>
          <p className="text-sm text-muted-foreground">
            Episodes starting or ending in the last 12 months ({formatDate(data.windowStart)} – {formatDate(data.asOf)})
            {isSupervisor && ` · depot ${user.organizationCode}`}
          </p>
        </div>
        {data.lastImportAt && (
          <p className="text-xs text-muted-foreground">Data imported {formatDate(data.lastImportAt.slice(0, 10))}</p>
        )}
      </div>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4" aria-label="Key figures">
        <KpiCard label="Critical cases" value={formatInt(s.critical_cases)} hint="FRC should be opened" tone="critical" />
        <KpiCard label="Episodes" value={formatInt(s.episodes)} hint={`${formatInt(s.fleet_vehicles)} vehicles`} />
        <KpiCard label="Downtime days" value={formatInt(s.downtime_days)} />
        <KpiCard label="Active FRCs" value={formatInt(s.active_frcs)} />
      </section>

      <form method="get" action="/" className="flex flex-wrap items-end gap-3 rounded-lg border bg-card p-3">
        <label className="flex min-w-40 flex-1 flex-col gap-1 text-sm">
          Search ID or plate
          <Input name="q" defaultValue={filters.q ?? ""} placeholder="636 or PL-4428" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Depot
          <select name="org" defaultValue={filters.org ?? ""} disabled={isSupervisor} className="h-9 rounded-md border bg-background px-2 text-sm disabled:opacity-60">
            {!isSupervisor && <option value="">All depots</option>}
            {data.organizations.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Vehicle type
          <select name="type" defaultValue={filters.type ?? ""} className="h-9 max-w-56 rounded-md border bg-background px-2 text-sm">
            <option value="">All types</option>
            {data.vehicleTypes.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Review case status
          <select name="frc" defaultValue={filters.frc ?? ""} className="h-9 rounded-md border bg-background px-2 text-sm">
            {FRC_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
        <Button type="submit">Apply</Button>
        <Button variant="ghost" asChild><Link href="/">Reset</Link></Button>
      </form>

      <section className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>ID</TableHead>
              <TableHead>Plate</TableHead>
              <TableHead>Type</TableHead>
              <TableHead className="hidden md:table-cell">Depot</TableHead>
              <TableHead className="text-right">Episodes</TableHead>
              <TableHead className="text-right">Days</TableHead>
              <TableHead className="text-center">FRC active</TableHead>
              <TableHead className="hidden sm:table-cell">Latest start</TableHead>
              <TableHead className="hidden sm:table-cell">Latest end</TableHead>
              <TableHead className="text-center">Critical</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.vehicles.length === 0 && (
              <TableRow>
                <TableCell colSpan={10} className="py-8 text-center text-muted-foreground">No vehicles match these filters.</TableCell>
              </TableRow>
            )}
            {data.vehicles.map((v) => (
              <TableRow key={v.vehicle_id} className={v.episodes_12m === 0 ? "text-muted-foreground" : undefined}>
                <TableCell>
                  <Link href={`/vehicles/${v.vehicle_id}`} className="font-medium text-primary underline-offset-4 hover:underline">{v.vehicle_id}</Link>
                </TableCell>
                <TableCell className="whitespace-nowrap">{v.plate_nr}</TableCell>
                <TableCell>{v.vehicle_type}</TableCell>
                <TableCell className="hidden md:table-cell">{v.organization_code}</TableCell>
                <TableCell className="text-right tabular-nums">{v.episodes_12m}</TableCell>
                <TableCell className="text-right tabular-nums">{v.downtime_days_12m}</TableCell>
                <TableCell className={v.frc_active ? "bg-amber-100 text-center dark:bg-amber-900/40" : "text-center"}>{v.frc_active ? "X" : ""}</TableCell>
                <TableCell className="hidden whitespace-nowrap sm:table-cell">{formatDate(v.latest_start)}</TableCell>
                <TableCell className="hidden whitespace-nowrap sm:table-cell">{formatDate(v.latest_end)}</TableCell>
                <TableCell className={v.is_critical ? "bg-red-100 text-center font-semibold text-red-700 dark:bg-red-900/40 dark:text-red-300" : "text-center"}>{v.is_critical ? "X" : ""}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <div className="flex items-center justify-between gap-2 border-t px-4 py-3 text-sm text-muted-foreground">
          <span>{formatInt(data.totalRows)} vehicles · page {Math.min(filters.page, pages)} of {pages}</span>
          <div className="flex gap-2">
            {filters.page > 1 && <Button size="sm" variant="outline" asChild><Link href={pageHref(filters.page - 1)}>Previous</Link></Button>}
            {filters.page < pages && <Button size="sm" variant="outline" asChild><Link href={pageHref(filters.page + 1)}>Next</Link></Button>}
          </div>
        </div>
      </section>
    </>
  );
}
