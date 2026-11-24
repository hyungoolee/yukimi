import { placeCall } from "./elevenlabs";
import { callsInProgress, getLadder, listCalls, listResidents, saveCall, updateResident } from "./store";
import { daysBefore, japanDate } from "./trends";
import type { Resident } from "./types";

/** Someone joins the day's queue up to this long after their time. Later than that, they are not phoned out of the blue. */
const LATE_MINUTES = 120;
export const UNPLACED = "今日の見守り電話をかけられませんでした";

const toMinutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
const japanMinutes = (now: Date) =>
  toMinutes(now.toLocaleTimeString("en-GB", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit" }));

/** No call went out today. Shown on the visit list; no one is told the resident "didn't answer", because nobody rang. */
const unplaced = (resident: Resident, now: Date) =>
  saveCall({
    id: `unplaced-${resident.id}-${japanDate(now)}`,
    resident_id: resident.id,
    at: now.toISOString(),
    kind: "missed",
    risk: "yellow",
    reasons: [UNPLACED],
    actions: [],
  });

/**
 * Places today's check-in calls. Called every few seconds by lib/tick.ts.
 * Off unless DAILY_CALLS=1: these calls cost money and ring real phones.
 */
export async function placeDailyCalls(now = new Date()) {
  if (process.env.DAILY_CALLS !== "1") return;
  const today = japanDate(now);
  const minutes = japanMinutes(now);

  // 1. Everyone whose time has come joins today's queue, once. Joining is separate from dialling, so
  //    waiting for a free line never makes someone "too late".
  for (const resident of await listResidents()) {
    const lateBy = minutes - toMinutes(resident.call_time);
    // `!(>= 0)` also stops a malformed call time, which would otherwise ring at any hour.
    if (resident.active === false || !resident.phone || resident.scheduled_on === today || !(lateBy >= 0)) continue;
    const queued = lateBy <= LATE_MINUTES;
    await updateResident(resident.id, (fresh) => ({ ...fresh, scheduled_on: today, call_queued: queued }));
    // The app was down at their time. Only someone it was calling yesterday is noted: a resident just
    // added, or the day daily calls are first switched on, is simply picked up tomorrow.
    if (!queued && resident.scheduled_on === daysBefore(today, 1)) await unplaced(resident, now);
  }

  // 2. Dial the next person in the queue: one per run, so calls start a few seconds apart, and none
  //    while as many are in progress as the phone plan allows.
  if ((await callsInProgress(now.getTime())) >= (Number(process.env.MAX_CONCURRENT_CALLS) || 5)) return;
  for (const { id } of (await listResidents()).filter((r) => r.scheduled_on === today && r.call_queued)) {
    // Taken off the queue before dialling, so a restart or a slow reply can't phone someone twice.
    // The cost: a crash between this line and the call means no call that day.
    let resident: Resident | undefined;
    await updateResident(id, (fresh) => {
      if (!fresh.call_queued) return fresh;
      resident = fresh;
      return { ...fresh, call_queued: false };
    });
    if (!resident || resident.active === false || !resident.phone) continue;
    // Already being looked after today: on the phone now, in the missed-call steps, or spoken to earlier.
    const spoken = (await listCalls(id)).some((c) => c.kind === "call" && japanDate(new Date(c.at)) === today);
    if (spoken || (await getLadder(id)) || (await callsInProgress(now.getTime(), id)) > 0) continue;

    // If the phone service refuses, the family is not told "no answer": that would be false, and in an
    // outage it would go to every family in town. It is noted for the coordinator instead.
    const failed = resident;
    await placeCall(resident).catch((e) => {
      console.error(e);
      return unplaced(failed, now);
    });
    return;
  }
}
