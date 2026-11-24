import { randomUUID } from "node:crypto";
import { curate, type Curation } from "./curate";
import { getResident, updateResident } from "./store";
import { daysBefore, japanDate } from "./trends";
import type { Fact, FollowUp, MemoryChange, Resident, Turn } from "./types";

// The one place that changes what Yukimi remembers about a resident.
// The model proposes (lib/curate.ts); the functions here decide what is actually stored,
// and every change to the facts is written to the resident's memory log.

const MAX_OPEN = 5;
const MAX_NEW_PER_CALL = 3;
const MAX_DAYS = 14;
const MAX_LENGTH = 80;
// What the model writes (follow-ups and facts) is placed in tomorrow's agent prompt, so it must stay a
// plain one-line note: nothing that reads as prompt structure, and nothing about money, whoever said
// it on the call. What the helper writes is trusted.
const NOT_A_NOTE = /[#{}<>]|口座|暗証|カード|振込|振り込|送金|お金|現金|ATM|ＡＴＭ/i;
export const MAX_FACTS = 30;
const MAX_FACT_CHANGES_PER_CALL = 3; // each of: added, updated, retired
const MAX_CARE_NOTES = 300;
const LOG_KEPT = 100;

const newId = () => randomUUID().slice(0, 8);
const clean = (text: unknown) => String(text ?? "").replace(/\s+/g, " ").trim();
const fits = (text: string) => text.length > 0 && text.length <= MAX_LENGTH;

function logged(resident: Resident, by: string, entries: Omit<MemoryChange, "at" | "by">[]): Resident {
  if (entries.length === 0) return resident;
  const at = new Date().toISOString();
  return { ...resident, memory_log: [...(resident.memory_log ?? []), ...entries.map((e) => ({ at, by, ...e }))].slice(-LOG_KEPT) };
}

// ---- What the agent is given. Never empty: the prompt always needs a value. ----

/** Follow-ups still worth asking on `today`. */
export const openFollowUps = (resident: Resident, today: string): FollowUp[] =>
  (resident.follow_ups ?? []).filter((f) => f.expires >= today);

export const followUpsLine = (resident: Resident, today = japanDate()) =>
  openFollowUps(resident, today).map((f) => `・${f.text}`).join(" ") || "なし";

export const factsLine = (resident: Resident) => resident.facts.map((f) => f.text).join("、") || "なし";

export const careNotesLine = (resident: Resident) => clean(resident.care_notes) || "なし";

// ---- Changes proposed by the model after a call ----

function applyFollowUps(resident: Resident, proposed: Curation, today: string): Resident {
  const settled = new Set(proposed.resolved);
  const kept = openFollowUps(resident, today).filter((f) => !settled.has(f.id));
  const known = new Set(kept.map((f) => f.text));
  const added: FollowUp[] = [];
  for (const { text, days } of proposed.new_follow_ups) {
    const t = clean(text);
    // Full is full: a new item never pushes out one that is still open.
    if (added.length === MAX_NEW_PER_CALL || kept.length + added.length >= MAX_OPEN) break;
    if (!fits(t) || known.has(t) || NOT_A_NOTE.test(t)) continue;
    known.add(t);
    const lasts = Math.min(MAX_DAYS, Math.max(1, Math.round(Number(days) || 1)));
    added.push({ id: newId(), text: t, created: today, expires: daysBefore(today, -lasts) });
  }
  return { ...resident, follow_ups: [...kept, ...added] };
}

function applyFactChanges(resident: Resident, changes: Curation["fact_changes"], today: string, by: string): Resident {
  let facts = [...resident.facts];
  const retired = [...(resident.retired_facts ?? [])];
  const log: Omit<MemoryChange, "at" | "by">[] = [];
  // Locked facts (from intake or the helper) are not the model's to change.
  const editable = (id: string) => facts.find((f) => f.id === id && !f.locked);
  const has = (text: string) => facts.some((f) => f.text === text);

  for (const { id, text } of changes.update.slice(0, MAX_FACT_CHANGES_PER_CALL)) {
    const fact = editable(id);
    const t = clean(text);
    if (!fact || !fits(t) || has(t) || NOT_A_NOTE.test(t)) continue;
    facts = facts.map((f) => (f.id === id ? { ...f, text: t } : f));
    log.push({ op: "update", text: t, before: fact.text });
  }
  for (const { id, reason } of changes.retire.slice(0, MAX_FACT_CHANGES_PER_CALL)) {
    const fact = editable(id);
    if (!fact) continue;
    facts = facts.filter((f) => f.id !== id);
    retired.push({ ...fact, retired: today, reason: clean(reason).slice(0, MAX_LENGTH) });
    log.push({ op: "retire", text: fact.text });
  }
  for (const text of changes.add.slice(0, MAX_FACT_CHANGES_PER_CALL)) {
    const t = clean(text);
    if (!fits(t) || has(t) || NOT_A_NOTE.test(t)) continue;
    if (facts.length >= MAX_FACTS) {
      log.push({ op: "refuse", text: t }); // full: recorded so a person can decide
      continue;
    }
    facts.push({ id: newId(), text: t, since: today, source: "call" });
    log.push({ op: "add", text: t });
  }
  return logged({ ...resident, facts, retired_facts: retired }, by, log);
}

/** Applies what the model proposed after a call, within the limits above. `by` names the call for the log. */
export const applyCuration = (resident: Resident, proposed: Curation, today: string, by = "call"): Resident =>
  applyFactChanges(applyFollowUps(resident, proposed, today), proposed.fact_changes, today, by);

/** After a call has been judged and saved: let the model propose memory changes, then apply them. */
export async function curateMemory(residentId: string, callId: string, transcript: Turn[]) {
  const resident = await getResident(residentId);
  if (!resident) return;
  const today = japanDate();
  const proposed = await curate(resident, openFollowUps(resident, today), transcript, today);
  // The model call is done; only now take the lock, and apply to the freshest copy.
  await updateResident(residentId, (fresh) => applyCuration(fresh, proposed, today, `call:${callId}`));
}

// ---- Changes made by the helper on the dashboard. Whatever the helper writes is locked. ----

export const removeFollowUp = (resident: Resident, id: string): Resident => ({
  ...resident,
  follow_ups: (resident.follow_ups ?? []).filter((f) => f.id !== id),
});

export function addFact(resident: Resident, text: string, today: string): Resident {
  const t = clean(text);
  if (!fits(t) || resident.facts.some((f) => f.text === t) || resident.facts.length >= MAX_FACTS) return resident;
  const fact: Fact = { id: newId(), text: t, since: today, source: "helper", locked: true };
  return logged({ ...resident, facts: [...resident.facts, fact] }, "helper", [{ op: "add", text: t }]);
}

export function editFact(resident: Resident, id: string, text: string): Resident {
  const fact = resident.facts.find((f) => f.id === id);
  const t = clean(text);
  if (!fact || !fits(t) || t === fact.text) return resident;
  const facts = resident.facts.map((f) => (f.id === id ? { ...f, text: t, locked: true } : f));
  return logged({ ...resident, facts }, "helper", [{ op: "update", text: t, before: fact.text }]);
}

export function retireFact(resident: Resident, id: string, today: string): Resident {
  const fact = resident.facts.find((f) => f.id === id);
  if (!fact) return resident;
  return logged(
    {
      ...resident,
      facts: resident.facts.filter((f) => f.id !== id),
      retired_facts: [...(resident.retired_facts ?? []), { ...fact, retired: today, reason: "helper" }],
    },
    "helper",
    [{ op: "retire", text: fact.text }],
  );
}

export function restoreFact(resident: Resident, id: string): Resident {
  const fact = (resident.retired_facts ?? []).find((f) => f.id === id);
  if (!fact || resident.facts.length >= MAX_FACTS) return resident;
  return logged(
    {
      ...resident,
      facts: [...resident.facts, { id: fact.id, text: fact.text, since: fact.since, source: fact.source, locked: true }],
      retired_facts: (resident.retired_facts ?? []).filter((f) => f.id !== id),
    },
    "helper",
    [{ op: "restore", text: fact.text }],
  );
}

/**
 * Removes a retired fact for good, and its text from the memory log. Call records, summaries and
 * ElevenLabs' own copy of the conversation are not touched: this is not yet deletion on request.
 */
export function deleteFact(resident: Resident, id: string): Resident {
  const fact = (resident.retired_facts ?? []).find((f) => f.id === id);
  if (!fact) return resident;
  const scrub = (e: MemoryChange): MemoryChange => ({
    ...e,
    text: e.text === fact.text ? undefined : e.text,
    before: e.before === fact.text ? undefined : e.before,
  });
  return logged(
    {
      ...resident,
      retired_facts: (resident.retired_facts ?? []).filter((f) => f.id !== id),
      memory_log: (resident.memory_log ?? []).map(scrub),
    },
    "helper",
    [{ op: "delete" }],
  );
}

export function setCareNotes(resident: Resident, text: string): Resident {
  const t = clean(text).slice(0, MAX_CARE_NOTES);
  if (t === clean(resident.care_notes)) return resident;
  return logged({ ...resident, care_notes: t }, "helper", [{ op: "care_notes", text: t }]);
}
