import { placeNewsCall } from "./elevenlabs";
import { DEMO_MODE } from "./env";
import { buttons, push, text } from "./line";
import { EMERGENCY } from "./rules";
import { canAsk, choicesFor, helpers, japanHour, nextFrom, openRequests, passed, REQUESTS, san, slotLabel, stageKey, tellsFamily, type OpenRequest, type RequestKind } from "./requests";
import { callsInProgress, getCall, getLadder, getResident, listCalls, listPeople, schedule, updateCall, type Task } from "./store";
import type { Action, AlertReasons, Contact, Delivery, RequestState, Resident, Risk, Role, Slot, Told } from "./types";

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
const isRequest = (kind: RequestKind) => (a: { type: string; kind?: string }) => a.type === "request" && a.kind === kind;

export const CANT_COME = "行けません";

/** Asks one person for this kind of help, with a button for each half-day they could come. */
async function sendRequest(resident: Resident, callId: string, request: RequestAction, who: Contact, first: boolean): Promise<Delivery> {
  const { kind, request_id: id = callId } = request;
  const body = REQUESTS[kind].message(resident.name);
  const choices = [
    ...choicesFor(kind).map((slot) => ({ label: slotLabel(slot), data: `accept:${id}:${kind}:${slot.date}:${slot.part}` })),
    // Saying no at once hands it to the next person, instead of leaving it with them until their time runs out.
    { label: CANT_COME, data: `decline:${id}:${kind}` },
  ];
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

/** How long whoever was just asked has before the request moves on. One person in line: as it always was. */
const waitFor = (resident: Resident, kind: RequestKind) => (helpers(resident, kind).length > 1 ? STEP_WAIT_MS : REQUEST_WAIT_MS);

/** Adds to a request's record: where it now stands, and any messages that went out. */
const record = (callId: string, kind: RequestKind, patch: Partial<RequestState>, sent: Delivery[] = [], reached = false) =>
  updateCall(callId, (c) => ({
    actions: c.actions.map((a) =>
      isRequest(kind)(a) ? { ...a, ...patch, sent: a.sent || reached, deliveries: sent.length ? [...(a.deliveries ?? []), ...sent] : a.deliveries } : a,
    ),
  }));

/**
 * Asks the person at `from` in the line, or the first after them who can be asked and reached, and
 * books the check on them. A business that was not agreed for this resident is passed over (canAsk).
 * The moment someone has the request it is on the record, before anything else is sent: their
 * buttons work as soon as the message arrives. Then, when they are a business, the family is told.
 * `deliveries` is every message tried, the family's included; `reached` is whether a helper got one.
 * Not reached: the line has run out, the record says so, and the coordinators are the ones to tell.
 */
async function askFrom(resident: Resident, callId: string, request: RequestAction, from: number) {
  const { kind } = request;
  const line = helpers(resident, kind);
  const deliveries: Delivery[] = [];
  // Whoever has had this request on this run of the line is not asked again, wherever they now stand.
  const tried = ((await getCall(callId))?.actions.find(isRequest(kind)) as RequestState | undefined)?.tried ?? [];
  for (let i = from; i < line.length; i++) {
    if (!canAsk(resident, line[i]) || (line[i].id && tried.includes(line[i].id!))) continue;
    const asked = await sendRequest(resident, callId, request, line[i], i === 0);
    deliveries.push(asked);
    if (!asked.sent) continue;
    const due = Date.now() + waitFor(resident, kind);
    const stage = { asked: i, asked_id: line[i].id, step_due: due, tried: line[i].id ? [...tried, line[i].id!] : tried };
    await record(callId, kind, stage, deliveries, true);
    await scheduleCheck(resident.id, request.request_id ?? callId, kind, due, callId, stageKey(stage));
    if (tellsFamily(kind, line[i])) {
      const told = await tellFamily(resident, kind, line[i]);
      deliveries.push(told);
      await record(callId, kind, {}, [told]);
    }
    return { deliveries, reached: true };
  }
  await record(callId, kind, { asked: line.length, asked_id: undefined, step_due: undefined, tried }, deliveries);
  return { deliveries, reached: false };
}

/**
 * Ends the turn of whoever has the request now, if it is still the turn `open` describes, so that
 * exactly one of their timeout and their own "can't come" moves the request on. False when the turn
 * has already ended or changed.
 */
async function endTurn(open: OpenRequest) {
  const isIt = isRequest(open.kind);
  return !!(await updateCall(open.callId, (c) => {
    const a = c.actions.find(isIt);
    if (!a || a.accepted_by !== undefined || stageKey(a) !== open.stage) return null;
    return { actions: c.actions.map((x) => (isIt(x) ? { ...x, step_due: -1 } : x)) };
  }));
}

/**
 * The person asked tapped 行けません: on to the next in line now, or the coordinators if there is nobody.
 * False when it isn't their turn any more (someone took it, or it has moved on).
 */
export async function declineRequest(resident: Resident, open: OpenRequest) {
  if (open.status !== "sent" || open.exhausted || !(await endTurn(open))) return false;
  if (await advance(resident, open.callId, open.kind, nextFrom(resident, open))) return true;
  await checkRequest({ resident_id: resident.id, call_id: open.requestId, request_kind: open.kind });
  return true;
}

/** Moves an open request on to the next person who can be asked. False when the line has run out. */
async function advance(resident: Resident, callId: string, kind: RequestKind, from: number) {
  const request = (await getCall(callId))?.actions.find(isRequest(kind)) as RequestAction | undefined;
  return !!request && (await askFrom(resident, callId, request, from)).reached;
}

/**
 * A later call raised a request that is still with someone: where it stood on the earlier record.
 * Undefined when there is no turn to keep (nobody was asked, the line ran out, or a visit was
 * promised and missed), and the request starts again from the top.
 */
async function inFlight(resident: Resident, callId: string, kind: RequestKind, requestId: string) {
  const earlier = (await listCalls(resident.id)).filter((c) => c.id !== callId);
  const open = openRequests(resident, earlier).find((r) => r.kind === kind && r.requestId === requestId);
  if (!open || open.status !== "sent" || open.exhausted || open.stepDue === undefined || open.stepDue < 0) return undefined;
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
      ? { actions: call.actions.map((a) => (isIt(a) ? { ...a, accepted_by: name, slot, accepted_at: new Date().toISOString(), ...(business ? { accepted_business: true } : {}) } : a)) }
      : null,
  );
  const request = (saved ?? (await getCall(callId)))?.actions.find(isIt);
  // Only the first to accept passes the news on; a failure here must not lose the accept itself.
  if (saved) await announce(saved.resident_id, callId, kind, name, slot, business).catch((e) => console.error("Could not pass on the accept", e));
  return { mine: !!saved, request };
}

