import { createNeonAuth } from "@neon/auth/next/server";

// Neon Auth (Managed Better Auth). Server only: used by proxy.ts, Server Components and Server Actions.
// Sessions live in a signed, HTTP-only cookie; there is no public sign-up route in this app.
export const auth = createNeonAuth({
  baseUrl: process.env.NEON_AUTH_BASE_URL!,
  cookies: { secret: process.env.NEON_AUTH_COOKIE_SECRET! },
});
