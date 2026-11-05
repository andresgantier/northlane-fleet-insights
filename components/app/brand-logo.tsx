import { Truck } from "lucide-react";

// NorthLane Logistics mark: truck with orange speed lines, as in the original report header.
export function BrandLogo({ subtitle = "Fleet Insights" }: { subtitle?: string }) {
  return (
    <span className="flex items-center gap-2.5 text-white">
      <span className="relative flex size-9 items-center justify-center rounded-md bg-white/10">
        <span className="absolute top-2 left-1 h-0.5 w-2 rounded bg-brand-orange" aria-hidden />
        <span className="absolute top-3.5 left-0.5 h-0.5 w-2.5 rounded bg-brand-orange" aria-hidden />
        <Truck className="size-5" aria-hidden />
      </span>
      <span className="flex flex-col leading-tight">
        <span className="text-base font-bold tracking-tight">NorthLane</span>
        <span className="text-[10px] font-semibold tracking-[0.18em] text-brand-orange uppercase">Logistics Inc. · {subtitle}</span>
      </span>
    </span>
  );
}
