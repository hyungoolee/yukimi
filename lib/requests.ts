// Help requests: something a call found that one person can come and fix. The agent raises it,
// that person picks half a day, the resident is phoned with the news (lib/actions.ts newsStep) and told
// again on the next call, and the request closes when
// the resident says the problem is gone. One row per kind; the wording is fixed, never generated.
// To add a kind: a row here, the rule that raises it (lib/rules.ts), and a persona in evals/personas.json.
import type { MeasureField } from "./measures.ts";
import { daysBefore, japanDate } from "./trends.ts";
import type { CallRecord, Contact, RequestState, Resident, Role, Slot, Told } from "./types";

type RequestDef = {
  /** Who is asked. */
  role: Role;
  /** The request closes when a later call answers "yes" to this measure. */
  doneField: MeasureField;
  label: { ja: string; en: string };
  /** The message to the person asked. LINE allows 160 characters with buttons. */
  message: (residentName: string) => string;
  /** How the agent is told to describe the visit: "<name>さんが<when>に" + this. */
  visit: string;
  /** What the agent asks once the time has passed. */
  check: string;
  /** How the resident is told on the news call: "<name>さんが<when>に" + this. */
  news: string;
};

export const REQUESTS = {
  snow: {
    role: "snow_volunteer",
    doneField: "can_get_out",
    label: { ja: "除雪のお願い", en: "Snow clearing" },
    message: (name) => `【除雪のお願い】${name}さん宅の玄関前。雪で外に出られません。行ける時間を押してください。`,
    visit: "雪かきに来る予定",
    check: "雪かきが済んで、玄関から出られるかを聞く。",
    news: "雪かきに伺います",
  },
  supplies: {
    role: "second_contact",
    doneField: "has_supplies",
    label: { ja: "お届けのお願い", en: "Supplies" },
    message: (name) => `【お届けのお願い】${name}さんが、食料・薬・灯油のどれかが足りないと話しています。何が必要かをご本人に確かめて、届けられる時間を押してください。`,
    visit: "足りないものを届けに来る予定",
    check: "届いて、食料・薬・灯油が足りているかを聞く。",
    news: "足りないものを届けに伺います",
  },
} as const satisfies Record<string, RequestDef>;

export type RequestKind = keyof typeof REQUESTS;
export const isRequestKind = (kind: string): kind is RequestKind => Object.hasOwn(REQUESTS, kind);

/**
 * The people who could do this, in the order they are asked. The first is whoever holds the role,
 * even when that post is vacant, so a request that reaches nobody is still recorded against it.
 * Snow clearing can have more people after them, volunteers or businesses (the 連絡体制 page).
 */
export const helpers = (resident: Resident, kind: RequestKind): Contact[] => [
  resident[REQUESTS[kind].role],
  ...(kind === "snow" ? (resident.snow_next ?? []).filter((c) => c.id && c.name) : []),
];

/**
 * Whether this person may be sent a request for this resident. A business may only when it was
 * already marked as one the last time the resident's line was saved: ticking 事業者（有料） on someone
 * who is in a line already must not turn them into paid help for that resident on its own.
 */
export const canAsk = (resident: Resident, who: Contact) =>
  who.kind !== "business" || (!!who.id && (resident.paid_ok ?? []).includes(who.id));

/**
 * A business charges, so the family is told when one is asked. Not for the family's own job
 * (bringing supplies): they would be telling themselves.
 */
export const tellsFamily = (kind: RequestKind, who: Contact) => who.kind === "business" && REQUESTS[kind].role !== "second_contact";

/**
 * Place in line, as a value a booked check carries. A check booked for an earlier one is out of
 * date: the request has moved on since, and whatever moved it booked its own.
 */
export const stageKey = (s: Pick<RequestState, "asked" | "asked_id" | "step_due">) => `${s.asked ?? 0}:${s.asked_id ?? ""}:${s.step_due ?? ""}`;

/**
 * Where in the line to go on from when the person asked has had their turn (or said they can't come):
 * the start of the line as it is now. Everyone already sent the request on this run is skipped there
 * (lib/actions.ts askFrom), so the next person asked is the first one in today's order not yet asked,
 * however the line was edited meanwhile: someone added, removed or moved ahead is not missed.
 */
