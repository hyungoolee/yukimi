import { NextResponse, type NextRequest } from "next/server";

// Optional password on the dashboard pages and their buttons. API routes check their own signatures.
export function proxy(request: NextRequest) {
  const password = process.env.DASHBOARD_PASSWORD;
  if (!password) return NextResponse.next();
  const given = atob((request.headers.get("authorization") ?? "").replace(/^Basic /, "")).split(":").slice(1).join(":");
  if (given === password) return NextResponse.next();
  return new NextResponse("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Yukimi"' },
  });
}

export const config = { matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"] };
