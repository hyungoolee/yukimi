import { DEMO_MODE } from "./env";
import { buttons, push, text } from "./line";
import { EMERGENCY } from "./rules";
import { helpers, openRequests, REQUESTS, slotChoices, slotLabel, stageKey, tellsFamily, type OpenRequest, type RequestKind } from "./requests";
import { getCall, getResident, listCalls, listPeople, schedule, updateCall, type Task } from "./store";
import type { Action, AlertReasons, Contact, Delivery, Resident, Risk, Role, Slot } from "./types";

// A red alert that nobody acknowledges is sent again, this often and this many times.
const ACK_MS = DEMO_MODE ? 30_000 : 10 * 60_000;
const MAX_RESENDS = 3;
// Still unacknowledged at this re-send: the coordinators are told too.
const COORDINATORS_AT_RESEND = 2;
// A help request nobody has taken is passed to the coordinators after this long.
const REQUEST_WAIT_MS = DEMO_MODE ? 30_000 : 2 * 60 * 60_000;
// With more than one person in line for a request, each has this long before the next is asked.
const STEP_WAIT_MS = DEMO_MODE ? 20_000 : 60 * 60_000;

const link = (resident: Resident) =>
  process.env.APP_URL ? `\n${process.env.APP_URL}/residents/${resident.id}` : "";

const ACK_BUTTON = "確認しました";
const ackButton = (resident: Resident, callId: string) =>
  buttons(`${resident.name}さんの件を確認したら押してください。`, [{ label: ACK_BUTTON, data: `ack:${callId}` }]);

// She was told to phone an ambulance herself, and may not manage it: whoever reads this does it for her.
// We hold no street address, so they give the one they know.
const callForThem = (r: Resident) =>
  `\nいますぐ${r.name}さんに電話してください${r.phone ? `（${r.phone}）` : ""}。出ないときや、ご本人が119番にかけられないときは、代わりに119番に電話して、${r.name}さんの住所を伝えてください。`;

/** Sends one person's message and records exactly what went out and whether LINE took it. */
async function deliver(resident: Resident, role: Role, sentText: string, messages: object[], extra: Partial<Delivery>, to: Contact = resident[role]): Promise<Delivery> {
  const lineId = to.line_id;
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
    const urgent = reasons.some((r) => r.startsWith(EMERGENCY)) ? callForThem(resident) : "";
    const body = `${label}${resident.name}さん — ${reasons.join("、")}${urgent}${link(resident)}`;
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
  // The record as it is now: someone may have tapped the button while the re-send was going out.
  const now = await updateCall(callId, () => ({ alert_rounds: round }));
  if (now?.handled || now?.acknowledged_by) return;
  // Each coordinator once: those reached are noted on the call, so a later round tries only the rest.
  // With no call record there is nowhere to note it, so that case gets the one round.
  if (now ? round >= COORDINATORS_AT_RESEND : round === COORDINATORS_AT_RESEND) {
    await tellCoordinators(resident, callId, Object.keys(recipients) as Role[], now?.coordinators_told ?? []);
  }
}

/**
 * Tells the coordinators that nobody has answered a red alert. No reasons: an alert about thoughts
 * of dying goes to the helper alone, so the detail stays off other phones.
 */
async function tellCoordinators(resident: Resident, callId: string, alreadySent: Role[], told: string[]) {
  const has = new Set(alreadySent.map((role) => resident[role].line_id));
  const coordinators = (await listPeople()).filter((p) => p.coordinator && p.line_id && !has.has(p.line_id) && !told.includes(p.id));
  const body = `【未確認・要確認】${resident.name}さんの緊急の通知に、まだ誰も応答していません。${link(resident)}`;
  const sent = await Promise.all(coordinators.map((p) => push(p.line_id, [text(body), ackButton(resident, callId)])));
  const reached = coordinators.filter((_, i) => sent[i]).map((p) => p.id);
  if (!reached.length) return;
  const at = new Date().toISOString();
  await updateCall(callId, (c) => ({
    coordinators_told_at: c.coordinators_told_at ?? at,
    coordinators_told: [...(c.coordinators_told ?? []), ...reached],
  }));
}

type RequestAction = Extract<Action, { type: "request" }>;
type Stage = { asked: number };
const isRequest = (kind: RequestKind) => (a: { type: string; kind?: string }) => a.type === "request" && a.kind === kind;

