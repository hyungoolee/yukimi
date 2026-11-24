import { describe, expect, it } from "vitest";
import { dailyObservations, daysBefore, findTrends, isConcern, lastWeek, withTrends } from "@/lib/trends";
import type { Observations, RulesOutput } from "@/lib/types";

const TODAY = "2026-11-26";
const blank: Observations = { ate: "unknown", slept_well: "unknown", went_out: "unknown", pain_or_injury: "unknown", low_mood: "unknown" };
/** Days ago -> that day's observations, as findTrends wants them (newest first). */
const days = (byAge: Record<number, Partial<Observations>>) =>
  Object.entries(byAge)
    .map(([age, o]) => ({ date: daysBefore(TODAY, Number(age)), observations: { ...blank, ...o } }))
    .sort((a, b) => b.date.localeCompare(a.date));
const notEating = (...ages: number[]) => days(Object.fromEntries(ages.map((a) => [a, { ate: "no" as const }])));

describe("dates", () => {
  it("steps back across a month boundary in Japan time", () => {
    expect(daysBefore("2026-12-01", 1)).toBe("2026-11-30");
    expect(daysBefore(TODAY, 0)).toBe(TODAY);
  });
});

describe("a day's observations", () => {
  const at = (hour: number) => `2026-11-26T${String(hour).padStart(2, "0")}:00:00+09:00`;

  it("merges calls on one day, keeping the latest known value of each field", () => {
    const merged = dailyObservations([
      { at: at(15), observations: { ...blank, slept_well: "yes" } }, // newest: says nothing about meals
      { at: at(9), observations: { ...blank, ate: "no", slept_well: "no" } },
    ]);
    expect(merged).toEqual([{ date: TODAY, observations: { ...blank, ate: "no", slept_well: "yes" } }]);
  });

  it("skips a record whose time can't be read", () => {
    const merged = dailyObservations([{ at: "not a date", observations: { ...blank, ate: "no" } }, { at: at(9), observations: { ...blank, ate: "yes" } }]);
    expect(merged).toEqual([{ date: TODAY, observations: { ...blank, ate: "yes" } }]);
  });

  it("uses the Japan date, and skips records without observations", () => {
    const merged = dailyObservations([
      { at: "2026-11-25T16:30:00Z", observations: { ...blank, ate: "yes" } }, // 01:30 on the 26th in Japan
      { at: "2026-11-25T03:00:00Z" },
      { at: "2026-11-24T03:00:00Z", observations: { ...blank, ate: "no" } },
    ]);
    expect(merged.map((d) => d.date)).toEqual([TODAY, "2026-11-24"]);
  });
});

