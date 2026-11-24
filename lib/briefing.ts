import { MEASURES } from "./measures.ts";
import { dailyObservations, findTrends, japanDate } from "./trends";
import type { CallRecord } from "./types";

/**
 * Today's brief for the agent: one fixed line per pattern that is running across recent days, so the
 * agent can ask about it gently. Composed by code from the call records; no model writes it.
 * Follow-ups and care notes reach the agent as their own variables. 「なし」 when nothing is running.
 */
export function briefingLine(calls: CallRecord[], today = japanDate()) {
  const days = dailyObservations(
    calls.filter((c) => c.kind === "call").map((c) => ({ at: c.at, observations: c.extraction?.observations })),
  );
  const running = new Set(findTrends(days, today).map((t) => t.id));
  const lines = MEASURES.flatMap((m) => ("trend" in m && running.has(m.trend.id) ? [`・${m.trend.brief}`] : []));
  return lines.join(" ") || "なし";
}
