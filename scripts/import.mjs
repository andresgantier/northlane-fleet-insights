// Import of the two source Excel files into Neon (npm run db:import).
// Re-runnable: replaces all fleet data in one transaction (import_runs keeps the history;
// organizations are upserted so user profiles that reference them survive).
// Steps: read -> clean -> deduplicate -> normalize -> shift dates -> load -> report.
// Uses DATABASE_URL from .env.local (owner role, local only).

import { existsSync, writeFileSync } from "node:fs";
import ExcelJS from "exceljs";
import { Pool, neonConfig } from "@neondatabase/serverless";

const DOWNTIME_FILE = "data/source/Downtime Records.xlsx";
const FRC_FILE = "data/source/Fleet Review Case Status.xlsx";
const REPORT_FILE = "docs/DATA_IMPORT_REPORT.md";

// Day on which the original Power BI report was evaluated (its TODAY()): 2026-07-22, two weeks
// after its "Last Update" of 2026-07-08, matching the two-week refresh cycle. Evidence: with this
// date the critical-case rules give exactly the 100 cases and the same flags shown in the report.
// Dates are shifted so that this day becomes today: the data keeps its original meaning.
const SOURCE_REFERENCE_DATE = "2026-07-22";

const CATEGORIES = [
  "Mechanical Breakdown",
  "Scheduled Maintenance",
  "Inspection/Compliance Hold",
  "Accident/Collision Damage",
];
const FRC_STATUSES = [
  "Review Case Active – Standard",
  "Review Case Active – Individual",
  "Review Case Closed – With Action Plan",
  "Review Case Closed – No Action Plan",
  "Review Case Declined",
  "Review Case Aborted",
];
const VANS = ["Light Commercial Van", "Cargo Van", "Box Van", "Sprinter Van", "Panel Van", "Furniture Van"];
// Types without "Trailer" in the name that are trailers (towed units).
const OTHER_TRAILERS = ["Enclosed Car Carrier", "Hazardous Materials Tanker"];

function vehicleClass(typeName) {
  if (VANS.includes(typeName)) return "Van";
  if (typeName.includes("Trailer") || OTHER_TRAILERS.includes(typeName)) return "Trailer";
  return "Truck";
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const clean = (v) => (typeof v === "string" ? v.trim() : v);
const nullable = (v) => (v === "-" || v === "" || v === null || v === undefined ? null : v);
const isoDate = (d) => d.toISOString().slice(0, 10);
const dayNumber = (iso) => Math.round(Date.parse(iso + "T00:00:00Z") / 86400000);
const addDays = (iso, n) => isoDate(new Date(Date.parse(iso + "T00:00:00Z") + n * 86400000));
const todayBerlin = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" }).format(new Date());

function asDate(value, label) {
  if (value instanceof Date) return isoDate(value);
  throw new Error(`${label}: expected a date, got ${JSON.stringify(value)}`);
}

// Reads a sheet: only the named header columns; unnamed helper columns are ignored and reported.
async function readSheet(file, sheetName, headers) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const ws = wb.getWorksheet(sheetName);
  if (!ws) throw new Error(`Sheet "${sheetName}" not found in ${file}`);

  const headerRow = ws.getRow(1).values.map(clean);
  const index = Object.fromEntries(headers.map((h) => [h, headerRow.indexOf(h)]));
  for (const [h, i] of Object.entries(index)) if (i < 1) throw new Error(`Column "${h}" not found in ${file}`);

  const rows = [];
  const ignoredCells = [];
  let untrimmed = 0;
  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const values = row.values;
    for (const v of values) if (typeof v === "string" && v !== v.trim()) untrimmed++;
    rows.push({ rowNumber, ...Object.fromEntries(headers.map((h) => [h, clean(values[index[h]])])) });
    values.forEach((v, col) => {
      if (v != null && !headerRow[col]) ignoredCells.push({ row: rowNumber, col, formula: v.formula ?? null });
    });
  });
  return { rows, ignoredCells, untrimmed };
}

// ---------------------------------------------------------------------------
// 1. Read and clean
// ---------------------------------------------------------------------------
const anomalies = [];
// count: how many records the finding covers (aggregated findings are noted once).
const note = (type, detail, action, count = 1) => anomalies.push({ type, detail, action, count });

const downtime = await readSheet(DOWNTIME_FILE, "Records", [
  "Org", "ID_Vehicle", "Plate Nr", "Type", "Vehicle Age", "Downtime Category", "Days", "Start Date", "End Date",
]);
const frc = await readSheet(FRC_FILE, "FRC Status", [
  "Review Case Status", "Org", "ID_Vehicle", "Plate Nr", "FRC Start", "FRC End", "Grace Period Until",
]);

