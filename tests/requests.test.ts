import { describe, expect, it } from "vitest";
import { arranged, helpLine, openRequests, slotChoices, slotLabel } from "@/lib/requests";
import { applyRules, SHORT_OF_SUPPLIES } from "@/lib/rules";
import type { CallRecord, Resident, Signals } from "@/lib/types";

const morning = new Date("2026-11-26T09:30:00+09:00");
const afternoon = new Date("2026-11-26T14:00:00+09:00");
const nextDay = new Date("2026-11-27T09:30:00+09:00");

const sato: Resident = {
  id: "sato", name: "佐藤", phone: "", call_time: "09:00", introducer: "", amedas_station: "15356", facts: [], recent_calls: [],
  helper: { name: "田中" }, second_contact: { name: "ゆき" }, snow_volunteer: { name: "山本" },
};
type Saved = CallRecord["actions"][number];
const request = (kind: "snow" | "supplies", extra: Partial<Saved> = {}): Saved =>
  ({ type: "request", kind, to: [kind === "snow" ? "snow_volunteer" : "second_contact"], sent: true, ...extra }) as Saved;
let n = 0;
/** Each call is newer than the one before; pass them newest first. */
const call = (actions: Saved[], extra: Partial<CallRecord> = {}): CallRecord => ({
  id: `c${++n}`, resident_id: "sato", at: new Date(2026, 10, 26, 9, n).toISOString(), kind: "call", risk: "yellow", reasons: [], actions, ...extra,
});

describe("time slots", () => {
  it("offers the three half-days from the one we are in", () => {
    expect(slotChoices(morning).map((s) => slotLabel(s, morning))).toEqual(["今日の午前", "今日の午後", "明日の午前"]);
    expect(slotChoices(afternoon).map((s) => slotLabel(s, afternoon))).toEqual(["今日の午後", "明日の午前", "明日の午後"]);
  });

  it("names a slot by its date, so it reads right on a later day, and in English", () => {
    const [am] = slotChoices(morning);
    expect(slotLabel(am, nextDay)).toBe("きのうの午前");
    expect(slotLabel(am, morning, "en")).toBe("this morning");
    expect(slotLabel({ date: "2026-12-03", part: "pm" }, morning)).toBe("12月3日の午後");
  });
});

describe("open requests", () => {
  it("is the newest request of each kind, with who was asked or who took it", () => {
    const older = call([request("snow", { sent: false })]);
    const newer = call([request("snow"), request("supplies", { accepted_by: "ゆき", slot: slotChoices(morning)[1] })]);
    // The first person in line, nobody further down, no business waiting on the family.
    const first = { asked: 0, stage: "0:", awaitingConsent: false, business: false };
    expect(openRequests(sato, [newer, older])).toEqual([
      { ...first, kind: "snow", requestId: newer.id, callId: newer.id, since: newer.at, escalated: false, status: "sent", who: "山本", slot: undefined },
      { ...first, kind: "supplies", requestId: newer.id, callId: newer.id, since: newer.at, escalated: false, status: "accepted", who: "ゆき", slot: { date: "2026-11-26", part: "pm" } },
    ]);
    expect(openRequests(sato, [older])[0].status).toBe("not_sent");
  });

  it("has none once the newest is done or its call is handled, and ignores other residents", () => {
    const old = call([request("snow")]);
    expect(openRequests(sato, [call([request("snow", { done: true })]), old])).toEqual([]);
    expect(openRequests(sato, [call([request("snow")], { handled: true }), old])).toEqual([]);
    // "Handled" clears the alert, not a visit someone has promised.
    expect(openRequests(sato, [call([request("snow", { accepted_by: "山本" })], { handled: true })])).toHaveLength(1);
    // Never closed: dropped after three days.
    const stale = call([request("snow")], { at: "2026-11-20T00:00:00.000Z" });
    expect(openRequests(sato, [stale], morning)).toEqual([]);
    expect(openRequests(sato, [call([request("snow")], { resident_id: "suzuki" })])).toEqual([]);
  });

  it("counts as arranged until the half-day is over", () => {
    const [am] = slotChoices(morning);
    const open = (slot?: typeof am) => openRequests(sato, [call([request("snow", { accepted_by: "山本", slot })])])[0];
    expect(arranged(open(am), morning)).toBe(true);
    expect(arranged(open(am), afternoon)).toBe(false);
    expect(arranged(open(), nextDay)).toBe(true); // taken with the old button: no time to be late for
    expect(arranged(openRequests(sato, [call([request("snow")])])[0], morning)).toBe(false);
    expect(arranged(undefined, morning)).toBe(false);
  });
});

describe("what the agent is told about help on its way", () => {
  const [am] = slotChoices(morning);

  it("is なし with nothing open, and when the request reached nobody", () => {
    expect(helpLine(sato, [], morning)).toBe("なし");
    expect(helpLine(sato, [call([request("snow", { sent: false })])], morning)).toBe("なし");
  });

  it("promises no time while nobody has taken it", () => {
    expect(helpLine(sato, [call([request("snow")])], morning)).toBe(
      "・除雪のお願い：出したが、引き受ける人がまだ決まっていない。そう伝え、来る時間は約束しない。",
    );
  });

  it("says who is coming and when, then asks whether it was done once the time has passed", () => {
    const calls = [call([request("snow", { accepted_by: "山本", slot: am }), request("supplies", { accepted_by: "ゆき", slot: am })])];
    expect(helpLine(sato, calls, morning)).toBe(
      "・除雪のお願い：山本さんが今日の午前に雪かきに来る予定。そう伝える。 ・お届けのお願い：ゆきさんが今日の午前に足りないものを届けに来る予定。そう伝える。",
    );
    expect(helpLine(sato, calls, nextDay)).toContain("山本さんがきのうの午前に雪かきに来る予定だった。雪かきが済んで、玄関から出られるかを聞く。");
  });
});

describe("the supplies rule", () => {
  const none = Object.fromEntries(
    ["emergency", "self_harm", "fall_recent", "pain", "cant_move", "snowed_in", "heater_problem", "not_eating", "confused", "money_request", "low_mood"].map((k) => [k, false]),
  ) as Signals;
  const weather = { station: "15356", date: "2026-11-26", snowfall_24h_cm: 30, snow_depth_cm: 62, low_c: -12 };

  it("puts a shortage on the visit list and asks the family, with no alert of its own", () => {
    expect(applyRules(none, weather, [], true)).toEqual({
      risk: "yellow", reasons: [SHORT_OF_SUPPLIES], actions: [{ type: "request", kind: "supplies", to: ["second_contact"] }],
    });
    expect(applyRules(none, weather, [], false).risk).toBe("green");
  });
});
