import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { Truck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getAppUser } from "@/lib/session";
import { ROLE_LABEL } from "@/lib/format";
import { signOut } from "@/app/login/actions";

export function AppHeader() {
  return (
    <header className="border-b bg-background">
      <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <Truck className="size-5 text-primary" aria-hidden />
          NorthLane Fleet Insights
        </Link>
        <nav className="flex items-center gap-4 text-sm">
          <Link href="/" className="text-muted-foreground hover:text-foreground">Dashboard</Link>
          <Link href="/assistant" className="text-muted-foreground hover:text-foreground">Assistant</Link>
          <Link href="/evaluation" className="text-muted-foreground hover:text-foreground">Evaluation</Link>
        </nav>
        <div className="ml-auto">
          <Suspense fallback={<span className="text-sm text-muted-foreground">…</span>}>
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
    <div className="flex items-center gap-3 text-sm">
      <span className="hidden sm:inline">{user.name}</span>
      <Badge variant="secondary">
        {ROLE_LABEL[user.role]}
        {user.organizationCode ? ` · ${user.organizationCode}` : ""}
      </Badge>
      <form action={signOut}>
        <Button type="submit" size="sm" variant="ghost">Sign out</Button>
      </form>
    </div>
  );
}
