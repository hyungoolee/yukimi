import { MEASURES, type MeasureField } from "./measures.ts";
import { REQUESTS } from "./requests.ts";
import type { Action, Risk, Role, RulesOutput, Signals, Weather } from "./types";

/** The reason on an alert where the resident was told to phone an ambulance. */
export const EMERGENCY = "緊急の訴え（119番を案内）";
export const SHORT_OF_SUPPLIES = "食料・薬・灯油が足りない";

/** Followed by the labels of the questions that went unanswered. */
export const UNCONFIRMED = "通話が終わる前に確認できなかった：";

// The escalation table from the PRD, as code. The LLM only supplies the signals.
// `unanswered` is the required questions this call ended without an answer to (lib/measures.ts).
// `shortOfSupplies` is the has_supplies answer being "no".
export function applyRules(s: Signals, weather: Weather, unanswered: MeasureField[] = [], shortOfSupplies = false): RulesOutput {
  const red: string[] = [];
  const yellow: string[] = [];
  const alerts = new Map<Role, string[]>();
  const actions: Action[] = [];
  const everyone: Role[] = ["helper", "second_contact"];
  const redAlert = (reason: string, to: Role[]) => {
    red.push(reason);
    for (const role of to) alerts.set(role, [...(alerts.get(role) ?? []), reason]);
  };

  if (s.emergency || s.cant_move) redAlert(EMERGENCY, everyone);
  if (s.self_harm) redAlert("死にたい気持ちの訴え", ["helper"]);
  if (s.fall_recent) {
    if (s.pain) redAlert("転倒・痛みあり", everyone);
    else yellow.push("転倒（痛みなし）");
  }
  if (s.heater_problem) {
    if (weather.low_c < 0) redAlert("暖房が使えない（氷点下）", everyone);
    else yellow.push("暖房の不調");
  }
  if (s.money_request) redAlert("お金を求める電話・訪問があった（詐欺の疑い）", everyone);
  if (s.snowed_in) {
    if (s.heater_problem) redAlert("雪で外に出られない・暖房も使えない", everyone);
    else yellow.push("雪で玄関から出られない");
    actions.push({ type: "request", kind: "snow", to: [REQUESTS.snow.role] });
  }
  if (shortOfSupplies) {
    yellow.push(SHORT_OF_SUPPLIES);
    actions.push({ type: "request", kind: "supplies", to: [REQUESTS.supplies.role] });
  }
  if (s.not_eating) yellow.push("食事をとれていない");
  if (s.confused) yellow.push("混乱した様子");
  if (s.low_mood) yellow.push("気分の落ち込み");

  // Reached, but hung up (or was cut off) before a required question: "no problem heard" is not "fine".
  // The helper is told which. Left out when something red already has people on their way.
  if (!red.length && unanswered.length) {
    const labels = MEASURES.filter((m) => unanswered.includes(m.field)).map((m) => m.label.ja);
    yellow.push(UNCONFIRMED + labels.join("／")); // not 、, which separates reasons in the alert
    alerts.set("helper", []);
  }

  const risk: Risk = red.length ? "red" : yellow.length ? "yellow" : "green";
  if (alerts.size) {
    actions.unshift({
      type: "alert",
      to: [...alerts.keys()],
      reasonsByRole: Object.fromEntries([...alerts].map(([role, reasons]) => [role, [...reasons, ...yellow]])),
    });
  }
  return { risk, reasons: [...red, ...yellow], actions };
}
