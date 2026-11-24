export function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

/** Routes that cost money or send alerts are called with this shared secret. */
export function hasAppSecret(request: Request) {
  return request.headers.get("x-app-secret") === env("APP_SECRET");
}

/** The dashboard's Basic-auth check. In production a password must be set. */
export function dashboardAccess(authorization: string | null): "ok" | "denied" | "unconfigured" {
  const password = process.env.DASHBOARD_PASSWORD;
  if (!password) return process.env.NODE_ENV === "production" ? "unconfigured" : "ok";
  const given = atob((authorization ?? "").replace(/^Basic /, "")).split(":").slice(1).join(":");
  return given === password ? "ok" : "denied";
}

export const DEMO_MODE = process.env.DEMO_MODE === "1";

/** Whether the app can send LINE messages at all. Without this, no alert reaches anyone. */
export const LINE_READY = !!process.env.LINE_CHANNEL_ACCESS_TOKEN;
