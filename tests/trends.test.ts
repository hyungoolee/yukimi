import { describe, expect, it } from "vitest";
import { isConcern, MEASURES } from "@/lib/measures";
import { dailyObservations, daysBefore, findTrends, lastWeek, withTrends } from "@/lib/trends";
import type { Observations, RulesOutput } from "@/lib/types";

const TODAY = "2026-11-26";
const mealTrend = { id: "not_eating", reason: "3日続けて食事をとれていない", risk: "red" } as const;
const blank = Object.fromEntries(MEASURES.map((m) => [m.field, "unknown"])) as Observations;
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
    expect(findTrends(notEating(0, 1, 2), TODAY)).toEqual([{ ...mealTrend, fires: true }]);
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
    expect(findTrends(notEating(0, 1, 2, 20), TODAY)).toEqual([{ ...mealTrend, fires: true }]);
    expect(findTrends(notEating(0, 1, 2, 6), TODAY)[0].fires).toBe(true); // a 4-day gap ends the run
    expect(findTrends(notEating(0, 1, 2, 5), TODAY)[0].fires).toBe(false); // a 3-day gap doesn't: this is day four
  });

  it("starts the cadence on the first qualifying day even when older gaps are individually short", () => {
    expect(findTrends(notEating(0, 1, 4, 7), TODAY)).toEqual([{ ...mealTrend, fires: true }]);
    expect(findTrends(notEating(0, 1, 2, 3, 4, 7, 10), TODAY)).toEqual([{ ...mealTrend, fires: true }]);
  });

  it("stays ongoing without firing when today's call did not cover meals", () => {
    const todayUnknown = days({ 0: { slept_well: "yes" }, 1: { ate: "no" }, 2: { ate: "no" }, 3: { ate: "no" } });
    expect(findTrends(todayUnknown, TODAY)).toEqual([{ ...mealTrend, fires: false }]);
  });

  it("flags three days of low mood or bad sleep as yellow", () => {
    const low = days({ 0: { low_mood: "yes", slept_well: "no" }, 1: { low_mood: "yes", slept_well: "no" }, 2: { low_mood: "yes", slept_well: "no" } });
    expect(findTrends(low, TODAY)).toEqual([
      { id: "poor_sleep", reason: "3日続けて眠れていない", risk: "yellow", fires: true },
      { id: "low_mood", reason: "気分の落ち込みが3日続いている", risk: "yellow", fires: true },
    ]); // in the order of the measures table
  });

  it("has no rule for pain or staying in, however long", () => {
    const week = days(Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((a) => [a, { pain_or_injury: "yes" as const, went_out: "no" as const }])));
    expect(findTrends(week, TODAY)).toEqual([]);
  });
});

describe("adding trends to today's result", () => {
  const yellow: RulesOutput = { risk: "yellow", reasons: ["食事をとれていない"], actions: [] };

  it("raises to red and alerts helper and family when a red trend fires", () => {
    expect(withTrends(yellow, [{ ...mealTrend, fires: true }])).toEqual({
      risk: "red",
      reasons: ["食事をとれていない", "3日続けて食事をとれていない"],
      actions: [{
        type: "alert", to: ["helper", "second_contact"],
        reasonsByRole: { helper: [mealTrend.reason], second_contact: [mealTrend.reason] },
      }],
    });
  });

  it("keeps an ongoing trend at its risk level, without alerting again", () => {
    expect(withTrends(yellow, [{ ...mealTrend, fires: false }])).toEqual({
      risk: "red",
      reasons: ["食事をとれていない", "3日続けて食事をとれていない（継続中）"],
      actions: [],
    });
  });

  it("keeps an acute reason with its recipient when the trend adds recipients", () => {
    const red: RulesOutput = {
      risk: "red", reasons: ["死にたい気持ちの訴え"],
      actions: [{ type: "alert", to: ["helper"] }, { type: "request", kind: "snow", to: ["snow_helper"] }],
    };
    const out = withTrends(red, [
      { ...mealTrend, fires: true },
      { id: "poor_sleep", reason: "3日続けて眠れていない", risk: "yellow", fires: true },
    ]);
    expect(out.risk).toBe("red");
    expect(out.actions).toEqual([
      {
        type: "alert", to: ["helper", "second_contact"],
        reasonsByRole: { helper: ["死にたい気持ちの訴え", mealTrend.reason], second_contact: [mealTrend.reason] },
      },
      { type: "request", kind: "snow", to: ["snow_helper"] },
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

describe("the measures table", () => {
  it("drives the extraction: the schema requires exactly one tri-state field per measure", async () => {
    const { ExtractionSchema } = await import("@/lib/extract");
    const observations = ExtractionSchema.shape.observations;
    const all = Object.fromEntries(MEASURES.map((m) => [m.field, "unknown"]));
    expect(observations.parse(all)).toEqual(all);
    for (const m of MEASURES) {
      const missingOne = Object.fromEntries(Object.entries(all).filter(([field]) => field !== m.field));
      expect(observations.safeParse(missingOne).success).toBe(false);
      expect(observations.safeParse({ ...all, [m.field]: "maybe" }).success).toBe(false);
      expect(m.ask.startsWith(m.field)).toBe(true);
    }
  });

  it("gives every trend an English reason, and every measure both labels", async () => {
    const { reasonText } = await import("@/lib/i18n");
    for (const m of MEASURES) {
      expect(m.label.ja && m.label.en).toBeTruthy();
      if ("trend" in m) expect(reasonText("en", `${m.trend.reason}（継続中）`)).toBe(`${m.trend.reasonEn} (ongoing)`);
    }
    expect(reasonText("en", "気分の落ち込み")).toBe("Low mood");
  });
});
