import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

// KPI tile in NorthLane style: white card, brand-blue figure; critical tiles get an orange edge and a red figure.
export function KpiCard({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "critical" }) {
  return (
    <Card className={cn("gap-1 border-l-4 py-4 shadow-sm", tone === "critical" ? "border-l-brand-orange" : "border-l-brand")}>
      <CardContent className="flex flex-col gap-1 px-4">
        <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</span>
        <span className={cn("text-3xl font-semibold tabular-nums", tone === "critical" ? "text-red-700" : "text-brand")}>{value}</span>
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      </CardContent>
    </Card>
  );
}