export function nextFrom(request: Pick<OpenRequest, "asked" | "tried">) {
  // A record from before people were tracked: nobody to skip by name, so on from the old place.
  return request.tried?.length ? 0 : request.asked + 1;
}

/**
 * The half-days a helper is offered. Snow means she can't get out now, so only what is left of today;
 * anyone who can't come today says so, and the request goes on to someone who can.
 */
export function choicesFor(kind: RequestKind, now = new Date()): Slot[] {
  const all = slotChoices(now);
  if (kind !== "snow") return all;
  const today = all.filter((slot) => slot.date === japanDate(now));
  return today.length ? today : all.slice(0, 1);
}

/**
 * Who may answer a request's buttons: whoever holds the role, and anyone further down the line the
 * request has actually been sent to. `calls` are the resident's records.
 */
export function askedHelpers(resident: Resident, calls: CallRecord[], kind: RequestKind, requestId: string): Contact[] {
  const reached = new Set(
    calls.flatMap((c) =>
      c.actions.flatMap((a) =>
        a.type === "request" && a.kind === kind && (a.request_id ?? c.id) === requestId
          ? (a.deliveries ?? []).flatMap((d) => (d.sent && d.person ? [d.person] : []))
          : [],
      ),
    ),
  );
  const [first, ...rest] = helpers(resident, kind);
  return [first, ...rest.filter((c) => reached.has(c.id!))];
}

/** 「山本さん」: some names are saved with their さん already (「隣の高田さん」). */
export const san = (name: string) => (name.endsWith("さん") ? name : `${name}さん`);

export const japanHour = (now: Date) => Number(now.toLocaleTimeString("en-GB", { timeZone: "Asia/Tokyo", hour: "2-digit" }));
const parts = ["am", "pm"] as const;
const index = (slot: Slot) => slot.date + (slot.part === "am" ? "0" : "1"); // sorts in time order

/** The three half-days offered, starting with the one we are in. */
export function slotChoices(now = new Date()): Slot[] {
  const today = japanDate(now);
  const tomorrow = daysBefore(today, -1);
  const all = [today, tomorrow].flatMap((date) => parts.map((part) => ({ date, part })));
  return all.slice(japanHour(now) < 12 ? 0 : 1).slice(0, 3);
}

/** Over: nobody is still on their way. */
export const passed = (slot: Slot, now: Date) =>
  index(slot) < index({ date: japanDate(now), part: japanHour(now) < 12 ? "am" : "pm" });

/** 「今日の午前」. A slot is saved by its date, so a button tapped the next day still means the day it said. */
export function slotLabel(slot: Slot, now = new Date(), lang: "ja" | "en" = "ja") {
  const today = japanDate(now);
  const days = [daysBefore(today, 1), today, daysBefore(today, -1)].indexOf(slot.date);
  if (lang === "en") {
    const day = ["yesterday", "today", "tomorrow"][days] ?? slot.date;
    return `${day} ${slot.part === "am" ? "morning" : "afternoon"}`.replace("today ", "this ");
  }
  const day = ["きのう", "今日", "明日"][days] ?? `${Number(slot.date.slice(5, 7))}月${Number(slot.date.slice(8))}日`;
  return `${day}の${slot.part === "am" ? "午前" : "午後"}`;
}

export type OpenRequest = {
  kind: RequestKind;
  residentId: string;
  /** The call that first asked: what the buttons carry. */
  requestId: string;
  /** The call whose record holds the request now (the newest reminder). */
  callId: string;
  status: "not_sent" | "sent" | "accepted";
  /** When it was first asked (ISO time). */
  since: string;
  /** The coordinators have been told that nobody has taken it. */
  escalated: boolean;
  /** Who took it, or else who is being asked now. */
  who: string;
  /** `who` is a business: named without さん. */
  business: boolean;
  /** How far down the line the request has got (0: the first person). */
  asked: number;
  /** The person who was at that place when they were asked: whoever is there now may be someone else. */
  askedId?: string;
  /** Everyone in line has had their turn (or could not be asked) and nobody took it. `who` is then empty. */
  exhausted: boolean;
  /** When whoever is being asked now runs out of time (epoch ms). Absent on requests from before this was kept. */
  stepDue?: number;
  /** Everyone sent this request on this run of the line, by person id. */
  tried?: string[];
  /** See stageKey. */
  stage: string;
  slot?: Slot;
  acceptedAt?: string;
  told?: Told;
};

