import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const PUBLIC_PATHS = ["/", "/admin"];
const AUTH_ONLY_PUBLIC = ["/login"]; // logged-in users should be bounced away

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
