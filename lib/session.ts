import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/server";
import { queryAsUser } from "@/lib/db";

export type Role = "fleet_ops" | "depot_supervisor";
export type AppUser = { id: string; name: string; role: Role; organizationCode: string | null };

// Signed-in user with their app profile, or why there is none. Deduplicated per request.
export const loadAppUser = cache(async (): Promise<AppUser | "no-session" | "no-profile"> => {
  const { data: session } = await auth.getSession();
  const userId = session?.user?.id;
  if (!userId) return "no-session";

  const [rows] = await queryAsUser(userId, (sql) => [
    sql`select display_name, role, organization_code from public.app_users where user_id = app.current_user_id()`,
  ]);
  const profile = rows[0];
  if (!profile) return "no-profile";

  return {
    id: userId,
    name: String(profile.display_name),
    role: profile.role as Role,
    organizationCode: (profile.organization_code as string | null) ?? null,
  };
});

// For pages: no session -> /login; session without profile (e.g. an account created outside
// the app) -> no access.
export async function getAppUser(): Promise<AppUser> {
  const user = await loadAppUser();
  if (user === "no-session") redirect("/login");
  if (user === "no-profile") redirect("/login?error=no-access");
  return user;
}
