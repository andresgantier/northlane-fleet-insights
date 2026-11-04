// Display helpers (dates are ISO strings "YYYY-MM-DD" from the database).
const dateFmt = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
const numFmt = new Intl.NumberFormat("en-US");

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return dateFmt.format(new Date(iso + "T00:00:00Z"));
}

export function formatNumber(n: number | string | null | undefined, digits = 0): string {
  if (n === null || n === undefined || n === "") return "—";
  return new Intl.NumberFormat("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(Number(n));
}

export const formatInt = (n: number | null | undefined) => (n === null || n === undefined ? "—" : numFmt.format(n));

export const ROLE_LABEL = { fleet_ops: "Fleet Operations", depot_supervisor: "Depot Supervisor" } as const;