/** Asks one person for this kind of help, with a button for each half-day they could come. */
async function sendRequest(resident: Resident, callId: string, request: RequestAction, who: Contact, first: boolean): Promise<Delivery> {
  const { kind, request_id: id = callId } = request;
  const body = REQUESTS[kind].message(resident.name);
  const choices = slotChoices().map((slot) => ({ label: slotLabel(slot), data: `accept:${id}:${kind}:${slot.date}:${slot.part}` }));
  const button = choices.map((c) => c.label).join(" / ");
  // What she said she needs, so the person knows what to bring. Call notes, not fixed wording: marked as such.
  const needs = request.needs?.length ? `通話メモより：${request.needs.join("、").slice(0, 300)}` : "";
  const messages = [...(needs ? [text(needs)] : []), buttons(body, choices)];
  // Someone further down the line is recorded by name: the role alone would point at the first person.
  const extra = first ? { button } : { button, person: who.id, name: who.name };
  return deliver(resident, REQUESTS[kind].role, [needs, body].filter(Boolean).join("\n"), messages, extra, who);
}

/**
 * Tells the family that a business, which charges, has been asked. They are told, not asked: putting
 * the business in this resident's line (the 連絡体制 page) is the agreement. The price is between the two of them.
 */
function tellFamily(resident: Resident, kind: RequestKind, business: Contact): Promise<Delivery> {
  const body = `【有料の${REQUESTS[kind].label.ja}】${resident.name}さんの件で、${business.name}（有料）にお願いしました。費用は先方と直接ご相談ください。`;
  return deliver(resident, "second_contact", body, [text(body)], {});
}

/**
 * Asks the person at `from` in the line, or the first after them who can be reached. When that is a
 * business, the family is told. `asked` past the end of the line means everyone has been tried.
 * `deliveries` is every message tried, the family's included; `reached` is whether a helper got one.
 */
async function askFrom(resident: Resident, callId: string, request: RequestAction, from: number) {
  const line = helpers(resident, request.kind);
  const deliveries: Delivery[] = [];
  for (let i = from; i < line.length; i++) {
    const asked = await sendRequest(resident, callId, request, line[i], i === 0);
    deliveries.push(asked);
    if (!asked.sent) continue;
    if (tellsFamily(request.kind, line[i])) deliveries.push(await tellFamily(resident, request.kind, line[i]));
    return { deliveries, reached: true, stage: { asked: i } satisfies Stage };
  }
  return { deliveries, reached: false, stage: { asked: line.length } satisfies Stage };
}

/** How long whoever was just asked has before the request moves on. One person in line: as it always was. */
const waitFor = (resident: Resident, kind: RequestKind) => (helpers(resident, kind).length > 1 ? STEP_WAIT_MS : REQUEST_WAIT_MS);

/** Writes where a request now stands on its record, with any messages that went out getting it there. */
const saveStage = (callId: string, kind: RequestKind, stage: Stage, step_due: number | undefined, sent?: { deliveries: Delivery[]; reached: boolean }) =>
  updateCall(callId, (c) => ({
    actions: c.actions.map((a) =>
      isRequest(kind)(a)
        ? { ...a, asked: stage.asked, step_due, ...(sent ? { sent: a.sent || sent.reached, deliveries: [...(a.deliveries ?? []), ...sent.deliveries] } : {}) }
        : a,
    ),
  }));

/**
 * Moves an open request on to the next person who can be asked, and books the check on them.
 * False when the line has run out: the coordinators are the ones to tell.
 */
async function advance(resident: Resident, callId: string, kind: RequestKind, from: number) {
  const request = (await getCall(callId))?.actions.find(isRequest(kind)) as RequestAction | undefined;
  if (!request) return false;
  const result = await askFrom(resident, callId, request, from);
  const due = result.reached ? Date.now() + waitFor(resident, kind) : undefined;
  await saveStage(callId, kind, result.stage, due, result);
  if (due) await scheduleCheck(resident.id, request.request_id ?? callId, kind, due, callId, stageKey(result.stage));
  return result.reached;
}

/**
 * A later call raised a request that is still with someone: that person keeps their turn and the
 * time they have left. Undefined when there is no turn to keep (nobody was asked, the line ran out,
 * the coordinators have it, or a visit was promised and missed), and the request starts again from the top.
 */
