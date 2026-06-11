import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const PUBLIC_PATHS = ["/", "/admin"];
const AUTH_ONLY_PUBLIC = ["/login"]; // logged-in users should be bounced away
const CONTRIBUTOR_PUBLIC = ["/contribute"]; // contributor landing/login page

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow static assets and API routes
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api") ||
    pathname.includes(".")
  ) {
    return NextResponse.next();
  }

  // --- Contributor portal ---
  const contributorId = request.cookies.get("contributor_id")?.value;

  // /contribute (exact) — landing/login page
  if (CONTRIBUTOR_PUBLIC.includes(pathname)) {
    if (contributorId) {
      return NextResponse.redirect(
        new URL("/contribute/dashboard", request.url)
      );
    }
    return NextResponse.next();
  }

  // /contribute/* — require contributor session
  if (pathname.startsWith("/contribute/")) {
    if (!contributorId) {
      return NextResponse.redirect(new URL("/contribute", request.url));
    }
    return NextResponse.next();
  }

  // --- Researcher portal (existing logic) ---
  const userId = request.cookies.get("user_id")?.value;

  // Redirect logged-in users away from /login immediately (no DB round-trip)
  if (AUTH_ONLY_PUBLIC.includes(pathname) && userId) {
    return NextResponse.redirect(new URL("/projects", request.url));
  }

  // Allow public paths
  if (PUBLIC_PATHS.includes(pathname) || AUTH_ONLY_PUBLIC.includes(pathname)) {
    return NextResponse.next();
  }

  // Require session cookie for all other routes
  if (!userId) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
