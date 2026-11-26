import { beforeEach, describe, expect, it, vi } from "vitest";
import { runActions } from "@/lib/actions";
import { coverage, criticalCount, reach, served } from "@/lib/coverage";
import { needsReview } from "@/lib/pipeline";
import { applyRules } from "@/lib/rules";
import type { Contact, Resident, Signals, Weather } from "@/lib/types";

const on = (name: string, id = `U_${name}`): Contact => ({ id: name, name, line_id: id });
const off = (name: string): Contact => ({ id: name, name });
const resident = (id: string, extra: Partial<Resident> = {}): Resident => ({
  id, name: id, phone: "+819000000000", call_time: "09:00", introducer: "", amedas_station: "15356", facts: [],
  recent_calls: [], helper: on("tanaka"), second_contact: on(`family-${id}`), snow_helper: on("yamamoto"), ...extra,
});

describe("reach", () => {
  it("tells a vacant post, a name only, and a LINE registration apart", () => {
    expect([reach({ name: "" }), reach(off("a")), reach(on("a"))]).toEqual(["none", "unregistered", "registered"]);
  });
});

describe("coverage", () => {
  it("is ok when everyone is registered", () => {
    expect(coverage(resident("a"))).toEqual({ redAlertReaches: 2, gaps: [], level: "ok" });
  });

  it("is critical when a red alert would reach nobody", () => {
    expect(coverage(resident("a", { helper: off("tanaka"), second_contact: { name: "" } }))).toEqual({
      redAlertReaches: 0, gaps: ["red_reaches_nobody"], level: "critical",
    });
  });

  it("stays critical with only the family registered, since helper-only alerts would reach nobody", () => {
    expect(coverage(resident("a", { helper: off("tanaka") }))).toEqual({
      redAlertReaches: 1, gaps: ["helper_unreachable"], level: "critical",
    });
  });

  it("is a warning with only the helper registered, or with no snow helper", () => {
    expect(coverage(resident("a", { second_contact: off("yuki") }))).toEqual({
      redAlertReaches: 1, gaps: ["family_unreachable"], level: "warning",
    });
    expect(coverage(resident("a", { snow_helper: off("yamamoto") }))).toMatchObject({
      gaps: ["snow_unreachable"], level: "warning",
    });
  });

  it("counts the residents with a critical gap", () => {
    expect(criticalCount([resident("a"), resident("b", { helper: off("x") }), resident("c", { second_contact: off("y") })])).toBe(1);
  });
});

// The rules above are a description of the alert code. This checks the description against the real
// thing, so a later change to who receives an alert can't leave the coverage page wrong with green tests.
describe("coverage agrees with what the alert code sends", () => {
  const none: Signals = {
    emergency: false, self_harm: false, fall_recent: false, pain: false, cant_move: false, snowed_in: false,
    heater_problem: false, not_eating: false, confused: false, money_request: false, low_mood: false,
  };
  const weather: Weather = { station: "15356", date: "2026-11-26", snowfall_24h_cm: 30, snow_depth_cm: 62, low_c: -12 };
  const sent = async (r: Resident, signals: Partial<Signals> | "needs_review") => {
    const rules = signals === "needs_review" ? needsReview("x") : applyRules({ ...none, ...signals }, weather);
    const results = await runActions(r, `c-${Math.random()}`, rules.risk, rules.reasons, rules.actions);
    return Object.fromEntries(results.map((a) => [a.type, a.sent]));
  };

  beforeEach(() => vi.stubGlobal("fetch", vi.fn(async () => new Response("{}"))));

  it.each([
    [true, true], [true, false], [false, true], [false, false],
  ])("helper registered: %s, family registered: %s", async (helper, family) => {
    const r = resident("a", { helper: helper ? on("h") : off("h"), second_contact: family ? on("f") : off("f") });
    const { redAlertReaches, gaps } = coverage(r);
    const helperOnlyReaches = !gaps.includes("red_reaches_nobody") && !gaps.includes("helper_unreachable");

    expect((await sent(r, { emergency: true })).alert).toBe(redAlertReaches > 0);
    expect((await sent(r, { self_harm: true })).alert).toBe(helperOnlyReaches);
    expect((await sent(r, "needs_review")).alert).toBe(helperOnlyReaches);
  });

  it("matches for the snow helper", async () => {
    for (const snow of [on("s"), off("s")]) {
      const r = resident("a", { snow_helper: snow });
      expect((await sent(r, { snowed_in: true })).request).toBe(!coverage(r).gaps.includes("snow_unreachable"));
    }
  });
});

describe("served", () => {
  it("gives the roles a person holds and everyone they serve", () => {
    const all = [resident("a"), resident("b", { helper: off("other") }), resident("c", { snow_helper: { id: "tanaka", name: "tanaka" } })];
    const { roles, residents } = served({ id: "tanaka", name: "tanaka" }, all);
    expect(roles).toEqual(["helper", "snow_helper"]);
    expect(residents.map((r) => r.id)).toEqual(["a", "c"]);
    expect(served({ id: "nobody", name: "x" }, all)).toEqual({ roles: [], residents: [] });
  });
});
