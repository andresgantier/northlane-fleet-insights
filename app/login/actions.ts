"use server";

import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/server";
import demo from "@/lib/demo-accounts.json";

export type LoginState = { error: string } | null;

export async function signInWithEmail(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return { error: "Enter your email and password." };

  const { error } = await auth.signIn.email({ email, password });
  if (error) return { error: "Email or password is incorrect." };
  redirect("/");
}

// Demo sign-in: the password lives only on the server (DEMO_PASSWORD), never in the browser.
export async function signInAsDemo(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const role = formData.get("role");
  const account = role === "fleet_ops" ? demo.fleet_ops : role === "depot_supervisor" ? demo.depot_supervisor : null;
  if (!account) return { error: "Choose a demo role." };

  const password = process.env.DEMO_PASSWORD;
  if (!password) return { error: "The demo isn't configured yet." };

  const { error } = await auth.signIn.email({ email: account.email, password });
  if (error) return { error: "The demo isn't available right now. Try again in a moment." };
  redirect("/");
}

export async function signOut() {
  await auth.signOut();
  redirect("/login");
}
