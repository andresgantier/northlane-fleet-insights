import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function KpiCard({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "critical" }) {
  return (
    <Card className={cn("gap-1 py-4", tone === "critical" && "border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-950/40")}>
      <CardContent className="flex flex-col gap-1 px-4">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className={cn("text-2xl font-semibold tabular-nums", tone === "critical" && "text-red-700 dark:text-red-300")}>{value}</span>
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      </CardContent>
    </Card>
  );
}
