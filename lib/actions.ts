import { DEMO_MODE } from "./env";
import { buttons, push, text } from "./line";
import { getCall, getResident, schedule, updateCall, type Task } from "./store";
import type { Action, AlertReasons, Resident, Risk, Role } from "./types";

// A red alert that nobody acknowledges is sent again, this often and this many times.
const ACK_MS = DEMO_MODE ? 30_000 : 10 * 60_000;
const MAX_RESENDS = 3;

const link = (resident: Resident) =>
  process.env.APP_URL ? `\n${process.env.APP_URL}/residents/${resident.id}` : "";

const sharedReasons = (to: Role[], reasons: string[]): AlertReasons =>
  Object.fromEntries(to.map((role) => [role, reasons]));

/** Sends each recipient their own reasons and, for red alerts, an acknowledgement button. */
async function sendAlert(
  resident: Resident,
  reasonsByRole: AlertReasons,
  ack?: { callId: string; resend?: number },
) {
  const label = ack?.resend ? `【再通知${ack.resend}回目・要確認】` : "【要確認】";
  const recipients = Object.entries(reasonsByRole) as [Role, string[]][];
  const sent = await Promise.all(recipients.map(([role, reasons]) => {
    const messages: object[] = [text(`${label}${resident.name}さん — ${reasons.join("、")}${link(resident)}`)];
    if (ack) {
      messages.push(
        buttons(`${resident.name}さんの件を確認したら押してください。`, [{ label: "確認しました", data: `ack:${ack.callId}` }]),
      );
    }
    return push(resident[role].line_id, messages);
  }));
  return sent.some(Boolean);
}

/** A red alert: sent now, and again later unless someone acknowledges it or marks the call handled. */
export async function sendRedAlert(resident: Resident, callId: string, to: Role[], reasons: string[]) {
  return sendAndScheduleRedAlert(resident, callId, sharedReasons(to, reasons));
}

async function sendAndScheduleRedAlert(resident: Resident, callId: string, reasonsByRole: AlertReasons) {
  await scheduleRecheck(resident.id, callId, 1, reasonsByRole);
  return sendAlert(resident, reasonsByRole, { callId });
}

const scheduleRecheck = (residentId: string, callId: string, round: number, reasonsByRole: AlertReasons) =>
  schedule({ kind: "alert_recheck", resident_id: residentId, call_id: callId, round, reasonsByRole, due: Date.now() + ACK_MS });

/**
 * Scheduled step: has anyone seen the red alert? If not, send it again to the same people.
 * Everything needed is on the task, so a call record that failed to save can't stop the re-sends.
 */
export async function recheckAlert({ resident_id, call_id: callId = "", round = 1, to, reasons, reasonsByRole }: Task) {
  const call = await getCall(callId);
  if (call?.handled || call?.acknowledged_by) return;
  const resident = await getResident(resident_id);
  const recipients = reasonsByRole ?? (to && reasons && sharedReasons(to, reasons));
  if (!resident || !recipients) return;
  // Book the next round first, so a failure below can't end the chain.
  if (round < MAX_RESENDS) await scheduleRecheck(resident_id, callId, round + 1, recipients);
  await sendAlert(resident, recipients, { callId, resend: round });
  await updateCall(callId, () => ({ alert_rounds: round }));
}

async function sendSnowRequest(resident: Resident, callId: string) {
  const message = buttons(`【除雪のお願い】${resident.name}さん宅の玄関前。雪で外に出られません。`, [
    { label: "引き受けます", data: `snow_accept:${callId}` },
  ]);
  return push(resident.snow_volunteer.line_id, [message]);
}

/** Carries out the rules' actions and reports which ones reached someone. */
export async function runActions(resident: Resident, callId: string, risk: Risk, reasons: string[], actions: Action[]) {
  const alert = (reasonsByRole: AlertReasons) =>
    risk === "red" ? sendAndScheduleRedAlert(resident, callId, reasonsByRole) : sendAlert(resident, reasonsByRole);
  return Promise.all(
    actions.map(async (a) => ({
      type: a.type,
      to: a.to,
      sent: a.type === "alert" ? await alert(a.reasonsByRole ?? sharedReasons(a.to, reasons)) : await sendSnowRequest(resident, callId),
    })),
  );
}
