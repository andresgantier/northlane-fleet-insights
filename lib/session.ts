import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/server";
import { queryAsUser } from "@/lib/db";

export type Role = "fleet_ops" | "depot_supervisor";
export type AppUser = { id: string; name: string; role: Role; organizationCode: string | null };

// The signed-in user with their app profile (role and depot). Deduplicated per request.
// No session -> /login. Session without profile (e.g. an account created outside the app) -> no access.
export const getAppUser = cache(async (): Promise<AppUser> => {
  const { data: session } = await auth.getSession();
  const userId = session?.user?.id;
  if (!userId) redirect("/login");

  const [rows] = await queryAsUser(userId, (sql) => [
    sql`select display_name, role, organization_code from public.app_users where user_id = app.current_user_id()`,
  ]);
  const profile = rows[0];
  if (!profile) redirect("/login?error=no-access");

  return {
    id: userId,
    name: String(profile.display_name),
    role: profile.role as Role,
    organizationCode: (profile.organization_code as string | null) ?? null,
  };
});
