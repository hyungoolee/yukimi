import { describe, expect, it } from "vitest";
import { briefingLine } from "@/lib/briefing";
import { MEASURES } from "@/lib/measures";
import { daysBefore } from "@/lib/trends";
import type { CallRecord, Extraction, Observations } from "@/lib/types";

const TODAY = "2026-11-26";
const blank = Object.fromEntries(MEASURES.map((m) => [m.field, "unknown"])) as Observations;
const call = (daysAgo: number, observations: Partial<Observations>, kind: CallRecord["kind"] = "call"): CallRecord => ({
  id: `c${daysAgo}${kind}`, resident_id: "sato", at: `${daysBefore(TODAY, daysAgo)}T09:00:00+09:00`, kind,
  risk: "green", reasons: [], actions: [],
  extraction: { observations: { ...blank, ...observations } } as Extraction,
});

describe("today's brief", () => {
  it("is なし when there are no calls or nothing is running", () => {
    expect(briefingLine([], TODAY)).toBe("なし");
    expect(briefingLine([call(1, { ate: "no" }), call(2, { ate: "no" })], TODAY)).toBe("なし");
  });

  it("tells the agent about a pattern that was running as of yesterday, before today's call", () => {
    const line = briefingLine([call(1, { ate: "no" }), call(2, { ate: "no" }), call(3, { ate: "no" })], TODAY);
    expect(line).toBe("・食事のことを、いつもよりていねいに聞く。");
  });

  it("lists each running pattern once, in the order of the measures table", () => {
    const bad = { ate: "no", slept_well: "no", low_mood: "yes" } as const;
    const line = briefingLine([call(1, bad), call(2, bad), call(3, bad)], TODAY);
    expect(line.split(" ").map((l) => l.slice(0, 4))).toEqual(["・食事の", "・睡眠の", "・気持ち"]);
  });

  it("drops a pattern once they say they ate, or once it is too old to count", () => {
    expect(briefingLine([call(1, { ate: "yes" }), call(2, { ate: "no" }), call(3, { ate: "no" }), call(4, { ate: "no" })], TODAY)).toBe("なし");
    expect(briefingLine([call(6, { ate: "no" }), call(7, { ate: "no" }), call(8, { ate: "no" })], TODAY)).toBe("なし");
  });

  it("ignores missed calls and records without observations", () => {
    const missed = { ...call(1, { ate: "no" }, "missed") };
    const empty: CallRecord = { ...call(2, {}), extraction: undefined };
    expect(briefingLine([missed, empty, call(3, { ate: "no" }), call(4, { ate: "no" })], TODAY)).toBe("なし");
  });

  it("has fixed wording for every trend: a topic to take care over, never what the resident said", () => {
    for (const m of MEASURES) {
      if (!("trend" in m)) continue;
      expect(m.trend.brief).toMatch(/^[^#{}<>\n]+。$/);
      expect(m.trend.brief).not.toMatch(/話している|とれていない|眠れていない|落ち込/);
    }
  });
});