for (const c of downtime.ignoredCells)
  note("Helper cell without header", `Downtime Records row ${c.row}, column ${c.col}${c.formula ? ` (=${c.formula})` : ""}`, "Ignored");
for (const c of frc.ignoredCells)
  note("Helper cell without header", `FRC Status row ${c.row}, column ${c.col}`, "Ignored");

const events = downtime.rows.map((r) => {
  const e = {
    rowNumber: r.rowNumber,
    org: r.Org,
    vehicleId: Number(r.ID_Vehicle),
    plate: r["Plate Nr"],
    type: r.Type,
    year: Number(r["Vehicle Age"]),
    category: r["Downtime Category"],
    daysSource: Number(r.Days),
    start: asDate(r["Start Date"], `Downtime row ${r.rowNumber} Start Date`),
    end: asDate(r["End Date"], `Downtime row ${r.rowNumber} End Date`),
  };
  if (!CATEGORIES.includes(e.category)) throw new Error(`Unknown category "${e.category}" in row ${r.rowNumber}`);
  if (e.end < e.start) throw new Error(`End before start in row ${r.rowNumber}`);
  return e;
});
const untrimmed = downtime.untrimmed + frc.untrimmed;
if (untrimmed) note("Trailing/leading spaces", `${untrimmed} text cells (e.g. "Mechanical Breakdown ")`, "Trimmed", untrimmed);

// ---------------------------------------------------------------------------
// 2. Deduplicate episodes (same vehicle, category, start and end)
// ---------------------------------------------------------------------------
const byKey = new Map();
let duplicates = 0;
for (const e of events) {
  const key = `${e.vehicleId}|${e.category}|${e.start}|${e.end}`;
  const first = byKey.get(key);
  if (!first) {
    byKey.set(key, e);
    continue;
  }
  duplicates++;
  const sameOrg = first.org === e.org;
  note(
    "Duplicate episode",
    `Vehicle ${e.vehicleId}, ${e.category}, ${e.start} to ${e.end} (rows ${first.rowNumber} and ${e.rowNumber})` +
      (sameOrg ? "" : `, recorded under ${first.org} and ${e.org}`),
    "Kept one",
  );
}
const uniqueEvents = [...byKey.values()];

// Days column vs. dates. Normalized downtime_days = end - start + 1 (inclusive), computed in the database.
const sameDayZero = uniqueEvents.filter((e) => e.start === e.end && e.daysSource === 0).length;
const sameDayOne = uniqueEvents.filter((e) => e.start === e.end && e.daysSource === 1).length;
if (sameDayZero)
  note(
    "Days = 0 on same-day episodes",
    `${sameDayZero} same-day episodes have Days = 0, while ${sameDayOne} other same-day episodes have Days = 1`,
    "downtime_days = 1 (inclusive); original kept in days_source",
    sameDayZero,
  );
const offByMore = uniqueEvents.filter((e) => e.start !== e.end && e.daysSource !== dayNumber(e.end) - dayNumber(e.start) + 1);
for (const e of offByMore)
  note(
    "Days does not match dates",
    `Vehicle ${e.vehicleId}, ${e.start} to ${e.end}: Days = ${e.daysSource}, dates give ${dayNumber(e.end) - dayNumber(e.start) + 1}`,
    "downtime_days from dates; original kept in days_source",
  );

// ---------------------------------------------------------------------------
// 3. Normalize master data
// ---------------------------------------------------------------------------
// Vehicle master data comes from its most recent episode.
const vehicles = new Map();
for (const e of [...uniqueEvents].sort((a, b) => (a.start < b.start ? -1 : 1))) {
  const prev = vehicles.get(e.vehicleId);
  if (prev && (prev.org !== e.org || prev.plate !== e.plate || prev.type !== e.type || prev.year !== e.year))
    note(
      "Vehicle master data changes between rows",
      `Vehicle ${e.vehicleId}: ${prev.org}/${prev.plate}/${prev.type}/${prev.year} -> ${e.org}/${e.plate}/${e.type}/${e.year}`,
      "Used the most recent episode",
    );
  vehicles.set(e.vehicleId, { id: e.vehicleId, org: e.org, plate: e.plate, type: e.type, year: e.year });
}

const orgCodes = new Set([...vehicles.values()].map((v) => v.org));
const organizations = [...orgCodes].sort().map((code) => {
  const [lvl3, rest] = code.split("-");
  const [lvl4, lvl5] = (rest ?? "").split("/");
  if (!lvl3 || !lvl4 || !lvl5) throw new Error(`Unexpected organization code "${code}"`);
  return { code, lvl3, lvl4, lvl5 };
});
const typeNames = [...new Set([...vehicles.values()].map((v) => v.type))].sort();

