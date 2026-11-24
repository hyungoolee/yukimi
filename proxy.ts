import { NextResponse, type NextRequest } from "next/server";
import { dashboardAccess } from "@/lib/env";

// Password on the dashboard pages and their buttons. API routes check their own signatures.
export function proxy(request: NextRequest) {
  const access = dashboardAccess(request.headers.get("authorization"));
  if (access === "ok") return NextResponse.next();
  if (access === "unconfigured") return new NextResponse("Set DASHBOARD_PASSWORD to use the dashboard", { status: 503 });
  return new NextResponse("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Yukimi"' },
  });
}

export const config = { matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"] };