/** Someone has said they will come: phone the resident with the news, and for snow, tell the family too. */
async function announce(residentId: string, callId: string, kind: RequestKind, name: string, slot?: Slot, business = false) {
  await schedule({ kind: "news_call", resident_id: residentId, call_id: callId, request_kind: kind, due: Date.now() });
  // For supplies the family is the one who accepted.
  const resident = await getResident(residentId);
  if (kind === "snow" && resident) {
    // A business is named as it is, and the family, who will be paying, is reminded that it charges.
    const who = business ? `${name}（有料）` : san(name);
    const paid = business ? "費用は先方と直接ご相談ください。" : "";
    await push(resident.second_contact.line_id, [text(`${who}が${slot ? `${slotLabel(slot)}、` : ""}${resident.name}さん宅の雪かきに伺います。${paid}`)]);
  }
}

// News calls are made in the day only, Japan time.
const NEWS_FROM = 8;
const NEWS_UNTIL = 20;
const WAIT_MS = 10 * 60_000;

/** The next NEWS_FROM o'clock in Japan (UTC+9, no daylight saving), as epoch ms. */
function nextMorning(now: Date) {
  const japan = new Date(now.getTime() + 9 * 3600_000);
  const morning = Date.UTC(japan.getUTCFullYear(), japan.getUTCMonth(), japan.getUTCDate(), NEWS_FROM) - 9 * 3600_000;
  return morning > now.getTime() ? morning : morning + 24 * 3600_000;
}

/** What the resident hears: 「山本さんが今日の午後に雪かきに伺います。」 */
export const newsText = (request: OpenRequest, now = new Date()) =>
  `${request.business ? request.who : san(request.who)}が${request.slot ? `${slotLabel(request.slot, now)}に` : ""}${REQUESTS[request.kind].news}。`;

/** Saves how the news reached the resident on the request it was about. */
export const recordTold = (callId: string, kind: string, told: Told) =>
  updateCall(callId, (call) => ({
    actions: call.actions.map((a) => (a.type === "request" && a.kind === kind ? { ...a, told } : a)),
  }));

/**
 * Scheduled step: phone the resident that someone is coming. Skipped once the request is closed, the
 * time has passed, or she has been told; put off at night, and while another call to her is going on.
 */
