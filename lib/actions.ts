import { DEMO_MODE } from "./env";
import { buttons, push, text } from "./line";
import { getCall, getResident, schedule, updateCall, type Task } from "./store";
import type { Action, Resident, Risk, Role } from "./types";

// A red alert that nobody acknowledges is sent again, this often and this many times.
const ACK_MS = DEMO_MODE ? 30_000 : 10 * 60_000;
const MAX_RESENDS = 3;

const link = (resident: Resident) =>
  process.env.APP_URL ? `\n${process.env.APP_URL}/residents/${resident.id}` : "";

// The wording of each message, shared with the dashboard so it shows exactly what was sent.
export const alertText = (resident: Resident, reasons: string[]) => `${resident.name}さん — ${reasons.join("、")}`;
export const snowRequestText = (resident: Resident) =>
  `【除雪のお願い】${resident.name}さん宅の玄関前。雪で外に出られません。`;

/** Sends an alert. With `ackCallId`, it carries a "確認しました" button that records who saw it. */
export async function sendAlert(
  resident: Resident,
  to: Role[],
  reasons: string[],
  ack?: { callId: string; resend?: number },
) {
  const label = ack?.resend ? `【再通知${ack.resend}回目・要確認】` : "【要確認】";
  const messages: object[] = [text(`${label}${alertText(resident, reasons)}${link(resident)}`)];
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
  await scheduleRecheck(resident.id, callId, 1, to, reasons);
  return sent;
}

const scheduleRecheck = (residentId: string, callId: string, round: number, to: Role[], reasons: string[]) =>
  schedule({ kind: "alert_recheck", resident_id: residentId, call_id: callId, round, to, reasons, due: Date.now() + ACK_MS });

/**
 * Scheduled step: has anyone seen the red alert? If not, send it again to the same people.
 * Everything needed is on the task, so a call record that failed to save can't stop the re-sends.
 */
export async function recheckAlert({ resident_id, call_id: callId = "", round = 1, to, reasons }: Task) {
  const call = await getCall(callId);
  if (call?.handled || call?.acknowledged_by) return;
  const resident = await getResident(resident_id);
  if (!resident || !to || !reasons) return;
  // Book the next round first, so a failure below can't end the chain.
  if (round < MAX_RESENDS) await scheduleRecheck(resident_id, callId, round + 1, to, reasons);
  await sendAlert(resident, to, reasons, { callId, resend: round });
  await updateCall(callId, () => ({ alert_rounds: round }));
}

async function sendSnowRequest(resident: Resident, callId: string) {
  const message = buttons(snowRequestText(resident), [
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
