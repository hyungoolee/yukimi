// Help requests: something a call found that one person can come and fix. The agent raises it,
// that person picks half a day, the resident is told on the next call, and the request closes when
// the resident says the problem is gone. One row per kind; the wording is fixed, never generated.
// To add a kind: a row here, the rule that raises it (lib/rules.ts), and a persona in evals/personas.json.
import type { MeasureField } from "./measures.ts";
import { daysBefore, japanDate } from "./trends.ts";
import type { CallRecord, Resident, Role, Slot } from "./types";

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
};

export const REQUESTS = {
  snow: {
    role: "snow_volunteer",
    doneField: "can_get_out",
    label: { ja: "除雪のお願い", en: "Snow clearing" },
    message: (name) => `【除雪のお願い】${name}さん宅の玄関前。雪で外に出られません。行ける時間を押してください。`,
    visit: "雪かきに来る予定",
    check: "雪かきが済んで、玄関から出られるかを聞く。",
  },
  supplies: {
    role: "second_contact",
    doneField: "has_supplies",
    label: { ja: "お届けのお願い", en: "Supplies" },
    message: (name) => `【お届けのお願い】${name}さんが、食料・薬・灯油のどれかが足りないと話しています。何が必要かをご本人に確かめて、届けられる時間を押してください。`,
    visit: "足りないものを届けに来る予定",
    check: "届いて、食料・薬・灯油が足りているかを聞く。",
  },
} as const satisfies Record<string, RequestDef>;

export type RequestKind = keyof typeof REQUESTS;
export const isRequestKind = (kind: string): kind is RequestKind => Object.hasOwn(REQUESTS, kind);

const japanHour = (now: Date) => Number(now.toLocaleTimeString("en-GB", { timeZone: "Asia/Tokyo", hour: "2-digit" }));
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
  /** The call that first asked: what the buttons carry. */
  requestId: string;
  /** The call whose record holds the request now (the newest reminder). */
  callId: string;
  status: "not_sent" | "sent" | "accepted";
  /** Who took it, or else who was asked. */
  who: string;
  slot?: Slot;
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
      return [{
        kind,
        requestId: (action.type === "request" && action.request_id) || call.id,
        callId: call.id,
        status: action.accepted_by !== undefined ? "accepted" as const : action.sent ? "sent" as const : "not_sent" as const,
        who: action.accepted_by || resident[REQUESTS[kind].role].name,
        slot: action.slot,
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
    if (r.status === "sent") return [`・${def.label.ja}：出したが、引き受ける人がまだ決まっていない。そう伝え、来る時間は約束しない。`];
    if (!r.slot) return [`・${def.label.ja}：${r.who}さんが引き受けた。そう伝え、来る時間は約束しない。`];
    const when = slotLabel(r.slot, now);
    return passed(r.slot, now)
      ? [`・${def.label.ja}：${r.who}さんが${when}に${def.visit}だった。${def.check}`]
      : [`・${def.label.ja}：${r.who}さんが${when}に${def.visit}。そう伝える。`];
  });
  return lines.join(" ") || "なし";
}