async function inFlight(resident: Resident, callId: string, kind: RequestKind, requestId: string) {
  const earlier = (await listCalls(resident.id)).filter((c) => c.id !== callId);
  const open = openRequests(resident, earlier).find((r) => r.kind === kind && r.requestId === requestId);
  if (!open || open.status !== "sent" || open.exhausted || open.escalated || open.stepDue === undefined) return undefined;
  return open as OpenRequest & { stepDue: number };
}

/**
 * Records who took a request and when they will come. The first to answer has it: `mine` is false
 * for anyone after, and `request` then shows who does.
 */
export async function acceptRequest(callId: string, kind: RequestKind, name: string, slot?: Slot, business = false) {
  const isIt = isRequest(kind);
  const saved = await updateCall(callId, (call) =>
    call.actions.some((a) => isIt(a) && a.accepted_by === undefined)
      ? { actions: call.actions.map((a) => (isIt(a) ? { ...a, accepted_by: name, slot, ...(business ? { accepted_business: true } : {}) } : a)) }
      : null,
  );
  const request = (saved ?? (await getCall(callId)))?.actions.find(isIt);
  return { mine: !!saved, request };
}

const scheduleCheck = (residentId: string, requestId: string, kind: RequestKind, due: number, record?: string, stage?: string, round = 1) =>
  schedule({
    kind: "request_check", resident_id: residentId, call_id: requestId, request_kind: kind, round, due,
    ...(record ? { record } : {}),
    ...(stage ? { stage } : {}),
  });

/**
 * Has anyone taken the request? If not, it moves on to the next person in line, and when there is
 * nobody left the coordinators hear about it, once. Being told is what stops a second message, so
 * this is safe to run again: after a reminder, a restart, or a retry.
 */
export async function checkRequest({ resident_id, call_id: requestId = "", request_kind: kind, round = 1, record, stage }: Pick<Task, "resident_id" | "call_id" | "request_kind" | "round" | "record" | "stage">) {
  const resident = await getResident(resident_id);
  if (!resident || !kind) return;
  // Closed, handled or gone stale: no longer open, so nothing to pass on.
  const open = openRequests(resident, await listCalls(resident_id)).find((r) => r.kind === kind && r.requestId === requestId);
  if (!open || open.status === "accepted" || open.escalated) return;
  // Booked for an earlier state of the request: a later call asked again, or it has already moved on.
  // Whatever moved it booked a check of its own.
  if ((record && record !== open.callId) || (stage && stage !== open.stage)) return;
  // The person asked has had their time: on to whoever is next.
  if (round === 1 && !open.exhausted && (await advance(resident, open.callId, kind, open.asked + 1))) return;
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
    await scheduleCheck(resident_id, requestId, kind, Date.now() + ACK_MS, undefined, undefined, round + 1);
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
      const requestId = a.request_id ?? callId;
      // A reminder while the request is still with someone: it stays with them, and so does their deadline.
      const current = requestId === callId ? undefined : await inFlight(resident, callId, a.kind, requestId);
      const who = current && helpers(resident, a.kind)[current.asked];
      if (current && who) {
        // The helper whose turn it is hears again. The family was told when a business was first asked: not twice.
        const deliveries = [await sendRequest(resident, callId, a, who, current.asked === 0)];
        await saveStage(callId, a.kind, current, current.stepDue);
        await scheduleCheck(resident.id, requestId, a.kind, current.stepDue, callId, current.stage);
        return { ...a, sent: true, deliveries }; // sent: it reached them on the earlier call
      }
      const { deliveries, reached, stage } = await askFrom(resident, callId, a, 0);
      // Someone was asked: if they don't take it in time it moves down the line, and at the end of
      // the line the coordinators hear. Reached nobody: they hear now.
      // A reminder once the line has run out does the same; the check says nothing once they have been told.
      const due = reached ? Date.now() + waitFor(resident, a.kind) : undefined;
      // Where the request stands is kept on the record; the caller adds what was sent.
      await saveStage(callId, a.kind, stage, due);
      if (due) await scheduleCheck(resident.id, requestId, a.kind, due, callId, stageKey(stage));
      else await checkRequest({ resident_id: resident.id, call_id: requestId, request_kind: a.kind });
      return { ...a, sent: reached, deliveries };
    }),
  );
}