const cases = frc.rows.map((r) => {
  const c = {
    rowNumber: r.rowNumber,
    status: r["Review Case Status"],
    org: r.Org,
    vehicleId: Number(r.ID_Vehicle),
    plate: r["Plate Nr"],
    start: asDate(r["FRC Start"], `FRC row ${r.rowNumber} FRC Start`),
    end: nullable(r["FRC End"]),
    grace: nullable(r["Grace Period Until"]),
  };
  c.end = c.end === null ? null : asDate(c.end, `FRC row ${r.rowNumber} FRC End`);
  c.grace = c.grace === null ? null : asDate(c.grace, `FRC row ${r.rowNumber} Grace Period Until`);
  if (!FRC_STATUSES.includes(c.status)) throw new Error(`Unknown FRC status "${c.status}" in row ${r.rowNumber}`);
  const v = vehicles.get(c.vehicleId);
  if (!v) throw new Error(`FRC row ${r.rowNumber}: vehicle ${c.vehicleId} has no downtime records`);
  if (v.org !== c.org)
    note("FRC organization differs from vehicle", `Vehicle ${c.vehicleId}: FRC file says ${c.org}, downtime records say ${v.org}`, "Vehicle organization used");
  if (v.plate !== c.plate)
    note("FRC plate differs from vehicle", `Vehicle ${c.vehicleId}: ${c.plate} vs ${v.plate}`, "Vehicle plate used");
  return c;
});
const dashCount = frc.rows.filter((r) => r["FRC End"] === "-").length + frc.rows.filter((r) => r["Grace Period Until"] === "-").length;
if (dashCount) note('"-" used as empty value', `${dashCount} cells in FRC End / Grace Period Until (all on active cases)`, "Stored as NULL", dashCount);
const oldest = cases.reduce((m, c) => (c.start < m ? c.start : m), "9999-12-31");
const referenceDay = dayNumber(SOURCE_REFERENCE_DATE);
const afterReference = uniqueEvents.filter((e) => dayNumber(e.end) > referenceDay);
for (const e of afterReference)
  note("Episode ends after the source reference date", `Vehicle ${e.vehicleId}, ${e.start} to ${e.end} (reference ${SOURCE_REFERENCE_DATE})`, "Kept: ongoing episode with planned end");

// ---------------------------------------------------------------------------
// 4. Shift dates: source reference date -> today
// ---------------------------------------------------------------------------
const today = todayBerlin();
const shiftDays = dayNumber(today) - referenceDay;
const shift = (iso) => (iso === null ? null : addDays(iso, shiftDays));

// ---------------------------------------------------------------------------
// 5. Load in one transaction
// ---------------------------------------------------------------------------
if (existsSync(".env.local")) process.loadEnvFile(".env.local");
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is missing in .env.local");
neonConfig.webSocketConstructor = globalThis.WebSocket;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = await pool.connect();

