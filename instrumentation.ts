// Runs once when the server starts: checks every 5 seconds for ladder steps and alert re-sends that are due.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { runDue } = await import("./lib/tick");
  // Kept on globalThis so a dev reload can't start a second ticker and double every re-send.
  const g = globalThis as { yukimiTicker?: ReturnType<typeof setInterval> };
  g.yukimiTicker ??= setInterval(() => runDue().catch((e) => console.error("Scheduled work failed", e)), 5000);
}
