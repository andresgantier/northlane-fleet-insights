import { z } from "zod";

// Named periods the assistant can use. Rolling windows match the semantic layer
// (last 6 months = 180 days, last 12 months = 365 days, both including today).
export const PERIOD_PRESETS = [
  "last_30_days",
  "last_3_months",
  "last_6_months",
  "last_12_months",
  "this_month",
  "last_month",
  "this_half_year",
  "this_year",
  "last_year",
  "custom",
] as const;

export const periodSchema = z
  .object({
    preset: z
      .enum(PERIOD_PRESETS)
      .describe(
        "Rolling: last_30_days, last_3_months (90 days), last_6_months (180 days), last_12_months (365 days). " +
          "Calendar: this_month, last_month, this_half_year (Jan–Jun or Jul–Dec up to today, use for 'this semester'), " +
          "this_year, last_year. custom needs from and to.",
      ),
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Only for custom: start date YYYY-MM-DD"),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Only for custom: end date YYYY-MM-DD"),
  })
  .describe("Period to analyse. Default to last_12_months when the user does not say.");

export type Period = z.infer<typeof periodSchema>;
export type ResolvedPeriod = { from: string; to: string; label: string };

const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (isoDate: string, n: number) => iso(new Date(Date.parse(isoDate + "T00:00:00Z") + n * 86400000));

// Resolves a period against the reference date (today in Europe/Berlin, same as app.as_of()).
export function resolvePeriod(p: Period, asOf: string): ResolvedPeriod {
  const [y, m] = asOf.split("-").map(Number);
  switch (p.preset) {
    case "last_30_days": return { from: addDays(asOf, -29), to: asOf, label: "Last 30 days" };
    case "last_3_months": return { from: addDays(asOf, -89), to: asOf, label: "Last 3 months (90 days)" };
    case "last_6_months": return { from: addDays(asOf, -179), to: asOf, label: "Last 6 months (180 days)" };
    case "last_12_months": return { from: addDays(asOf, -364), to: asOf, label: "Last 12 months (365 days)" };
    case "this_month": return { from: iso(new Date(Date.UTC(y, m - 1, 1))), to: asOf, label: "This month to date" };
    case "last_month":
      return { from: iso(new Date(Date.UTC(y, m - 2, 1))), to: iso(new Date(Date.UTC(y, m - 1, 0))), label: "Last calendar month" };
    case "this_half_year":
      return { from: iso(new Date(Date.UTC(y, m <= 6 ? 0 : 6, 1))), to: asOf, label: `This half-year (H${m <= 6 ? 1 : 2} ${y}) to date` };
    case "this_year": return { from: `${y}-01-01`, to: asOf, label: `Year ${y} to date` };
    case "last_year": return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31`, label: `Year ${y - 1}` };
    case "custom": {
      if (!p.from || !p.to) throw new Error("A custom period needs from and to (YYYY-MM-DD).");
      if (p.from > p.to) throw new Error("The period start must be before its end.");
      const days = (Date.parse(p.to) - Date.parse(p.from)) / 86400000;
      if (days > 3 * 366) throw new Error("Periods are limited to 3 years.");
      return { from: p.from, to: p.to, label: `${p.from} to ${p.to}` };
    }
  }
}
