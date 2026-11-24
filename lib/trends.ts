import { MEASURES } from "./measures.ts";
import type { AlertReasons, Observations, Risk, Role, RulesOutput } from "./types";

export const japanDate = (d = new Date()) => d.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });

/** The Japan date `n` days before `date` ("YYYY-MM-DD"). */
export function daysBefore(date: string, n: number) {
  const d = new Date(`${date}T12:00:00+09:00`);
  d.setUTCDate(d.getUTCDate() - n);
  return japanDate(d);
}

export type Day = { date: string; observations: Observations };


/**
 * One entry per Japan date, newest first, from answered calls (newest first).
 * Within a day each field takes its latest known value, so a short second call that says nothing
 * about meals can't erase the morning's "no".
 */
export function dailyObservations(calls: { at: string; observations?: Observations }[]): Day[] {
  const byDate = new Map<string, Observations>();
  for (const call of calls) {
    // A record with an unreadable time is skipped, not allowed to break everyone's trends.
    const at = new Date(call.at);
    if (!call.observations || Number.isNaN(at.getTime())) continue;
    const date = japanDate(at);
    const day = byDate.get(date);
    if (!day) {
      byDate.set(date, { ...call.observations });
      continue;
    }
    for (const { field } of MEASURES) if ((day[field] ?? "unknown") === "unknown") day[field] = call.observations[field] ?? "unknown";
  }
  return [...byDate].map(([date, observations]) => ({ date, observations })).sort((a, b) => b.date.localeCompare(a.date));
}

// The measures that have a pattern across days (lib/measures.ts).
const RULES = MEASURES.flatMap((m) => ("trend" in m ? [{ field: m.field, bad: m.concern, ...m.trend }] : []));
const RAISE_AGAIN_EVERY = 3;

export type Trend = { id: string; reason: string; risk: Risk; fires: boolean };

/**
 * A trend fires on the first eligible day and every third qualifying observation day thereafter.
 * A positive answer or expiry of the qualifying window ends the episode. Unknowns add no days.
 */
export function findTrends(days: Day[], today: string): Trend[] {
  const trends: Trend[] = [];
  const history = days.filter((day) => day.date <= today).reverse();
  for (const rule of RULES) {
    const recent: string[] = [];
    let qualifyingDays = 0;
    for (const { date, observations } of history) {
      const value = observations[rule.field];
      if (value === "unknown") continue;
      if (value !== rule.bad) {
        recent.length = 0;
        qualifyingDays = 0;
        continue;
      }

      // Check whether the previous window had already expired the day before this observation.
      if (qualifyingDays && recent[0] < daysBefore(date, rule.within)) qualifyingDays = 0;
      recent.push(date);
      if (recent.length > rule.days) recent.shift();
      const qualifies = recent.length === rule.days && recent[0] >= daysBefore(date, rule.within - 1);
      qualifyingDays = qualifies ? qualifyingDays + 1 : 0;
    }
    if (!qualifyingDays || recent[0] < daysBefore(today, rule.within - 1)) continue;
    const fires = recent.at(-1) === today && (qualifyingDays - 1) % RAISE_AGAIN_EVERY === 0;
    trends.push({ id: rule.id, reason: rule.reason, risk: rule.risk, fires });
  }
  return trends;
}

const RANK: Record<Risk, number> = { green: 0, yellow: 1, red: 2 };

/**
 * Today's single-call result with the trends added. An active trend sets the risk for as long as it
 * lasts, so the resident stays at the top of the list; the alert to helper and family goes out only
 * when a red trend fires.
 */
export function withTrends(rules: RulesOutput, trends: Trend[]): RulesOutput {
  let risk = rules.risk;
  const reasons = [...rules.reasons];
  let actions = rules.actions;
  for (const trend of trends) {
    reasons.push(trend.fires ? trend.reason : `${trend.reason}（継続中）`);
    if (RANK[trend.risk] > RANK[risk]) risk = trend.risk;
    if (trend.fires && trend.risk === "red") {
      const everyone: Role[] = ["helper", "second_contact"];
      const alert = actions.find((a) => a.type === "alert");
      const acuteReasons = alert?.reasonsByRole ?? Object.fromEntries((alert?.to ?? []).map((role) => [role, rules.reasons]));
      const reasonsByRole: AlertReasons = { ...acuteReasons };
      for (const role of everyone) reasonsByRole[role] = [...(reasonsByRole[role] ?? []), trend.reason];
      actions = [
        { type: "alert", to: [...new Set([...(alert?.to ?? []), ...everyone])], reasonsByRole },
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
