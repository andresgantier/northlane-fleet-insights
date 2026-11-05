"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/", label: "Dashboard", match: (p: string) => p === "/" || p.startsWith("/vehicles") },
  { href: "/assistant", label: "Assistant", match: (p: string) => p.startsWith("/assistant") },
  { href: "/evaluation", label: "Evaluation", match: (p: string) => p.startsWith("/evaluation") },
];

// Top navigation on the blue band; the current section is underlined in NorthLane orange.
export function NavLinks() {
  const path = usePathname();
  return (
    <nav className="flex items-center gap-1 text-sm">
      {LINKS.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          className={cn(
            "border-b-2 px-2 py-1 transition-colors",
            l.match(path) ? "border-brand-orange font-medium text-white" : "border-transparent text-white/75 hover:text-white",
          )}
        >
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
