import { placeNewsCall } from "./elevenlabs";
import { randomUUID } from "node:crypto";
import { DEMO_MODE } from "./env";
import { buttons, push, text } from "./line";
import { EMERGENCY } from "./rules";
import { canAsk, choicesFor, helpers, japanHour, openRequests, passed, REQUESTS, san, slotLabel, stageKey, tellsFamily, turnToken, type OpenRequest, type RequestKind } from "./requests";
import { callsInProgress, getCall, getLadder, getPerson, getResident, listCalls, listPeople, schedule, updateCall, type Task } from "./store";
import type { Action, AlertReasons, Contact, Delivery, RequestRun, Resident, Risk, Role, Slot, Told } from "./types";

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

/** Asks one person for this kind of help, with a button for each half-day they could come, and one to say no. */
async function sendRequest(resident: Resident, callId: string, request: RequestAction, who: Contact, token: string): Promise<Delivery> {
  const { kind, request_id: id = callId } = request;
  const body = REQUESTS[kind].message(resident.name);
  const choices = [
    ...choicesFor(kind).map((slot) => ({ label: slotLabel(slot), data: `accept:${id}:${kind}:${slot.date}:${slot.part}` })),
    // Saying no at once hands it to the next person, instead of leaving it with them until their time runs out.
    // It carries the run and the turn: a card from another turn or run does nothing (lib/requests.ts turnToken).
    { label: CANT_COME, data: `decline:${id}:${kind}:${token}` },
  ];
  const button = choices.map((c) => c.label).join(" / ");
  // What she said she needs, so the person knows what to bring. Call notes, not fixed wording: marked as such.
  const needs = request.needs?.length ? `通話メモより：${request.needs.join("、").slice(0, 300)}` : "";
  const messages = [...(needs ? [text(needs)] : []), buttons(body, choices)];
  // Recorded by person and name: the role alone would point at whoever holds it now.
  return deliver(resident, REQUESTS[kind].role, [needs, body].filter(Boolean).join("\n"), messages, { button, person: who.id, name: who.name }, who);
}

/**
 * Tells the family that a business, which charges, has been asked. They are told, not asked: putting
 * the business in this resident's line (the 連絡体制 page) is the agreement. The price is between the two of them.
 */
function tellFamily(resident: Resident, kind: RequestKind, business: Contact): Promise<Delivery> {
  const body = `【有料の${REQUESTS[kind].label.ja}】${resident.name}さんの件で、${business.name}（有料）にお願いしました。費用は先方と直接ご相談ください。`;
  return deliver(resident, "second_contact", body, [text(body)], {});
}

/** How long each person has before the request moves on. One person in line: as it always was. */
const waitFor = (run: RequestRun) => (run.line.length > 1 ? STEP_WAIT_MS : REQUEST_WAIT_MS);

/** Adds to a request's record: its run, and any messages that went out. */
const record = (callId: string, kind: RequestKind, patch: { run?: RequestRun }, sent: Delivery[] = [], reached = false) =>
  updateCall(callId, (c) => ({
    actions: c.actions.map((a) =>
      isRequest(kind)(a) ? { ...a, ...patch, sent: a.sent || reached, deliveries: sent.length ? [...(a.deliveries ?? []), ...sent] : a.deliveries } : a,
    ),
  }));

/** A person in a run's line, as they are now: from the resident's contacts, else their own record. Null if gone. */
async function contactFor(resident: Resident, kind: RequestKind, id: string): Promise<Contact | null> {
  return helpers(resident, kind).find((c) => c.id === id) ?? (await getPerson(id));
}

/** A new run: the line as it stands now, fixed for the run. Everyone in it with a saved person record. */
const newRun = (resident: Resident, kind: RequestKind): RequestRun => ({
  id: randomUUID().slice(0, 8),
  line: helpers(resident, kind).flatMap((c) => (c.id && c.name ? [{ id: c.id, name: c.name, ...(c.kind === "business" ? { business: true } : {}) }] : [])),
  at: 0,
});

/**
 * Gives the turn to the person at `from` in the run's line, or the first after them who can be asked
 * and reached, and books the check on them. Someone no longer on file, or a business not agreed for
 * this resident (canAsk), is passed over. The turn is on the record before anything else is sent, so
 * their buttons work as soon as the message arrives; then, for a business, the family is told.
 * Not reached: the run has run out, the record says so, and the coordinators are the ones to tell.
 */
async function askFrom(resident: Resident, runCallId: string, request: RequestAction, run: RequestRun, from: number) {
  const { kind } = request;
  const requestId = request.request_id ?? runCallId;
  const deliveries: Delivery[] = [];
  for (let at = from; at < run.line.length; at++) {
    const who = await contactFor(resident, kind, run.line[at].id);
    if (!who || !canAsk(resident, who)) continue;
    const turn: RequestRun = { ...run, at, due: Date.now() + waitFor(run), ending: false };
    const asked = await sendRequest(resident, runCallId, request, who, turnToken(turn));
    deliveries.push(asked);
    if (!asked.sent) continue;
    await record(runCallId, kind, { run: turn }, [asked], true);
    await scheduleCheck(resident.id, requestId, kind, turn.due!, runCallId, stageKey(turn));
    if (tellsFamily(kind, who)) await record(runCallId, kind, {}, [await tellFamily(resident, kind, who)]);
    return { deliveries, reached: true };
  }
  await record(runCallId, kind, { run: { ...run, at: run.line.length, due: undefined, ending: false } }, deliveries.filter((d) => !d.sent));
  return { deliveries, reached: false };
}