export async function newsStep({ resident_id, call_id, request_kind: kind }: Pick<Task, "resident_id" | "call_id" | "request_kind">, now = new Date()) {
  const resident = await getResident(resident_id);
  if (!resident || resident.active === false || !call_id || !kind) return;
  const calls = await listCalls(resident_id);
  const request = openRequests(resident, calls, now).find((r) => r.kind === kind && r.callId === call_id);
  if (!request || request.status !== "accepted" || request.told || (request.slot && passed(request.slot, now))) return;
  // A check-in since the accept has told her already (help_status): calling again would repeat it.
  const acceptedAt = request.acceptedAt;
  if (acceptedAt && calls.some((c) => c.kind === "call" && c.at > acceptedAt)) return;
  const later = (due: number) => schedule({ kind: "news_call", resident_id, call_id, request_kind: kind, due });
  const hour = japanHour(now);
  if (hour < NEWS_FROM || hour >= NEWS_UNTIL) return later(nextMorning(now));
  // On the phone, or in the missed-call steps, whose retry must not find her line busy.
  if ((await callsInProgress(now.getTime(), resident_id)) > 0 || (await getLadder(resident_id))) return later(now.getTime() + WAIT_MS);
  if (!resident.phone) return recordTold(call_id, kind, { at: now.toISOString(), result: "no_phone" });
  // Noted as placed at once, so a lost webhook can't bring a second call; the webhook overwrites it.
  await placeNewsCall(resident, newsText(request, now), { call_id, request_kind: kind }).then(
    () => recordTold(call_id, kind, { at: now.toISOString(), result: "placed" }),
    (e) => {
      console.error(e);
      return recordTold(call_id, kind, { at: now.toISOString(), result: "failed" });
    },
  );
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
export async function checkRequest({ resident_id, call_id: requestId = "", request_kind: kind, round = 1, record: booked, stage }: Pick<Task, "resident_id" | "call_id" | "request_kind" | "round" | "record" | "stage">) {
  const resident = await getResident(resident_id);
  if (!resident || !kind) return;
  // Closed, handled or gone stale: no longer open, so nothing to pass on.
  const open = openRequests(resident, await listCalls(resident_id)).find((r) => r.kind === kind && r.requestId === requestId);
  if (!open || open.status === "accepted") return;
  // Booked for an earlier state of the request: a later call asked again, or it has already moved on.
  // Whatever moved it booked a check of its own.
  if ((booked && booked !== open.callId) || (stage && stage !== open.stage)) return;
  // The person asked has had their time: on to whoever is next. This holds whether or not the
  // coordinators were told on an earlier run of the line: a line started again keeps moving.
  if (round === 1 && !open.exhausted) {
    // Their own "can't come" may be moving it on this instant: only one of the two does.
    if (open.stepDue !== undefined && !(await endTurn(open))) return;
    if (await advance(resident, open.callId, kind, nextFrom(resident, open))) return;
  }
  // From here the coordinators are told, once per request, and only about a line that has run out:
  // a try left over from an earlier run must not speak during someone's turn.
  if (open.escalated || (round > 1 && !open.exhausted)) return;
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
    // Tied to this run of the line: if a later call starts it again, this try says nothing.
    const now = openRequests(resident, await listCalls(resident_id)).find((r) => r.kind === kind && r.requestId === requestId);
    await scheduleCheck(resident_id, requestId, kind, Date.now() + ACK_MS, open.callId, now?.stage ?? open.stage, round + 1);
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
      if (current && who && who.id === current.askedId && canAsk(resident, who)) {
        // The same person hears again. The family was told when a business was first asked: not twice.
        const again = await sendRequest(resident, callId, a, who, current.asked === 0);
        // sent: it reached them on the earlier call
        const kept = { asked: current.asked, asked_id: current.askedId, step_due: current.stepDue, tried: current.tried };
        await record(callId, a.kind, kept, [again], true);
        await scheduleCheck(resident.id, requestId, a.kind, current.stepDue, callId, stageKey(kept));
        return { ...a, sent: true, deliveries: [again] };
      }
      // Someone else is at that place now: they have not been asked. A fresh request to them, with
      // their own time and, for a business, the family told. Otherwise from the top of the line.
      // Someone asked: if they don't take it in time it moves down the line, and at the end of the
      // line the coordinators hear. Reached nobody: they hear now.
      const { deliveries, reached } = await askFrom(resident, callId, a, current && who ? current.asked : 0);
      if (!reached) await checkRequest({ resident_id: resident.id, call_id: requestId, request_kind: a.kind });
      return { ...a, sent: reached, deliveries };
    }),
  );
}
