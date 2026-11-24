import type { Observations, Risk, Role, RulesOutput, Tri } from "./types";

export const japanDate = (d = new Date()) => d.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });

/** The Japan date `n` days before `date` ("YYYY-MM-DD"). */
export function daysBefore(date: string, n: number) {
  const d = new Date(`${date}T12:00:00+09:00`);
  d.setUTCDate(d.getUTCDate() - n);
  return japanDate(d);
}

export type Day = { date: string; observations: Observations };

const FIELDS = ["ate", "slept_well", "went_out", "pain_or_injury", "low_mood"] as const;

/**
 * One entry per Japan date, newest first, from answered calls (newest first).
 * Within a day each field takes its latest known value, so a short second call that says nothing
 * about meals can't erase the morning's "no".
 */
export function dailyObservations(calls: { at: string; observations?: Observations }[]): Day[] {
  const byDate = new Map<string, Observations>();
  for (const call of calls) {
    if (!call.observations) continue;
    const date = japanDate(new Date(call.at));
    const day = byDate.get(date);
    if (!day) {
      byDate.set(date, { ...call.observations });
      continue;
    }
    for (const field of FIELDS) if (day[field] === "unknown") day[field] = call.observations[field];
  }
  return [...byDate].map(([date, observations]) => ({ date, observations })).sort((a, b) => b.date.localeCompare(a.date));
}

// Starting values, to tune with a 民生委員. Everyone gets the same thresholds: there is no personal baseline yet.
const RULES: { field: keyof Observations; bad: Tri; days: number; within: number; risk: Risk; reason: string }[] = [
  { field: "ate", bad: "no", days: 3, within: 5, risk: "red", reason: "3日続けて食事をとれていない" },
  { field: "low_mood", bad: "yes", days: 3, within: 5, risk: "yellow", reason: "気分の落ち込みが3日続いている" },
  { field: "slept_well", bad: "no", days: 3, within: 5, risk: "yellow", reason: "3日続けて眠れていない" },
];
const RAISE_AGAIN_EVERY = 3;

export type Trend = { reason: string; risk: Risk; fires: boolean };

/**
 * Patterns across days, as of `today`. A streak counts the most recent days with a known answer;
 * unknown days are skipped and the opposite answer ends it.
 * A trend `fires` (raises the risk) on the day it reaches its threshold and every third day after,
 * and only when today's own answer is part of it. In between it is reported as ongoing.
 */
export function findTrends(days: Day[], today: string): Trend[] {
  const trends: Trend[] = [];
  for (const rule of RULES) {
    const known = days.filter((d) => d.date <= today && d.observations[rule.field] !== "unknown");
    const firstOther = known.findIndex((d) => d.observations[rule.field] !== rule.bad);
    const streak = firstOther === -1 ? known.length : firstOther;
    if (streak < rule.days) continue;
    // The days that make up the threshold must be recent, not spread over weeks of missed calls.
    if (known[rule.days - 1].date < daysBefore(today, rule.within - 1)) continue;
    const fires = known[0].date === today && (streak - rule.days) % RAISE_AGAIN_EVERY === 0;
    trends.push({ reason: rule.reason, risk: rule.risk, fires });
  }
  return trends;
}

const RANK: Record<Risk, number> = { green: 0, yellow: 1, red: 2 };

/** Today's single-call result with the trends added. A red trend that fires alerts helper and family. */
export function withTrends(rules: RulesOutput, trends: Trend[]): RulesOutput {
  let risk = rules.risk;
  const reasons = [...rules.reasons];
  let actions = rules.actions;
  for (const trend of trends) {
    reasons.push(trend.fires ? trend.reason : `${trend.reason}（継続中）`);
    if (!trend.fires) continue;
    if (RANK[trend.risk] > RANK[risk]) risk = trend.risk;
    if (trend.risk === "red") {
      const everyone: Role[] = ["helper", "second_contact"];
      const alert = actions.find((a) => a.type === "alert");
      actions = [
        { type: "alert", to: [...new Set([...(alert?.to ?? []), ...everyone])] },
        ...actions.filter((a) => a.type !== "alert"),
      ];
    }
  }
  return { risk, reasons, actions };
}

/** The last 7 Japan dates ending today, newest last, each with that day's observations if there are any. */
export function lastWeek(days: Day[], today: string) {
  return Array.from({ length: 7 }, (_, i) => {
    const date = daysBefore(today, 6 - i);
    return { date, observations: days.find((d) => d.date === date)?.observations };
  });
}

/** Whether a value is the worrying one for its field. */
export const isConcern = (field: keyof Observations, value: Tri) =>
  value !== "unknown" && value === (field === "pain_or_injury" || field === "low_mood" ? "yes" : "no");
