import { runActions } from "./actions";
import { extract } from "./extract";
import { missed } from "./ladder";
import { curateMemory } from "./memory";
import { applyRules } from "./rules";
import { claimTrendFiring, clearLadder, getResident, listCalls, saveCall, updateResident } from "./store";
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
 * `winterChecks` is whether the agent was told to run the winter checks on this call. It comes from
 * the call itself, not from the weather now, which may have changed or fallen back to saved data.
 */
export async function processCall(
  residentId: string,
  callId: string,
  transcript: Turn[],
  attempt: number | null = 1,
  winterChecks = false,
) {
  const resident = await getResident(residentId);
  if (!resident) throw new Error(`Unknown resident ${residentId}`);

  let extraction: Extraction | undefined;
  let rules: RulesOutput;
  let judged = false; // true only when the rules ran on a real extraction
  try {
    extraction = await extract(resident, transcript);
    rules = applyRules(extraction.signals, await getWeather(resident.amedas_station), winterChecks ? extraction.winter_covered : undefined);
    judged = true;
  } catch (e) {
    console.error("Extraction failed", e);
    rules = needsReview("自動判定に失敗。通話メモを確認してください");
  }

  // Voicemail or someone else picked up: the resident has not been reached.
  if (extraction && !extraction.answered_by_person) return attempt === null ? undefined : missed(residentId, attempt);
  await clearLadder(residentId);

  const now = new Date();
  const at = now.toISOString();
  const today = japanDate(now);
  let alertRisk = rules.risk;
  const claims: (() => Promise<void>)[] = [];
  const releaseClaims = async () => {
    const releases = await Promise.allSettled(claims.map((release) => release()));
    for (const result of releases) {
      if (result.status === "rejected") console.error("Could not release trend firing", result.reason);
    }
    claims.length = 0;
  };

  // Patterns across days. Kept apart from the step above: if this fails, today's call is still judged on its own.
  if (extraction?.observations) {
    try {
      const earlier = (await listCalls(residentId)).filter((c) => c.kind === "call" && c.id !== callId);
      const days = dailyObservations([
        { at, observations: extraction.observations },
        ...earlier.map((c) => ({ at: c.at, observations: c.extraction?.observations })),
      ].sort((a, b) => b.at.localeCompare(a.at)));
      const trends = findTrends(days, today);
      for (const trend of trends) {
        if (!trend.fires) continue;
        const release = await claimTrendFiring(residentId, trend.id, today);
        if (release) claims.push(release);
        else trend.fires = false;
      }
      rules = withTrends(rules, trends);
      if (trends.some((trend) => trend.fires && trend.risk === "red")) alertRisk = "red";
    } catch (e) {
      await releaseClaims();
      console.error("Trend rules failed; using today's call alone", e);
    }
  }

  const actions = await runActions(resident, callId, alertRisk, rules.reasons, rules.actions).catch(async (error) => {
    // A failed schedule is retriable. Once actions finish, keep the claims even if the call record fails to save.
    await releaseClaims();
    throw error;
  });
  await saveCall({
    id: callId,
    resident_id: residentId,
    at,
    kind: "call",
    risk: rules.risk,
    reasons: rules.reasons,
    actions,
    transcript,
    extraction,
  });

  if (extraction) {
    const { summary } = extraction;
    // Applied to the freshest copy: the profile may have changed while the model was working.
    await updateResident(residentId, (fresh) => ({
      ...fresh,
      recent_calls: [{ date: today, summary }, ...fresh.recent_calls].slice(0, 7),
    }));
  }

  // Last, and on its own: the call is already judged, alerted and saved. If curation fails,
  // memory is simply left as it was, and nobody is alerted about it. A call that could not be
  // judged (even one whose extraction worked but whose rules could not run) is left for a person
  // to read, not for memory to learn from.
  if (judged) await curateMemory(residentId, callId, transcript).catch((e) => console.error("Memory curation failed", e));
}
