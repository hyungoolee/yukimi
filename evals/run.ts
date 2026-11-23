// Runs each scripted resident through the real extraction and the rules, and prints counts.
// Uses the saved demo weather (-12°C). Costs one model call per persona.
// Run: pnpm eval
import { readFileSync } from "node:fs";
import { extract } from "../lib/extract.ts";
import { applyRules } from "../lib/rules.ts";
import type { Resident, Weather } from "../lib/types.ts";

type Persona = {
  id: string;
  expected: "green" | "yellow" | "red" | "missed";
  snow_request: boolean;
  holdout?: boolean;
  transcript: [string, string][];
};

const json = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
const personas: Persona[] = json("./personas.json");
const resident: Resident = json("../data/seed/residents/sato.json");
const weather: Weather = json("../data/seed/weather.json");

const results = await Promise.all(
  personas.map(async (p) => {
    const extraction = await extract(resident, p.transcript.map(([role, message]) => ({ role, message })));
    const rules = applyRules(extraction.signals, weather);
    const got = extraction.answered_by_person ? rules.risk : "missed";
    const snow = extraction.answered_by_person && rules.actions.some((a) => a.type === "snow_request");
    return { ...p, got, snow, reasons: rules.reasons };
  }),
);

for (const r of results) {
  const ok = r.got === r.expected && r.snow === r.snow_request;
  console.log(
    `${ok ? "ok  " : "MISS"} ${r.id.padEnd(22)} expected ${r.expected.padEnd(6)} got ${r.got.padEnd(6)}` +
      `${r.snow ? " +snow" : ""}${r.holdout ? "  (held out)" : ""}  ${r.reasons.join("、")}`,
  );
}

const count = (rows: typeof results, hit: (r: (typeof results)[number]) => boolean) =>
  `${rows.filter(hit).length}/${rows.length}`;
const of = (expected: string) => results.filter((r) => r.expected === expected);
console.log(`\nred caught:           ${count(of("red"), (r) => r.got === "red")}`);
console.log(`yellow caught:        ${count(of("yellow"), (r) => r.got === "yellow")}`);
console.log(`false red alerts:     ${count(results.filter((r) => r.expected !== "red"), (r) => r.got === "red")}`);
console.log(`voicemail as missed:  ${count(of("missed"), (r) => r.got === "missed")}`);
console.log(`snow requests right:  ${count(results, (r) => r.snow === r.snow_request)}`);
console.log(`held-out personas:    ${count(results.filter((r) => r.holdout), (r) => r.got === r.expected)}`);
