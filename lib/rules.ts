import type { Action, Risk, Role, RulesOutput, Signals, Weather } from "./types";

// The escalation table from the PRD, as code. The LLM only supplies the signals.
export function applyRules(s: Signals, weather: Weather): RulesOutput {
  const red: string[] = [];
  const yellow: string[] = [];
  const alertTo = new Set<Role>();
  const actions: Action[] = [];
  const everyone: Role[] = ["helper", "second_contact"];
  const redAlert = (reason: string, to: Role[]) => {
    red.push(reason);
    to.forEach((r) => alertTo.add(r));
  };

  if (s.emergency || s.cant_move) redAlert("緊急の訴え（119番を案内）", everyone);
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
    actions.push({ type: "snow_request", to: ["snow_volunteer"] });
  }
  if (s.not_eating) yellow.push("食事をとれていない");
  if (s.confused) yellow.push("混乱した様子");
  if (s.low_mood) yellow.push("気分の落ち込み");

  const risk: Risk = red.length ? "red" : yellow.length ? "yellow" : "green";
  if (alertTo.size) actions.unshift({ type: "alert", to: [...alertTo] });
  return { risk, reasons: [...red, ...yellow], actions };
}
