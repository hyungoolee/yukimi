import { sendAlert } from "./actions";
import { placeCall } from "./elevenlabs";
import { DEMO_MODE } from "./env";
import { buttons, push } from "./line";
import { clearLadder, getLadder, getResident, saveCall, saveLadder } from "./store";
import type { CallRecord, Resident } from "./types";

// Demo mode runs the ladder in under a minute. Timers live in memory: a restart drops pending steps.
const RETRY_MS = DEMO_MODE ? 20_000 : 30 * 60_000;
const CONFIRM_MS = DEMO_MODE ? 20_000 : 10 * 60_000;

const later = (ms: number, step: () => Promise<void>) =>
  setTimeout(() => step().catch((e) => console.error("Ladder step failed", e)), ms);

const record = (resident: Resident, fields: Pick<CallRecord, "kind" | "risk" | "reasons" | "actions">) =>
  saveCall({ id: `${fields.kind}-${Date.now()}`, resident_id: resident.id, at: new Date().toISOString(), ...fields });

async function redAlert(resident: Resident, reason: string) {
  await clearLadder(resident.id);
  const sent = await sendAlert(resident, ["helper", "second_contact"], [reason]);
  await record(resident, {
    kind: "missed",
    risk: "red",
    reasons: [reason],
    actions: [{ type: "alert", to: ["helper", "second_contact"], sent }],
  });
}

/** A call went unanswered (no pickup, busy, answering machine, or nobody spoke). */
export async function missed(residentId: string, attempt: number) {
  const resident = await getResident(residentId);
  if (!resident) return;

  if (attempt === 1) {
    // A ladder is already running (an extra manual call, or a double click): let it finish, don't restart it.
    // Only while it is fresh, though: a file left behind by a restart must not block alerts for good.
    const active = await getLadder(residentId);
    if (active && Date.now() - active.at < RETRY_MS + CONFIRM_MS + 60_000) return;
    await saveLadder(residentId, { stage: "retry", at: Date.now() });
    later(RETRY_MS, async () => {
      // Someone may have reached the resident in the meantime.
      if ((await getLadder(residentId))?.stage !== "retry") return;
      // Re-read: the phone number may have been corrected since the first attempt.
      const current = (await getResident(residentId)) ?? resident;
      // No number to retry: go straight to asking the second contact.
      if (!current.phone) return missed(residentId, 2);
      await placeCall(current, 2).catch(() => missed(residentId, 2));
    });
    return;
  }

  await saveLadder(residentId, { stage: "second_contact", at: Date.now() });
  await push(resident.second_contact.line_id, [
    buttons(`${resident.name}さんが見守りの電話に2回出ませんでした。今日、ご様子を確認できていますか？`, [
      { label: "無事です", data: `ok:${residentId}` },
      { label: "確認できません", data: `ng:${residentId}` },
    ]),
  ]);
  later(CONFIRM_MS, async () => {
    if ((await getLadder(residentId))?.stage === "second_contact") {
      await redAlert(resident, "電話に2回応答なし。第二連絡先からも返事なし");
    }
  });
}

/** The second contact tapped a button on the LINE check. */
export async function secondContactAnswered(residentId: string, ok: boolean, lineUserId: string | undefined) {
  const resident = await getResident(residentId);
  if (!resident || !lineUserId || resident.second_contact.line_id !== lineUserId) return;
  if ((await getLadder(residentId))?.stage !== "second_contact") return;
  if (!ok) return redAlert(resident, "電話に2回応答なし。第二連絡先も確認できず");
  await clearLadder(residentId);
  await record(resident, {
    kind: "confirmed_ok",
    risk: "green",
    reasons: [`電話に応答なし。${resident.second_contact.name}さんが無事を確認`],
    actions: [],
  });
}
