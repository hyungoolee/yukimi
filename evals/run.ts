// Runs each scripted resident through the real extraction and the rules, and prints counts.
// Uses the saved demo weather (-12°C), so the heater rule's mild-day branch is not exercised.
// Costs one model call per persona. Run: pnpm eval
import { readFileSync } from "node:fs";
import { curate } from "../lib/curate.ts";
import { extract } from "../lib/extract.ts";
import { applyRules } from "../lib/rules.ts";
import { dailyObservations, daysBefore, findTrends, japanDate, withTrends } from "../lib/trends.ts";
import type { Observations, Resident, Weather } from "../lib/types.ts";

type Persona = {
  id: string;
  resident: string;
  expected: "green" | "yellow" | "red" | "missed";
  expected_reasons: string[];
  snow_request: boolean;
  observations?: Partial<Observations>; // the ones this script must get right
  holdout?: boolean;
  transcript: [string, string][];
};

const json = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
const personas: Persona[] = json("./personas.json");
const weather: Weather = json("../data/seed/weather.json");

async function run(p: Persona) {
  const resident: Resident = json(`../data/seed/residents/${p.resident}.json`);
  const extraction = await extract(resident, p.transcript.map(([role, message]) => ({ role, message })));
  const rules = applyRules(extraction.signals, weather);
  const answered = extraction.answered_by_person;
  const got = answered ? rules.risk : "missed";
  const snow = answered && rules.actions.some((a) => a.type === "snow_request");
  // Right level for the right reasons: every expected reason must be among the rules' reasons.
  const wrong = Object.entries(p.observations ?? {})
    .filter(([field, want]) => extraction.observations?.[field as keyof Observations] !== want)
    .map(([field, want]) => `${field} should be ${want}, got ${extraction.observations?.[field as keyof Observations]}`);
  const ok =
    got === p.expected && snow === p.snow_request && p.expected_reasons.every((r) => rules.reasons.includes(r)) && wrong.length === 0;
  return { got, snow, ok, reasons: answered ? [...rules.reasons, ...wrong] : [] };
}

// One at a time, so a rate limit or outage on one persona doesn't lose the rest.
const results: (Persona & { got: string; snow: boolean; ok: boolean; reasons: string[] })[] = [];
for (const p of personas) {
  const r = await run(p).catch((e: Error) => ({ got: "ERROR", snow: false, ok: false, reasons: [e.message] }));
  results.push({ ...p, ...r });
  console.log(
    `${r.ok ? "ok  " : "MISS"} ${p.id.padEnd(22)} expected ${p.expected.padEnd(6)} got ${r.got.padEnd(6)}` +
      `${r.snow ? " +snow" : ""}${p.holdout ? "  (held out)" : ""}  ${r.reasons.join("、")}`,
  );
}

const count = (rows: typeof results) => `${rows.filter((r) => r.ok).length}/${rows.length}`;
const of = (expected: string) => results.filter((r) => r.expected === expected);
const falseReds = results.filter((r) => r.expected !== "red");
console.log(`\nred caught, right reasons:     ${count(of("red"))}`);
console.log(`yellow caught, right reasons:  ${count(of("yellow"))}`);
console.log(`green left alone:              ${count(of("green"))}`);
console.log(`voicemail as missed:           ${count(of("missed"))}`);
console.log(`false red alerts:              ${falseReds.filter((r) => r.got === "red").length}/${falseReds.length}`);
console.log(`held-out personas:             ${count(results.filter((r) => r.holdout))}`);

// Three days of calls for one resident: each day is extracted for real, then the trend rules run over them.
const sequence: { resident: string; days: [string, string][][] } = json("./sequence.json");
const today = japanDate();
const seqResident: Resident = json(`../data/seed/residents/${sequence.resident}.json`);
const seen: { at: string; observations?: Observations }[] = [];
let last = { risk: "green", reasons: [] as string[] };
for (const [i, transcript] of sequence.days.entries()) {
  const date = daysBefore(today, sequence.days.length - 1 - i);
  const extraction = await extract(seqResident, transcript.map(([role, message]) => ({ role, message })));
  seen.unshift({ at: `${date}T09:00:00+09:00`, observations: extraction.observations });
  last = withTrends(applyRules(extraction.signals, weather), findTrends(dailyObservations(seen), date));
  console.log(`day ${i + 1}: ate=${extraction.observations?.ate} -> ${last.risk}  ${last.reasons.join("、")}`);
}
const fired = last.risk === "red" && last.reasons.includes("3日続けて食事をとれていない");
console.log(`three-day trend fires:         ${fired ? "1/1" : "0/1"}`);

// Follow-ups: the memory model call, on the demo call and on a next-day call that settles one.
const sato: Resident = json("../data/seed/residents/sato.json");
const slip = personas.find((p) => p.id === "slip-on-ice")!.transcript.map(([role, message]) => ({ role, message }));
const first = await curate(sato, [], slip, today);
console.log(`\nfollow-ups after the slip-on-ice call: ${first.new_follow_ups.map((f) => `${f.text} (${f.days}d)`).join(" / ") || "none"}`);
const open = [{ id: "hip", text: "腰の痛みはその後どうか", created: today, expires: today }];
const nextDay = [
  ["agent", "もしもし、佐藤さんですか。見守り電話です。きのうは腰が痛いとのことでしたが、その後いかがですか？"],
  ["user", "おかげさまで、もうすっかり痛くないよ。ふつうに歩けるし。"],
  ["agent", "それはよかったです。食事はとれていますか？"],
  ["user", "うん、朝もしっかり食べたよ。"],
].map(([role, message]) => ({ role, message }));
const second = await curate(sato, open, nextDay, today);
console.log(`follow-up about the hip or the fall:  ${first.new_follow_ups.some((f) => /腰|転/.test(f.text)) ? "1/1" : "0/1"}`);
console.log(`routine questions left out:           ${first.new_follow_ups.some((f) => /食事|睡眠|暖房|ストーブ/.test(f.text)) ? "0/1" : "1/1"}`);
console.log(`settled follow-up closed:             ${second.resolved.includes("hip") ? "1/1" : "0/1"}  (new: ${second.new_follow_ups.map((f) => f.text).join(" / ") || "none"})`);
