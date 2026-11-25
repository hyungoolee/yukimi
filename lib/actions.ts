import { DEMO_MODE } from "./env";
import { buttons, push, text } from "./line";
import { openRequests, REQUESTS, slotChoices, slotLabel, type RequestKind } from "./requests";
import { getCall, getResident, listCalls, listPeople, schedule, updateCall, type Task } from "./store";
import type { Action, AlertReasons, Delivery, Resident, Risk, Role, Slot } from "./types";

// A red alert that nobody acknowledges is sent again, this often and this many times.
const ACK_MS = DEMO_MODE ? 30_000 : 10 * 60_000;
const MAX_RESENDS = 3;
// Still unacknowledged at this re-send: the coordinators are told too.
const COORDINATORS_AT_RESEND = 2;
// A help request nobody has taken is passed to the coordinators after this long.
const REQUEST_WAIT_MS = DEMO_MODE ? 30_000 : 2 * 60 * 60_000;

const link = (resident: Resident) =>
  process.env.APP_URL ? `\n${process.env.APP_URL}/residents/${resident.id}` : "";

const ACK_BUTTON = "確認しました";
const ackButton = (resident: Resident, callId: string) =>
  buttons(`${resident.name}さんの件を確認したら押してください。`, [{ label: ACK_BUTTON, data: `ack:${callId}` }]);

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
    if (ack) messages.push(ackButton(resident, ack.callId));
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
  // Once only: noted on the call when it reached someone, so a later round tries again only if it did not.
  // With no call record there is nowhere to note it, so that case gets the one round.
  if (call ? round >= COORDINATORS_AT_RESEND && !call.coordinators_told_at : round === COORDINATORS_AT_RESEND) {
    await tellCoordinators(resident, callId, Object.keys(recipients) as Role[]);
  }
}

/**
 * Tells the coordinators that nobody has answered a red alert. No reasons: an alert about thoughts
 * of dying goes to the helper alone, so the detail stays off other phones.
 */
async function tellCoordinators(resident: Resident, callId: string, alreadySent: Role[]) {
  const has = new Set(alreadySent.map((role) => resident[role].line_id));
  const coordinators = (await listPeople()).filter((p) => p.coordinator && p.line_id && !has.has(p.line_id));
  const body = `【未確認・要確認】${resident.name}さんの緊急の通知に、まだ誰も応答していません。${link(resident)}`;
  const sent = await Promise.all(coordinators.map((p) => push(p.line_id, [text(body), ackButton(resident, callId)])));
  if (sent.some(Boolean)) await updateCall(callId, () => ({ coordinators_told_at: new Date().toISOString() }));
}

/** Asks the person for this kind of help, with a button for each half-day they could come. */
async function sendRequest(resident: Resident, callId: string, request: Extract<Action, { type: "request" }>): Promise<Delivery[]> {
  const { kind, request_id: id = callId } = request;
  const body = REQUESTS[kind].message(resident.name);
  const choices = slotChoices().map((slot) => ({ label: slotLabel(slot), data: `accept:${id}:${kind}:${slot.date}:${slot.part}` }));
  const button = choices.map((c) => c.label).join(" / ");
  // What she said she needs, so the person knows what to bring. Call notes, not fixed wording: marked as such.
  const needs = request.needs?.length ? `通話メモより：${request.needs.join("、").slice(0, 300)}` : "";
  const messages = [...(needs ? [text(needs)] : []), buttons(body, choices)];
  return [await deliver(resident, REQUESTS[kind].role, [needs, body].filter(Boolean).join("\n"), messages, { button })];
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

const scheduleCheck = (residentId: string, requestId: string, kind: RequestKind, wait: number, round = 1) =>
  schedule({ kind: "request_check", resident_id: residentId, call_id: requestId, request_kind: kind, round, due: Date.now() + wait });

/**
 * Has anyone taken the request? If not, the coordinators hear about it, once. Being told is what
 * stops a second message, so this is safe to run again: after a reminder, a restart, or a retry.
 */
export async function checkRequest({ resident_id, call_id: requestId = "", request_kind: kind, round = 1 }: Pick<Task, "resident_id" | "call_id" | "request_kind" | "round">) {
  const resident = await getResident(resident_id);
  if (!resident || !kind) return;
  // Closed, handled or gone stale: no longer open, so nothing to pass on.
  const open = openRequests(resident, await listCalls(resident_id)).find((r) => r.kind === kind && r.requestId === requestId);
  if (!open || open.status === "accepted" || open.escalated) return;
  const label = REQUESTS[kind].label.ja;
  // No name: the person in that role now may not be the one the request went to.
  const body =
    open.status === "not_sent"
      ? `【依頼先なし】${resident.name}さんの${label}。依頼を届けられる人がいません。`
      : `【引き受け手なし】${resident.name}さんの${label}。依頼しましたが、引き受ける人がまだ決まっていません。`;
  const coordinators = (await listPeople()).filter((p) => p.coordinator && p.line_id);
  const sent = await Promise.all(coordinators.map((p) => push(p.line_id, [text(`${body}${link(resident)}`)])));
  if (sent.some(Boolean)) {
    // Noted only when it reached someone: until then the card still shows the request waiting.
    const escalated_at = new Date().toISOString();
    await updateCall(open.callId, (call) => ({
      actions: call.actions.map((a) => (a.type === "request" && a.kind === kind ? { ...a, escalated_at } : a)),
    }));
  } else if (coordinators.length && round < MAX_RESENDS) {
    // LINE took none of them: try again shortly, a few times.
    await scheduleCheck(resident_id, requestId, kind, ACK_MS, round + 1);
  }
}

/** Carries out the rules' actions and reports, per recipient, what was sent and whether it went out. */
export async function runActions(resident: Resident, callId: string, risk: Risk, reasons: string[], actions: Action[]) {
  const alert = (reasonsByRole: AlertReasons) =>
    risk === "red" ? sendAndScheduleRedAlert(resident, callId, reasonsByRole) : sendAlert(resident, reasonsByRole);
  return Promise.all(
    actions.map(async (a) => {
      if (a.type === "alert") {
        const deliveries = await alert(a.reasonsByRole ?? sharedReasons(a.to, reasons));
        return { ...a, sent: anySent(deliveries), deliveries };
      }
      const deliveries = await sendRequest(resident, callId, a);
      const sent = anySent(deliveries);
      // Sent: the coordinators hear if nobody takes it in time. Reached nobody: they hear now.
      // A reminder on a later call does the same; the check says nothing once they have been told.
      const requestId = a.request_id ?? callId;
      if (sent) await scheduleCheck(resident.id, requestId, a.kind, REQUEST_WAIT_MS);
      else await checkRequest({ resident_id: resident.id, call_id: requestId, request_kind: a.kind });
      return { ...a, sent, deliveries };
    }),
  );
}