// A request nobody closed stops being talked about after this long: the questions that close it are
// only required on winter-check mornings.
const STALE_MS = 3 * 24 * 60 * 60_000;

/**
 * The resident's open requests, at most one per kind: the newest one, unless it is done, has gone
 * stale, or its call was marked handled before anyone took it. `calls` must be newest first.
 */
export function openRequests(resident: Resident, calls: CallRecord[], now = new Date()): OpenRequest[] {
  return (Object.keys(REQUESTS) as RequestKind[]).flatMap((kind) => {
    for (const call of calls) {
      if (call.resident_id !== resident.id) continue;
      const action = call.actions.find((a) => a.type === "request" && a.kind === kind);
      if (!action) continue;
      // "Handled" is about the alert. Someone who has said they are coming is still coming.
      if (action.done || (call.handled && action.accepted_by === undefined)) return [];
      if (now.getTime() - new Date(call.at).getTime() > STALE_MS) return [];
      const requestId = (action.type === "request" && action.request_id) || call.id;
      // A reminder is a fresh record, so these two are read from every record of the same request.
      const records = calls.flatMap((c) =>
        c.actions.filter((a) => a.type === "request" && a.kind === kind && (a.request_id ?? c.id) === requestId).map((a) => ({ at: c.at, a })),
      );
      const asked = action.asked ?? 0;
      const line = helpers(resident, kind);
      // Who has it: found by who they are, since the line may have been edited during their turn.
      const current = action.asked_id ? line.find((c) => c.id === action.asked_id) : line[asked];
      // The line has run out only when the record says so, not when an edit has left the old place
      // empty: then the request goes on to whoever in today's line is not yet asked.
      // (A record from before turns were tracked: run out when nobody holds the role.)
      const tracked = action.asked !== undefined || action.asked_id !== undefined || action.ended !== undefined;
      const exhausted = action.accepted_by === undefined && (tracked ? action.ended === true : !current);
      return [{
        residentId: resident.id,
        kind,
        requestId,
        callId: call.id,
        asked,
        askedId: action.asked_id,
        exhausted,
        stage: stageKey(action),
        stepDue: action.step_due,
        tried: action.tried,
        business: action.accepted_by !== undefined ? !!action.accepted_business : current?.kind === "business",
        since: records.at(-1)?.at ?? call.at,
        escalated: records.some((r) => r.a.escalated_at),
        status: action.accepted_by !== undefined ? "accepted" as const : action.sent ? "sent" as const : "not_sent" as const,
        who: action.accepted_by || current?.name || "",
        slot: action.slot,
        acceptedAt: action.accepted_at,
        told: action.told,
      }];
    }
    return [];
  });
}

/** Someone has said when they will come, and that time is not over: asking again would be a second message for the same job. */
export const arranged = (request: OpenRequest | undefined, now = new Date()) =>
  !!request && request.status === "accepted" && (!request.slot || !passed(request.slot, now));

/**
 * What the agent is told about help that is on its way: one fixed line per open request, 「なし」 when
 * there is none. A request that reached nobody is left out: the agent must not say someone was asked.
 */
export function helpLine(resident: Resident, calls: CallRecord[], now = new Date()) {
  const lines = openRequests(resident, calls, now).flatMap((r) => {
    const def = REQUESTS[r.kind];
    if (r.status === "not_sent") return [];
    if (r.status === "sent") return [`・${def.label.ja}：出したが、引き受ける人がまだ決まっていない。そう伝え、来る時間は約束しない。時間が決まったら電話で知らせると伝える。`];
    const who = r.business ? r.who : san(r.who); // a business is named as it is
    if (!r.slot) return [`・${def.label.ja}：${who}が引き受けた。そう伝え、来る時間は約束しない。`];
    const when = slotLabel(r.slot, now);
    return passed(r.slot, now)
      ? [`・${def.label.ja}：${who}が${when}に${def.visit}だった。${def.check}`]
      : [`・${def.label.ja}：${who}が${when}に${def.visit}。そう伝える。`];
  });
  return lines.join(" ") || "なし";
}
