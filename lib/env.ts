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

/**
 * The zone every Japan date and time is read in. With DEMO_MODE=1 and DEMO_JAPAN_HOUR set, a fixed
 * offset picked at start-up so the clock reads that hour then and runs on from there, for a morning
 * demo at any real hour. Whole hours: the minutes stay real. Stored timestamps are untouched.
 */
export const JAPAN_TZ = (() => {
  const hour = Number(process.env.DEMO_JAPAN_HOUR);
  if (!DEMO_MODE || !process.env.DEMO_JAPAN_HOUR || !(hour >= 0 && hour < 24)) return "Asia/Tokyo";
  // From the process start, not the module load: each server bundle loads its own copy of this module.
  let offset = (((Math.floor(hour) - new Date(performance.timeOrigin).getUTCHours()) % 24) + 24) % 24;
  if (offset > 14) offset -= 24; // Etc/GMT zones run from -12 to +14
  // Etc/GMT names are sign-inverted: UTC+5 is Etc/GMT-5.
  return offset === 0 ? "Etc/GMT" : `Etc/GMT${offset > 0 ? "-" : "+"}${Math.abs(offset)}`;
})();

/** Whether the app can send LINE messages at all. Without this, no alert reaches anyone. */
export const LINE_READY = !!process.env.LINE_CHANNEL_ACCESS_TOKEN;
