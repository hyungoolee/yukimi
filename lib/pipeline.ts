import { runActions } from "./actions";
import { extract } from "./extract";
import { missed } from "./ladder";
import { applyRules } from "./rules";
import { clearLadder, getResident, saveCall, saveResident } from "./store";
import type { Extraction, RulesOutput, Turn } from "./types";
import { getWeather } from "./weather";

export const japanDate = (d = new Date()) => d.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });

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
    // Re-read: the profile may have changed while the model was working.
    const fresh = (await getResident(residentId)) ?? resident;
    fresh.recent_calls = [{ date: japanDate(), summary: extraction.summary }, ...fresh.recent_calls].slice(0, 7);
    fresh.facts = [...new Set([...fresh.facts, ...extraction.new_facts])];
    await saveResident(fresh);
  }
}
