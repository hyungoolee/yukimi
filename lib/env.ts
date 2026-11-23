export function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

/** Routes that cost money or send alerts are called with this shared secret. */
export function hasAppSecret(request: Request) {
  return request.headers.get("x-app-secret") === env("APP_SECRET");
}

export const DEMO_MODE = process.env.DEMO_MODE === "1";