/**
 * Ends the turn of whoever has the request now, so the next person can be asked: their time ran out,
 * or they tapped 行けません. Exactly one of those two ends a turn, and only if it is still the turn
 * `open` describes. False when it has already ended or changed.
 *
 * The step that asks the next person is booked first, as a task due now, and only then is the turn
 * marked as ending. So a stop at any point leaves it runnable: before the mark, the turn's own
 * timeout still stands and the booked step does nothing; after it, the booked step finds the turn
 * ending and asks the next person (checkRequest).
 */
export async function handOff(open: OpenRequest) {
  const run = open.run;
  if (!run || run.ending || open.exhausted) return false;
  const isIt = isRequest(open.kind);
  const ending = { ...run, ending: true };
  await scheduleCheck(open.residentId, open.requestId, open.kind, Date.now(), open.runCallId, stageKey(ending));
  return !!(await updateCall(open.runCallId, (c) => {
    const a = c.actions.find(isIt);
    // Already ended by the other of the two, or the run has moved on: nothing to do here.
    if (!a || a.type !== "request" || stageKey(a.run) !== stageKey(run)) return null;
    return { actions: c.actions.map((x) => (isIt(x) ? { ...x, run: ending } : x)) };
  }));
}

/**
 * The person asked tapped 行けません on the card for `token`'s turn. Ends their turn; the step booked by
 * handOff asks the next person, or tells the coordinators if there is nobody (the caller runs it at
 * once: lib/tick.ts runDueTasksNow). False when that turn is over (someone took it, it has moved on,
 * or the card is from an earlier run).
 */
export async function declineRequest(open: OpenRequest, token: string) {
  if (open.status !== "sent" || !open.run || turnToken(open.run) !== token) return false;
  return handOff(open);
}

/**
 * Starts the request's line again from the top, as the line stands now: for a coordinator who has
 * changed who is in line and wants it to count for a request already under way. Any turn in progress
 * ends; its buttons and its check do nothing after this. False when there is nothing to restart.
 */
export async function restartRequest(residentId: string, kind: RequestKind) {
  const resident = await getResident(residentId);
  const open = resident && openRequests(resident, await listCalls(residentId)).find((r) => r.kind === kind);
  if (!resident || !open || open.status === "accepted") return false;
  const request = (await getCall(open.callId))?.actions.find(isRequest(kind)) as RequestAction | undefined;
  if (!request) return false;
  const { reached } = await askFrom(resident, open.callId, request, newRun(resident, kind), 0);
  if (!reached) await checkRequest({ resident_id: residentId, call_id: open.requestId, request_kind: kind });
  return true;
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
  // Booked for another state of the run, or for another run: whatever moved it booked a check of its own.
  if ((booked && booked !== open.runCallId) || (stage !== undefined && stage !== open.stage)) return;
  // The person asked has had their time, or their turn was ended (handOff): on to the next in this
  // run's line. This holds whether or not the coordinators were told on an earlier run.
  if (round === 1 && open.run && !open.exhausted) {
    // Their time ran out: end the turn. If their own "can't come" ended it first, its booked step goes on.
    if (!open.run.ending && !(await handOff(open))) return;
    const request = (await getCall(open.runCallId))?.actions.find(isRequest(kind)) as RequestAction | undefined;
    if (request && (await askFrom(resident, open.runCallId, request, open.run, open.run.at + 1)).reached) return;
  }
  // From here the coordinators are told, once per request, and only about a line that has run out:
  // a try left over from an earlier run must not speak during someone's turn.
  // (A record from before runs had one turn, so it has run out once that turn's check comes due.)
  if (open.escalated || (round > 1 && open.run && !open.exhausted)) return;
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
    // Tied to this run of the line: if a later call or a restart starts another, this try says nothing.
    const now = openRequests(resident, await listCalls(resident_id)).find((r) => r.kind === kind && r.requestId === requestId);
    await scheduleCheck(resident_id, requestId, kind, Date.now() + ACK_MS, now?.runCallId ?? open.runCallId, now?.stage ?? open.stage, round + 1);
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
      // A reminder: the same request raised again on a later call. Where its run stands, on the earlier records.
      const earlier = requestId === callId ? undefined
        : openRequests(resident, (await listCalls(resident.id)).filter((c) => c.id !== callId)).find((r) => r.kind === a.kind && r.requestId === requestId);
      if (earlier?.run && !earlier.exhausted && earlier.status === "sent") {
        // Still with someone: it stays with them, on the run's own record, with their time unchanged.
        // They hear again, with the same buttons; the family was told when a business was first asked.
        // A turn already ending is left to its booked step.
        const who = earlier.run.ending ? null : await contactFor(resident, a.kind, earlier.run.line[earlier.run.at].id);
        const again = who && canAsk(resident, who) ? [await sendRequest(resident, callId, a, who, turnToken(earlier.run))] : [];
        return { ...a, sent: true, deliveries: again }; // sent: it reached them on the earlier call
      }
      // A new request, or the last run ran out: a new run from the top of the line as it is now.
      // Someone asked: if they don't take it in time it moves down the line, and at the end of the
      // line the coordinators hear (once per request). Reached nobody: they hear now.
      const { deliveries, reached } = await askFrom(resident, callId, a, newRun(resident, a.kind), 0);
      if (!reached) await checkRequest({ resident_id: resident.id, call_id: requestId, request_kind: a.kind });
      return { ...a, sent: reached, deliveries };
    }),
  );
}
