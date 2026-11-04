import { auth } from "@/lib/auth/server";

// Runs before every page: refreshes the session and sends visitors without one to /login.
// Every route is protected except the ones listed here.
export default auth.middleware({
  loginUrl: "/login",
  publicRoutes: ["/login", "/api/health"],
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
