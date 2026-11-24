import { describe, expect, it } from "vitest";
import { applyRules } from "@/lib/rules";
import type { Signals, Weather } from "@/lib/types";

const none: Signals = {
  emergency: false, self_harm: false, fall_recent: false, pain: false, cant_move: false, snowed_in: false,
  heater_problem: false, not_eating: false, confused: false, money_request: false, low_mood: false,
};
const cold: Weather = { station: "15356", date: "2026-11-26", snowfall_24h_cm: 30, snow_depth_cm: 62, low_c: -12 };
const mild: Weather = { ...cold, low_c: 3 };
const rules = (s: Partial<Signals>, w = cold) => applyRules({ ...none, ...s }, w);

describe("escalation rules", () => {
  it("is green with no actions when nothing is wrong", () => {
    expect(rules({})).toEqual({ risk: "green", reasons: [], actions: [] });
  });

  it("alerts helper and family for an emergency", () => {
    const out = rules({ emergency: true });
    expect(out.risk).toBe("red");
    expect(out.actions).toEqual([{
      type: "alert", to: ["helper", "second_contact"],
      reasonsByRole: { helper: out.reasons, second_contact: out.reasons },
    }]);
  });

  it("treats being unable to move as an emergency", () => {
    expect(rules({ fall_recent: true, cant_move: true }).risk).toBe("red");
  });

  it("alerts only the helper for self-harm words", () => {
    expect(rules({ self_harm: true }).actions).toEqual([{
      type: "alert", to: ["helper"], reasonsByRole: { helper: ["死にたい気持ちの訴え"] },
    }]);
  });

  it("makes a fall red with pain and yellow without", () => {
    expect(rules({ fall_recent: true, pain: true }).risk).toBe("red");
    const noPain = rules({ fall_recent: true });
    expect(noPain.risk).toBe("yellow");
    expect(noPain.actions).toEqual([]);
  });

  it("does not alert for pain on its own", () => {
    expect(rules({ pain: true }).risk).toBe("green");
  });

  it("makes a heater problem red only below freezing", () => {
    expect(rules({ heater_problem: true }, cold).risk).toBe("red");
    expect(rules({ heater_problem: true }, mild).risk).toBe("yellow");
  });

  it("makes a money request red", () => {
    expect(rules({ money_request: true }).risk).toBe("red");
  });

  it("sends a snow request and stays yellow when snowed in", () => {
    const out = rules({ snowed_in: true });
    expect(out.risk).toBe("yellow");
    expect(out.actions).toEqual([{ type: "snow_request", to: ["snow_volunteer"] }]);
  });

  it("makes snowed in with a heater problem red, with both actions", () => {
    const out = rules({ snowed_in: true, heater_problem: true });
    expect(out.risk).toBe("red");
    expect(out.actions.map((a) => a.type)).toEqual(["alert", "snow_request"]);
  });

  it.each(["not_eating", "confused", "low_mood"] as const)("puts %s on the visit list", (signal) => {
    const out = rules({ [signal]: true });
    expect(out.risk).toBe("yellow");
    expect(out.actions).toEqual([]);
  });

  it("covers the demo call: snowed in, slipped, hip hurts", () => {
    const out = rules({ snowed_in: true, fall_recent: true, pain: true });
    expect(out.risk).toBe("red");
    expect(out.reasons).toEqual(["転倒・痛みあり", "雪で玄関から出られない"]);
    expect(out.actions).toEqual([
      { type: "alert", to: ["helper", "second_contact"], reasonsByRole: { helper: out.reasons, second_contact: out.reasons } },
      { type: "snow_request", to: ["snow_volunteer"] },
    ]);
  });
});
