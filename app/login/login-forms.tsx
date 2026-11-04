"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { signInAsDemo, signInWithEmail, type LoginState } from "./actions";

export function DemoButtons() {
  const [state, action, pending] = useActionState<LoginState, FormData>(signInAsDemo, null);
  return (
    <form action={action} className="flex flex-col gap-3">
      <Button type="submit" name="role" value="fleet_ops" disabled={pending} className="h-auto justify-start py-3 text-left">
        <span className="flex flex-col items-start">
          <span>Fleet Operations</span>
          <span className="text-xs font-normal opacity-80">All 20 depots</span>
        </span>
      </Button>
      <Button type="submit" name="role" value="depot_supervisor" variant="outline" disabled={pending} className="h-auto justify-start py-3 text-left">
        <span className="flex flex-col items-start">
          <span>Depot Supervisor</span>
          <span className="text-xs font-normal text-muted-foreground">Only depot W-EUN/EJ</span>
        </span>
      </Button>
      {pending && <p className="text-sm text-muted-foreground">Signing in…</p>}
      {state?.error && <p className="text-sm text-destructive">{state.error}</p>}
    </form>
  );
}

export function EmailForm() {
  const [state, action, pending] = useActionState<LoginState, FormData>(signInWithEmail, null);
  return (
    <form action={action} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm">
        Email
        <Input name="email" type="email" autoComplete="email" placeholder="name@northlane.com" required />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Password
        <Input name="password" type="password" autoComplete="current-password" required />
      </label>
      <Button type="submit" variant="outline" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </Button>
      {state?.error && <p className="text-sm text-destructive">{state.error}</p>}
    </form>
  );
}
