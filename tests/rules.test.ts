import { describe, expect, it } from "vitest";
import { applyRules } from "@/lib/rules";
import { MEASURES, unanswered } from "@/lib/measures";
import type { Observations, Signals, Weather } from "@/lib/types";

const none: Signals = {
  emergency: false, self_harm: false, fall_recent: false, pain: false, cant_move: false, snowed_in: false,
  heater_problem: false, not_eating: false, confused: false, money_request: false, low_mood: false,
};
const cold: Weather = { station: "15356", date: "2026-11-26", snowfall_24h_cm: 30, snow_depth_cm: 62, low_c: -12 };
const mild: Weather = { ...cold, low_c: 3 };
const rules = (s: Partial<Signals>, w = cold) => applyRules({ ...none, ...s }, w);

describe("a call that ends before a required question", () => {
  const reason = (labels: string) => `通話が終わる前に確認できなかった：${labels}`;

  it("is yellow and tells the helper which questions went unanswered, in table order", () => {
    expect(applyRules(none, cold, ["has_supplies", "slept_well"])).toEqual({
      risk: "yellow", reasons: [reason("睡眠／食料・薬")],
      actions: [{ type: "alert", to: ["helper"], reasonsByRole: { helper: [reason("睡眠／食料・薬")] } }],
    });
  });

  it("is left alone when nothing went unanswered", () => {
    expect(applyRules(none, cold, []).risk).toBe("green");
    expect(applyRules(none, cold).risk).toBe("green");
  });

  it("adds nothing to a call that is already red", () => {
    const out = applyRules({ ...none, emergency: true }, cold, ["heating_ok", "can_get_out", "has_supplies"]);
    expect(out.reasons).toEqual(["緊急の訴え（119番を案内）"]);
    expect(out.actions).toHaveLength(1);
  });

  it("gives the helper the other yellow reasons too, and puts the alert before a snow request", () => {
    const out = applyRules({ ...none, snowed_in: true }, cold, ["has_supplies"]);
    expect(out.actions.map((a) => a.type)).toEqual(["alert", "request"]);
    expect(out.actions[0]).toMatchObject({ to: ["helper"], reasonsByRole: { helper: ["雪で玄関から出られない", reason("食料・薬")] } });
  });
});

describe("which questions are required", () => {
  const all = Object.fromEntries(MEASURES.map((m) => [m.field, "unknown"])) as Observations;

  it("is sleep on any call, plus heating, the door and supplies when the winter checks were asked for", () => {
    expect(unanswered(all, false)).toEqual(["slept_well"]);
    expect(unanswered(all, true)).toEqual(["slept_well", "heating_ok", "can_get_out", "has_supplies"]);
  });

  it("counts any answer, good or bad, and treats a field missing from an older record as unanswered", () => {
    expect(unanswered({ ...all, slept_well: "no", heating_ok: "no", can_get_out: "yes" }, true)).toEqual(["has_supplies"]);
    expect(unanswered({}, false)).toEqual(["slept_well"]);
  });

  it("has an English form naming the questions", async () => {
    const { reasonText } = await import("@/lib/i18n");
    expect(reasonText("en", "通話が終わる前に確認できなかった：睡眠／食料・薬")).toBe("Not confirmed before the call ended: Sleep, Food and medicine");
  });
});

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
    expect(out.actions).toEqual([{ type: "request", kind: "snow", to: ["snow_helper"] }]);
  });

  it("makes snowed in with a heater problem red, with both actions", () => {
    const out = rules({ snowed_in: true, heater_problem: true });
    expect(out.risk).toBe("red");
    expect(out.actions.map((a) => a.type)).toEqual(["alert", "request"]);
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
      { type: "request", kind: "snow", to: ["snow_helper"] },
    ]);
  });
});
