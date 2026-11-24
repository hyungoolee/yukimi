import { DEMO_MODE } from "./env";
import { buttons, push, text } from "./line";
import { getCall, getResident, saveCall, schedule } from "./store";
import type { Action, Resident, Risk, Role } from "./types";

// A red alert that nobody acknowledges is sent again, this often and this many times.
const ACK_MS = DEMO_MODE ? 30_000 : 10 * 60_000;
const MAX_RESENDS = 3;

const link = (resident: Resident) =>
  process.env.APP_URL ? `\n${process.env.APP_URL}/residents/${resident.id}` : "";

/** Sends an alert. With `ackCallId`, it carries a "確認しました" button that records who saw it. */
export async function sendAlert(
  resident: Resident,
  to: Role[],
  reasons: string[],
  ack?: { callId: string; resend?: number },
) {
  const label = ack?.resend ? `【再通知${ack.resend}回目・要確認】` : "【要確認】";
  const messages: object[] = [text(`${label}${resident.name}さん — ${reasons.join("、")}${link(resident)}`)];
  if (ack) {
    messages.push(
      buttons(`${resident.name}さんの件を確認したら押してください。`, [{ label: "確認しました", data: `ack:${ack.callId}` }]),
    );
  }
  const sent = await Promise.all(to.map((role) => push(resident[role].line_id, messages)));
  return sent.some(Boolean);
}

/** A red alert: sent now, and again later unless someone acknowledges it or marks the call handled. */
export async function sendRedAlert(resident: Resident, callId: string, to: Role[], reasons: string[]) {
  const sent = await sendAlert(resident, to, reasons, { callId });
  await schedule({ kind: "alert_recheck", resident_id: resident.id, call_id: callId, round: 1, due: Date.now() + ACK_MS });
  return sent;
}

/** Scheduled step: has anyone seen the red alert? If not, send it again to the same people. */
export async function recheckAlert(callId: string, round: number) {
  const call = await getCall(callId);
  if (!call || call.handled || call.acknowledged_by) return;
  const resident = await getResident(call.resident_id);
  const to = call.actions.find((a) => a.type === "alert")?.to;
  if (!resident || !to) return;
  await sendAlert(resident, to, call.reasons, { callId, resend: round });
  // Re-read before saving: an acknowledgement may have landed while LINE was being called.
  await saveCall({ ...((await getCall(callId)) ?? call), alert_rounds: round });
  if (round < MAX_RESENDS) {
    await schedule({ kind: "alert_recheck", resident_id: resident.id, call_id: callId, round: round + 1, due: Date.now() + ACK_MS });
  }
}

async function sendSnowRequest(resident: Resident, callId: string) {
  const message = buttons(`【除雪のお願い】${resident.name}さん宅の玄関前。雪で外に出られません。`, [
    { label: "引き受けます", data: `snow_accept:${callId}` },
  ]);
  return push(resident.snow_volunteer.line_id, [message]);
}

/** Carries out the rules' actions and reports which ones reached someone. */
export async function runActions(resident: Resident, callId: string, risk: Risk, reasons: string[], actions: Action[]) {
  const alert = (to: Role[]) =>
    risk === "red" ? sendRedAlert(resident, callId, to, reasons) : sendAlert(resident, to, reasons);
  return Promise.all(
    actions.map(async (a) => ({
      ...a,
      sent: a.type === "alert" ? await alert(a.to) : await sendSnowRequest(resident, callId),
    })),
  );
}
