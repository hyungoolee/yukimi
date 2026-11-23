// Runs each scripted resident through the real extraction and the rules, and prints counts.
// Uses the saved demo weather (-12°C), so the heater rule's mild-day branch is not exercised.
// Costs one model call per persona. Run: pnpm eval
import { readFileSync } from "node:fs";
import { extract } from "../lib/extract.ts";
import { applyRules } from "../lib/rules.ts";
import type { Resident, Weather } from "../lib/types.ts";

type Persona = {
  id: string;
  resident: string;
  expected: "green" | "yellow" | "red" | "missed";
  expected_reasons: string[];
  snow_request: boolean;
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
  const ok = got === p.expected && snow === p.snow_request && p.expected_reasons.every((r) => rules.reasons.includes(r));
  return { got, snow, ok, reasons: answered ? rules.reasons : [] };
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