const source = {
  downtime_rows: downtime.rows.length,
  frc_rows: frc.rows.length,
  vehicles: vehicles.size,
  organizations: organizations.length,
  vehicle_types: typeNames.length,
};
let loaded;
try {
  await db.query("begin");
  // Organizations are upserted, not truncated: app_users (Phase 2) references them.
  await db.query("truncate public.fleet_review_cases, public.downtime_events, public.vehicles, public.vehicle_types restart identity");

  await db.query(
    `insert into public.organizations (code, org_lvl_3, org_lvl_4, org_lvl_5)
     select * from unnest($1::text[], $2::text[], $3::text[], $4::text[])
     on conflict (code) do update set org_lvl_3 = excluded.org_lvl_3, org_lvl_4 = excluded.org_lvl_4, org_lvl_5 = excluded.org_lvl_5`,
    [organizations.map((o) => o.code), organizations.map((o) => o.lvl3), organizations.map((o) => o.lvl4), organizations.map((o) => o.lvl5)],
  );

  const typeRows = await db.query(
    `insert into public.vehicle_types (name, vehicle_class)
     select * from unnest($1::text[], $2::text[]) returning id, name`,
    [typeNames, typeNames.map(vehicleClass)],
  );
  const typeId = Object.fromEntries(typeRows.rows.map((t) => [t.name, t.id]));

  const vs = [...vehicles.values()];
  await db.query(
    `insert into public.vehicles (id, plate_nr, vehicle_type_id, organization_code, manufacture_year)
     select * from unnest($1::int[], $2::text[], $3::smallint[], $4::text[], $5::smallint[])`,
    [vs.map((v) => v.id), vs.map((v) => v.plate), vs.map((v) => typeId[v.type]), vs.map((v) => v.org), vs.map((v) => v.year)],
  );

  await db.query(
    `insert into public.downtime_events (vehicle_id, category, start_date, end_date, days_source)
     select * from unnest($1::int[], $2::text[], $3::date[], $4::date[], $5::int[])`,
    [
      uniqueEvents.map((e) => e.vehicleId),
      uniqueEvents.map((e) => e.category),
      uniqueEvents.map((e) => shift(e.start)),
      uniqueEvents.map((e) => shift(e.end)),
      uniqueEvents.map((e) => e.daysSource),
    ],
  );

  await db.query(
    `insert into public.fleet_review_cases (vehicle_id, status, frc_start, frc_end, grace_period_until)
     select * from unnest($1::int[], $2::text[], $3::date[], $4::date[], $5::date[])`,
    [cases.map((c) => c.vehicleId), cases.map((c) => c.status), cases.map((c) => shift(c.start)), cases.map((c) => shift(c.end)), cases.map((c) => shift(c.grace))],
  );

  const counts = await db.query(`
    select (select count(*) from public.organizations)::int      as organizations,
           (select count(*) from public.vehicle_types)::int      as vehicle_types,
           (select count(*) from public.vehicles)::int           as vehicles,
           (select count(*) from public.downtime_events)::int    as downtime_events,
           (select count(*) from public.fleet_review_cases)::int as fleet_review_cases,
           (select min(start_date) from public.downtime_events)::text as first_start,
           (select max(start_date) from public.downtime_events)::text as last_start,
           (select max(end_date) from public.downtime_events)::text   as last_end`);
  loaded = counts.rows[0];

  const report = { source, loaded, duplicates_removed: duplicates, anomalies };
  await db.query(
    "insert into public.import_runs (source_reference_date, shift_days, report) values ($1, $2, $3)",
    [SOURCE_REFERENCE_DATE, shiftDays, JSON.stringify(report)],
  );
  await db.query("commit");
} catch (error) {
  await db.query("rollback");
  throw error;
} finally {
  db.release();
  await pool.end();
}

// ---------------------------------------------------------------------------
// 6. Report (console + docs/DATA_IMPORT_REPORT.md)
// ---------------------------------------------------------------------------
const grouped = Object.groupBy(anomalies, (a) => a.type);
const lines = [
  "# Data import report",
  "",
  `Generated by \`npm run db:import\` on ${today}. Do not edit by hand.`,
  "",
  "## Date shift",
  "",
  `All dates were shifted by **${shiftDays} days** so that the source reference date (${SOURCE_REFERENCE_DATE}, the day the original Power BI report was evaluated, two weeks after its "Last Update" of 2026-07-08) becomes ${today}.`,
  `Oldest FRC start in the source: ${oldest}.`,
  "",
  "## Counts",
  "",
  "| Item | Source (Excel) | Loaded | Note |",
  "|---|---|---|---|",
  `| Downtime episodes | ${source.downtime_rows} rows | ${loaded.downtime_events} | ${duplicates} duplicates removed |`,
  `| Fleet Review Cases | ${source.frc_rows} rows | ${loaded.fleet_review_cases} | |`,
  `| Vehicles | ${source.vehicles} distinct IDs | ${loaded.vehicles} | |`,
  `| Organizations | ${source.organizations} distinct codes | ${loaded.organizations} | |`,
  `| Vehicle types | ${source.vehicle_types} distinct names | ${loaded.vehicle_types} | |`,
  "",
  `Loaded date range: episodes start ${loaded.first_start} to ${loaded.last_start}; latest end ${loaded.last_end}.`,
  "",
  "## Data quality findings",
  "",
  "| Finding | Cases | Action |",
  "|---|---|---|",
  ...Object.entries(grouped).map(([type, list]) => `| ${type} | ${list.reduce((n, a) => n + a.count, 0)} | ${list[0].action} |`),
  "",
  "### Details",
  "",
  ...Object.entries(grouped).flatMap(([type, list]) => [`**${type}**`, "", ...list.map((a) => `- ${a.detail}`), ""]),
];
writeFileSync(REPORT_FILE, lines.join("\n"));

console.log(`Shift: ${shiftDays} days (${SOURCE_REFERENCE_DATE} -> ${today})`);
console.table({ source, loaded });
console.table(Object.fromEntries(Object.entries(grouped).map(([t, l]) => [t, { cases: l.reduce((n, a) => n + a.count, 0), action: l[0].action }])));
console.log(`Report written to ${REPORT_FILE}`);
