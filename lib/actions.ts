import { DEMO_MODE } from "./env";
import { buttons, push, text } from "./line";
import { REQUESTS, slotChoices, slotLabel, type RequestKind } from "./requests";
import { getCall, getResident, schedule, updateCall, type Task } from "./store";
import type { Action, AlertReasons, Delivery, Resident, Risk, Role, Slot } from "./types";

// A red alert that nobody acknowledges is sent again, this often and this many times.
const ACK_MS = DEMO_MODE ? 30_000 : 10 * 60_000;
const MAX_RESENDS = 3;

const link = (resident: Resident) =>
  process.env.APP_URL ? `\n${process.env.APP_URL}/residents/${resident.id}` : "";

const ACK_BUTTON = "確認しました";

/** Sends one person's message and records exactly what went out and whether LINE took it. */
async function deliver(resident: Resident, role: Role, sentText: string, messages: object[], extra: Partial<Delivery>): Promise<Delivery> {
  const lineId = resident[role].line_id;
  return { role, text: sentText, ...extra, sent: await push(lineId, messages), registered: Boolean(lineId) };
}

export const anySent = (deliveries: Delivery[]) => deliveries.some((d) => d.sent);

const sharedReasons = (to: Role[], reasons: string[]): AlertReasons =>
  Object.fromEntries(to.map((role) => [role, reasons]));

/** Sends each recipient their own reasons and, for red alerts, an acknowledgement button. */
async function sendAlert(
  resident: Resident,
  reasonsByRole: AlertReasons,
  ack?: { callId: string; resend?: number },
): Promise<Delivery[]> {
  const label = ack?.resend ? `【再通知${ack.resend}回目・要確認】` : "【要確認】";
  const recipients = Object.entries(reasonsByRole) as [Role, string[]][];
  return Promise.all(recipients.map(([role, reasons]) => {
    const body = `${label}${resident.name}さん — ${reasons.join("、")}${link(resident)}`;
    const messages: object[] = [text(body)];
    if (ack) {
      messages.push(
        buttons(`${resident.name}さんの件を確認したら押してください。`, [{ label: ACK_BUTTON, data: `ack:${ack.callId}` }]),
      );
    }
    return deliver(resident, role, body, messages, { reasons, button: ack ? ACK_BUTTON : undefined });
  }));
}

/**
 * A red alert: sent now, and again later unless someone acknowledges it or marks the call handled.
 * Returns what was sent to each person; save it on the call record's action as `deliveries`.
 */
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

/** Asks the person for this kind of help, with a button for each half-day they could come. */
async function sendRequest(resident: Resident, callId: string, kind: RequestKind): Promise<Delivery[]> {
  const body = REQUESTS[kind].message(resident.name);
  const choices = slotChoices().map((slot) => ({ label: slotLabel(slot), data: `accept:${callId}:${kind}:${slot.date}:${slot.part}` }));
  const button = choices.map((c) => c.label).join(" / ");
  return [await deliver(resident, REQUESTS[kind].role, body, [buttons(body, choices)], { button })];
}

/**
 * Records who took a request and when they will come. The first to answer has it: `mine` is false
 * for anyone after, and `request` then shows who does.
 */
export async function acceptRequest(callId: string, kind: RequestKind, name: string, slot?: Slot) {
  const isIt = (a: { type: string; kind?: string }) => a.type === "request" && a.kind === kind;
  const saved = await updateCall(callId, (call) =>
    call.actions.some((a) => isIt(a) && a.accepted_by === undefined)
      ? { actions: call.actions.map((a) => (isIt(a) ? { ...a, accepted_by: name, slot } : a)) }
      : null,
  );
  const request = (saved ?? (await getCall(callId)))?.actions.find(isIt);
  return { mine: !!saved, request };
}

/** Carries out the rules' actions and reports, per recipient, what was sent and whether it went out. */
export async function runActions(resident: Resident, callId: string, risk: Risk, reasons: string[], actions: Action[]) {
  const alert = (reasonsByRole: AlertReasons) =>
    risk === "red" ? sendAndScheduleRedAlert(resident, callId, reasonsByRole) : sendAlert(resident, reasonsByRole);
  return Promise.all(
    actions.map(async (a) => {
      const deliveries =
        a.type === "alert" ? await alert(a.reasonsByRole ?? sharedReasons(a.to, reasons)) : await sendRequest(resident, callId, a.kind);
      return { ...a, sent: anySent(deliveries), deliveries };
    }),
  );
}
