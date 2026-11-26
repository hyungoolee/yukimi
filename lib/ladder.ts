import { anySent, sendRedAlert } from "./actions";
import { placeCall } from "./elevenlabs";
import { DEMO_MODE } from "./env";
import { buttons, push } from "./line";
import { callsInProgress, clearLadder, getLadder, getResident, saveCall, saveLadder, schedule, type LadderState } from "./store";
import type { CallRecord, Resident } from "./types";

// Demo mode runs the ladder in under a minute. Each later step is a task on disk (see lib/tick.ts),
// so a server restart delays it by a few seconds instead of dropping it.
const RETRY_MS = DEMO_MODE ? 20_000 : 30 * 60_000;
const CONFIRM_MS = DEMO_MODE ? 20_000 : 10 * 60_000;

/** A ladder still under way. An older file was left behind (a lost webhook, a restart) and is ignored. */
export const running = (ladder: LadderState | null | undefined): ladder is LadderState =>
  !!ladder && Date.now() - ladder.at < RETRY_MS + CONFIRM_MS + 60_000;

const record = (resident: Resident, id: string, fields: Pick<CallRecord, "kind" | "risk" | "reasons" | "actions">) =>
  saveCall({ id, resident_id: resident.id, at: new Date().toISOString(), ...fields });

async function redAlert(resident: Resident, reason: string) {
  await clearLadder(resident.id);
  const id = `missed-${Date.now()}`;
  const deliveries = await sendRedAlert(resident, id, ["helper", "second_contact"], [reason]);
  await record(resident, id, {
    kind: "missed",
    risk: "red",
    reasons: [reason],
    actions: [{ type: "alert", to: ["helper", "second_contact"], sent: anySent(deliveries), deliveries }],
  });
}

/** A call went unanswered (no pickup, busy, answering machine, or nobody spoke). */
export async function missed(residentId: string, attempt: number) {
  const resident = await getResident(residentId);
  if (!resident || resident.active === false) return;

  if (attempt === 1) {
    // A ladder is already running (an extra manual call, or a double click): let it finish, don't restart it.
    // Only while it is fresh, though: a file left behind by a restart must not block alerts for good.
    if (running(await getLadder(residentId))) return;
    const at = Date.now();
    await saveLadder(residentId, { stage: "retry", at });
    await schedule({ kind: "ladder_retry", resident_id: residentId, ladder_at: at, due: at + RETRY_MS });
    return;
  }

  const at = Date.now();
  await saveLadder(residentId, { stage: "second_contact", at });
  await push(resident.second_contact.line_id, [
    buttons(`${resident.name}さんが見守りの電話に2回出ませんでした。今日、ご様子を確認できていますか？`, [
      { label: "無事です", data: `ok:${residentId}` },
      { label: "確認できません", data: `ng:${residentId}` },
    ]),
  ]);
  await schedule({ kind: "ladder_confirm", resident_id: residentId, ladder_at: at, due: at + CONFIRM_MS });
}

/** Scheduled step: the second phone attempt. */
export async function retryStep(residentId: string, ladderAt?: number) {
  // Someone may have reached the resident in the meantime, or this step is left over from an earlier ladder.
  const ladder = await getLadder(residentId);
  if (ladder?.stage !== "retry" || ladder.at !== ladderAt) return;
  // Read now, not when the ladder started: the phone number may have been corrected since.
  const resident = await getResident(residentId);
  if (!resident) return;
  // No number to retry: go straight to asking the second contact.
  if (!resident.phone) return missed(residentId, 2);
  // Another call has her line (a news call): a busy line is not a missed call, so try a little later.
  if ((await callsInProgress(Date.now(), residentId)) > 0) {
    await schedule({ kind: "ladder_retry", resident_id: residentId, ladder_at: ladderAt, due: Date.now() + 2 * 60_000 });
    return;
  }
  await placeCall(resident, 2).catch(() => missed(residentId, 2));
}

/** Scheduled step: the second contact has had their time to answer. */
export async function confirmStep(residentId: string, ladderAt?: number) {
  const resident = await getResident(residentId);
  const ladder = await getLadder(residentId);
  if (resident && ladder?.stage === "second_contact" && ladder.at === ladderAt) {
    await redAlert(resident, "電話に2回応答なし。第二連絡先からも返事なし");
  }
}

/** The second contact tapped a button on the LINE check. */
export async function secondContactAnswered(residentId: string, ok: boolean, lineUserId: string | undefined) {
  const resident = await getResident(residentId);
  if (!resident || !lineUserId || resident.second_contact.line_id !== lineUserId) return;
  if ((await getLadder(residentId))?.stage !== "second_contact") return;
  if (!ok) return redAlert(resident, "電話に2回応答なし。第二連絡先も確認できず");
  await clearLadder(residentId);
  await record(resident, `confirmed_ok-${Date.now()}`, {
    kind: "confirmed_ok",
    risk: "green",
    reasons: [`電話に応答なし。${resident.second_contact.name}さんが無事を確認`],
    actions: [],
  });
}
