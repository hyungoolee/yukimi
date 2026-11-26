import { runActions } from "./actions";
import { extract } from "./extract";
import { missed } from "./ladder";
import { curateMemory } from "./memory";
import { unanswered } from "./measures";
import { arranged, openRequests, REQUESTS } from "./requests";
import { applyRules } from "./rules";
import { claimTrendFiring, clearLadder, getCall, getResident, listCalls, saveCall, updateCall, updateResident } from "./store";
import { dailyObservations, findTrends, japanDate, withTrends } from "./trends";
import type { Action, Extraction, RulesOutput, Turn } from "./types";
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
  // The same call reported twice must not send its messages again, or overwrite a visit someone has accepted since.
  if (await getCall(callId)) return;

  let extraction: Extraction | undefined;
  let rules: RulesOutput;
  let judged = false; // true only when the rules ran on a real extraction
  try {
    extraction = await extract(resident, transcript);
    // A question an earlier call today already answered is not unanswered: a short second call is fine.
    const earlier = (await listCalls(residentId).catch(() => [])).filter((c) => c.kind === "call" && c.id !== callId);
    const [today] = dailyObservations([
      { at: new Date().toISOString(), observations: extraction.observations },
      ...earlier.map((c) => ({ at: c.at, observations: c.extraction?.observations })),
    ]);
    rules = applyRules(
      extraction.signals,
      await getWeather(resident.amedas_station),
      unanswered(today?.observations ?? {}, winterChecks),
      extraction.observations?.has_supplies === "no",
    );
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

  // Help already asked for (lib/requests.ts). Kept apart like the trends: if it fails, the call is still judged and sent.
  try {
    const open = openRequests(resident, (await listCalls(residentId)).filter((c) => c.id !== callId));
    for (const request of open) {
      // The resident says the problem is gone: the request is closed.
      if (extraction?.observations?.[REQUESTS[request.kind].doneField] !== "yes") continue;
      await updateCall(request.callId, (c) => ({
        actions: c.actions.map((a) => (a.type === "request" && a.kind === request.kind ? { ...a, done: true } : a)),
      }));
    }
    rules = {
      ...rules,
      actions: rules.actions.flatMap((a): Action[] => {
        if (a.type !== "request") return [a];
        const current = open.find((r) => r.kind === a.kind);
        // Someone is already coming for it: no second message for the same job.
        if (arranged(current, now)) return [];
        // Still open and nobody took it: this is a reminder of the same request.
        const needs = a.kind === "supplies" ? extraction?.notes.needs : undefined;
        return [{ ...a, request_id: current?.requestId ?? callId, ...(needs?.length ? { needs } : {}) }];
      }),
    };
  } catch (e) {
    console.error("Could not read open help requests", e);
  }

  // Saved before anything is sent: a request's buttons can be tapped the moment LINE delivers them.
  await saveCall({
    id: callId,
    resident_id: residentId,
    at,
    kind: "call",
    risk: rules.risk,
    reasons: rules.reasons,
    actions: rules.actions.map((a) => ({ ...a, sent: false })),
    transcript,
    extraction,
  });
  const results = await runActions(resident, callId, alertRisk, rules.reasons, rules.actions).catch(async (error) => {
    await releaseClaims();
    throw error;
  });
  // Only what was sent is added, so an answer that arrived meanwhile is kept. A request records its
  // own messages as each goes out (lib/actions.ts), so its buttons work at once: those are kept as they are.
  await updateCall(callId, (c) => ({
    actions: c.actions.map((a, i) => ({
      ...a,
      sent: results[i].sent,
      deliveries: a.type === "request" && a.deliveries?.length ? a.deliveries : results[i].deliveries,
    })),
  }));

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
