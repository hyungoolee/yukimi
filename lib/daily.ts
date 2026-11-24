import { placeCall } from "./elevenlabs";
import { missed } from "./ladder";
import { callsInProgress, listCalls, listResidents, updateResident } from "./store";
import { daysBefore, japanDate } from "./trends";

/** A call is still placed this long after its time. Later than that, nobody is phoned out of the blue. */
const LATE_MINUTES = 120;

const toMinutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
const japanMinutes = (now: Date) =>
  toMinutes(now.toLocaleTimeString("en-GB", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit" }));

/**
 * Places today's check-in calls. Called every few seconds by lib/tick.ts; each run starts at most one
 * call, so a town's calls go out a few seconds apart, and never more at once than the phone plan allows.
 * Off unless DAILY_CALLS=1: these calls cost money and ring real phones.
 */
export async function placeDailyCalls(now = new Date()) {
  if (process.env.DAILY_CALLS !== "1") return;
  const today = japanDate(now);
  const minutes = japanMinutes(now);
  const limit = Number(process.env.MAX_CONCURRENT_CALLS) || 5;

  for (const resident of await listResidents()) {
    const lateBy = minutes - toMinutes(resident.call_time);
    if (resident.active === false || !resident.phone || resident.scheduled_on === today || lateBy < 0) continue;
    const tooLate = lateBy > LATE_MINUTES;
    if (!tooLate && (await callsInProgress(now.getTime())) >= limit) return; // wait for a line to free up

    // Written down before dialling, so a restart or a slow reply can't phone someone twice.
    // The cost: a crash between this line and the call means no call that day.
    const ranYesterday = resident.scheduled_on === daysBefore(today, 1);
    let mine = false;
    await updateResident(resident.id, (fresh) => {
      if (fresh.scheduled_on === today) return fresh;
      mine = true;
      return { ...fresh, scheduled_on: today };
    });
    if (!mine) continue;
    const spoken = (await listCalls(resident.id)).some((c) => c.kind === "call" && japanDate(new Date(c.at)) === today);
    if (spoken) continue; // someone already called by hand today

    if (tooLate) {
      // The app was down at their time. Only a resident it was calling yesterday counts as missed: one just
      // added, or the day daily calls are first switched on, must not send every family a worried message.
      if (ranYesterday) await missed(resident.id, 2); // ask the family, without phoning late
      continue;
    }
    await placeCall(resident).catch((e) => {
      console.error(e);
      return missed(resident.id, 1); // a check-in that could not be placed is a missed check-in
    });
    return;
  }
}
