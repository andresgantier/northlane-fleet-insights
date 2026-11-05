import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { Button } from "@/components/ui/button";
import { getAppUser } from "@/lib/session";
import { ROLE_LABEL } from "@/lib/format";
import { signOut } from "@/app/login/actions";
import { BrandLogo } from "./brand-logo";
import { NavLinks } from "./nav-links";

// NorthLane blue band, like the header of the original Power BI report.
export function AppHeader() {
  return (
    <header className="bg-brand shadow-sm">
      <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center gap-x-8 gap-y-2 px-4 py-2.5">
        <Link href="/" aria-label="NorthLane Fleet Insights, dashboard"><BrandLogo /></Link>
        <Suspense fallback={null}>
          <NavLinks />
        </Suspense>
        <div className="ml-auto">
          <Suspense fallback={<span className="text-sm text-white/70">…</span>}>
            <UserMenu />
          </Suspense>
        </div>
      </div>
    </header>
  );
}

async function UserMenu() {
  await connection();
  const user = await getAppUser();
  return (
    <div className="flex items-center gap-3 text-sm text-white">
      <span className="hidden sm:inline">{user.name}</span>
      <span className="rounded-full bg-white/15 px-2.5 py-0.5 text-xs font-medium">
        {ROLE_LABEL[user.role]}
        {user.organizationCode ? ` · ${user.organizationCode}` : ""}
      </span>
      <form action={signOut}>
        <Button type="submit" size="sm" variant="ghost" className="text-white hover:bg-white/15 hover:text-white">Sign out</Button>
      </form>
    </div>
  );
}