describe("trend rules", () => {
  it("does nothing for two days of not eating", () => {
    expect(findTrends(notEating(0, 1), TODAY)).toEqual([]);
  });

  it("fires red on the third day running", () => {
    expect(findTrends(notEating(0, 1, 2), TODAY)).toEqual([{ reason: "3日続けて食事をとれていない", risk: "red", fires: true }]);
  });

  it("is ongoing, not firing, on days four and five, and fires again on day six", () => {
    expect(findTrends(notEating(0, 1, 2, 3), TODAY)[0].fires).toBe(false);
    expect(findTrends(notEating(0, 1, 2, 3, 4), TODAY)[0].fires).toBe(false);
    expect(findTrends(notEating(0, 1, 2, 3, 4, 5), TODAY)[0].fires).toBe(true);
  });

  it("skips days when meals did not come up", () => {
    const withGap = days({ 0: { ate: "no" }, 1: {}, 2: { ate: "no" }, 3: { ate: "no" } });
    expect(findTrends(withGap, TODAY)[0]).toMatchObject({ fires: true });
  });

  it("is broken by a day they did eat", () => {
    expect(findTrends(days({ 0: { ate: "no" }, 1: { ate: "yes" }, 2: { ate: "no" }, 3: { ate: "no" } }), TODAY)).toEqual([]);
  });

  it("needs the three days to fall within five", () => {
    expect(findTrends(notEating(0, 1, 4), TODAY)).toHaveLength(1);
    expect(findTrends(notEating(0, 1, 5), TODAY)).toEqual([]);
  });

  it("is not thrown off by one bad day long ago", () => {
    expect(findTrends(notEating(0, 1, 2, 20), TODAY)).toEqual([{ reason: "3日続けて食事をとれていない", risk: "red", fires: true }]);
    expect(findTrends(notEating(0, 1, 2, 6), TODAY)[0].fires).toBe(true); // a 4-day gap ends the run
    expect(findTrends(notEating(0, 1, 2, 5), TODAY)[0].fires).toBe(false); // a 3-day gap doesn't: this is day four
  });

  it("stays ongoing without firing when today's call did not cover meals", () => {
    const todayUnknown = days({ 0: { slept_well: "yes" }, 1: { ate: "no" }, 2: { ate: "no" }, 3: { ate: "no" } });
    expect(findTrends(todayUnknown, TODAY)).toEqual([{ reason: "3日続けて食事をとれていない", risk: "red", fires: false }]);
  });

  it("flags three days of low mood or bad sleep as yellow", () => {
    const low = days({ 0: { low_mood: "yes", slept_well: "no" }, 1: { low_mood: "yes", slept_well: "no" }, 2: { low_mood: "yes", slept_well: "no" } });
    expect(findTrends(low, TODAY)).toEqual([
      { reason: "気分の落ち込みが3日続いている", risk: "yellow", fires: true },
      { reason: "3日続けて眠れていない", risk: "yellow", fires: true },
    ]);
  });

  it("has no rule for pain or staying in, however long", () => {
    const week = days(Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((a) => [a, { pain_or_injury: "yes" as const, went_out: "no" as const }])));
    expect(findTrends(week, TODAY)).toEqual([]);
  });
});

describe("adding trends to today's result", () => {
  const yellow: RulesOutput = { risk: "yellow", reasons: ["食事をとれていない"], actions: [] };

  it("raises to red and alerts helper and family when a red trend fires", () => {
    expect(withTrends(yellow, [{ reason: "3日続けて食事をとれていない", risk: "red", fires: true }])).toEqual({
      risk: "red",
      reasons: ["食事をとれていない", "3日続けて食事をとれていない"],
      actions: [{ type: "alert", to: ["helper", "second_contact"] }],
    });
  });

  it("keeps an ongoing trend at its risk level, without alerting again", () => {
    expect(withTrends(yellow, [{ reason: "3日続けて食事をとれていない", risk: "red", fires: false }])).toEqual({
      risk: "red",
      reasons: ["食事をとれていない", "3日続けて食事をとれていない（継続中）"],
      actions: [],
    });
  });

  it("keeps an existing alert's recipients and other actions, and never lowers the risk", () => {
    const red: RulesOutput = {
      risk: "red", reasons: ["死にたい気持ちの訴え"],
      actions: [{ type: "alert", to: ["helper"] }, { type: "snow_request", to: ["snow_volunteer"] }],
    };
    const out = withTrends(red, [
      { reason: "3日続けて食事をとれていない", risk: "red", fires: true },
      { reason: "3日続けて眠れていない", risk: "yellow", fires: true },
    ]);
    expect(out.risk).toBe("red");
    expect(out.actions).toEqual([
      { type: "alert", to: ["helper", "second_contact"] },
      { type: "snow_request", to: ["snow_volunteer"] },
    ]);
  });
});

describe("the 7-day grid", () => {
  it("lists seven dates ending today, with gaps where there was no call", () => {
    const week = lastWeek(notEating(0, 2), TODAY);
    expect(week.map((d) => d.date)).toEqual(["2026-11-20", "2026-11-21", "2026-11-22", "2026-11-23", "2026-11-24", "2026-11-25", TODAY]);
    expect(week.map((d) => d.observations?.ate)).toEqual([undefined, undefined, undefined, undefined, "no", undefined, "no"]);
  });

  it("knows which answer is the worrying one", () => {
    expect([isConcern("ate", "no"), isConcern("ate", "yes"), isConcern("ate", "unknown")]).toEqual([true, false, false]);
    expect([isConcern("pain_or_injury", "yes"), isConcern("low_mood", "yes"), isConcern("went_out", "no")]).toEqual([true, true, true]);
  });
});
