import { runActions } from "./actions";
import { extract } from "./extract";
import { missed } from "./ladder";
import { applyRules } from "./rules";
import { clearLadder, getResident, listCalls, saveCall, updateResident } from "./store";
import { dailyObservations, findTrends, japanDate, withTrends } from "./trends";
import type { Extraction, RulesOutput, Turn } from "./types";
import { getWeather } from "./weather";

export { japanDate };

/** A call we could not judge automatically: a person must read it, so the helper is told. */
export const needsReview = (reason: string): RulesOutput => ({
  risk: "yellow",
  reasons: [reason],
  actions: [{ type: "alert", to: ["helper"] }],
});

/**
 * After a finished call: extract, apply the rules, send alerts and requests, update memory.
 * `attempt` is which phone attempt this was, or null for a browser call (which has no ladder).
 */
export async function processCall(residentId: string, callId: string, transcript: Turn[], attempt: number | null = 1) {
  const resident = await getResident(residentId);
  if (!resident) throw new Error(`Unknown resident ${residentId}`);

  let extraction: Extraction | undefined;
  let rules: RulesOutput;
  try {
    extraction = await extract(resident, transcript);
    rules = applyRules(extraction.signals, await getWeather(resident.amedas_station));
  } catch (e) {
    console.error("Extraction failed", e);
    rules = needsReview("自動判定に失敗。通話メモを確認してください");
  }

  // Patterns across days. Kept apart from the step above: if this fails, today's call is still judged on its own.
  if (extraction?.observations && extraction.answered_by_person) {
    try {
      const now = new Date();
      const earlier = (await listCalls(residentId)).filter((c) => c.kind === "call" && c.id !== callId);
      const days = dailyObservations([
        { at: now.toISOString(), observations: extraction.observations },
        ...earlier.map((c) => ({ at: c.at, observations: c.extraction?.observations })),
      ]);
      const today = japanDate(now);
      // A second call on the same day must not send the same trend alert again.
      const raisedToday = new Set(earlier.filter((c) => japanDate(new Date(c.at)) === today).flatMap((c) => c.reasons));
      const trends = findTrends(days, today).map((t) => (raisedToday.has(t.reason) ? { ...t, fires: false } : t));
      rules = withTrends(rules, trends);
    } catch (e) {
      console.error("Trend rules failed; using today's call alone", e);
    }
  }

  // Voicemail or someone else picked up: the resident has not been reached.
  if (extraction && !extraction.answered_by_person) return attempt === null ? undefined : missed(residentId, attempt);
  await clearLadder(residentId);

  await saveCall({
    id: callId,
    resident_id: residentId,
    at: new Date().toISOString(),
    kind: "call",
    risk: rules.risk,
    reasons: rules.reasons,
    actions: await runActions(resident, callId, rules.reasons, rules.actions),
    transcript,
    extraction,
  });

  if (extraction) {
    const { summary, new_facts } = extraction;
    // Applied to the freshest copy: the profile may have changed while the model was working.
    await updateResident(residentId, (fresh) => ({
      ...fresh,
      recent_calls: [{ date: japanDate(), summary }, ...fresh.recent_calls].slice(0, 7),
      facts: [...new Set([...fresh.facts, ...new_facts])],
    }));
  }
}
