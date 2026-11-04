import { Suspense } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { DemoButtons, EmailForm } from "./login-forms";
import { signOut } from "./actions";

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <main className="flex flex-1 items-center justify-center bg-muted/40 px-4 py-12">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl">NorthLane Fleet Insights</CardTitle>
          <CardDescription>Vehicle downtime and Fleet Review Cases, with an assistant for your questions.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <Suspense>
            <NoAccessNotice searchParams={searchParams} />
          </Suspense>
          <section className="flex flex-col gap-3">
            <h2 className="text-sm font-medium">Explore the demo</h2>
            <DemoButtons />
          </section>
          <Separator />
          <section className="flex flex-col gap-3">
            <h2 className="text-sm font-medium">Sign in with your account</h2>
            <EmailForm />
            <p className="text-xs text-muted-foreground">Accounts are created by Fleet Operations. There is no public sign-up.</p>
          </section>
        </CardContent>
      </Card>
    </main>
  );
}

async function NoAccessNotice({ searchParams }: Pick<PageProps<"/login">, "searchParams">) {
  const { error } = await searchParams;
  if (error !== "no-access") return null;
  return (
    <div className="flex flex-col gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
      <p>Your account has no access to this tool yet. Ask Fleet Operations to set up your role.</p>
      <form action={signOut}>
        <Button type="submit" size="sm" variant="outline">Sign out</Button>
      </form>
    </div>
  );
}
