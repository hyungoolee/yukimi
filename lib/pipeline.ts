import { runActions } from "./actions";
import { extract } from "./extract";
import { applyRules } from "./rules";
import { getResident, listCalls, saveCall, saveResident } from "./store";
import type { Extraction, RulesOutput, Turn } from "./types";
import { getWeather } from "./weather";

export const japanDate = (d = new Date()) => d.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });

/** After a finished call: extract, apply the rules, send alerts and requests, update memory. */
export async function processCall(residentId: string, callId: string, transcript: Turn[]) {
  const resident = await getResident(residentId);
  if (!resident) throw new Error(`Unknown resident ${residentId}`);

  let extraction: Extraction | undefined;
  let rules: RulesOutput;
  try {
    extraction = await extract(resident, transcript);
    rules = applyRules(extraction.signals, await getWeather(resident.amedas_station));
  } catch (e) {
    // Never drop a call silently: a person should read it.
    console.error("Extraction failed", e);
    rules = { risk: "yellow", reasons: ["自動判定に失敗。通話メモを確認してください"], actions: [] };
  }

  // The in-call emergency tool already alerted people; don't alert them twice for the same call.
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const alreadyAlerted = (await listCalls(residentId)).some((c) => c.kind === "emergency" && c.at > twoHoursAgo);
  const actions = alreadyAlerted ? rules.actions.filter((a) => a.type !== "alert") : rules.actions;

  await saveCall({
    id: callId,
    resident_id: residentId,
    at: new Date().toISOString(),
    kind: "call",
    risk: rules.risk,
    reasons: rules.reasons,
    actions: await runActions(resident, callId, rules.reasons, actions),
    transcript,
    extraction,
  });

  if (extraction) {
    resident.recent_calls = [{ date: japanDate(), summary: extraction.summary }, ...resident.recent_calls].slice(0, 7);
    resident.facts = [...new Set([...resident.facts, ...extraction.new_facts])];
    await saveResident(resident);
  }
}
