import { randomUUID } from "node:crypto";
import { curate, type Curation } from "./curate";
import { getCall, getResident, listCalls, updateResident } from "./store";
import { daysBefore, japanDate } from "./trends";
import type { FollowUp, Resident, Turn } from "./types";

// The one place that changes what Yukimi remembers about a resident.
// The model proposes (lib/curate.ts); the functions here decide what is actually stored.

const MAX_OPEN = 5;
const MAX_NEW_PER_CALL = 3;
const MAX_DAYS = 14;
const MAX_LENGTH = 80;
// A follow-up's text is placed in tomorrow's agent prompt, so it must stay a plain one-line note:
// nothing that reads as prompt structure, and nothing about money, whoever said it on the call.
const NOT_A_NOTE = /[#{}<>]|口座|暗証|カード|振込|振り込|送金|お金|現金|ATM|ＡＴＭ/i;

/** Follow-ups still worth asking on `today`. */
export const openFollowUps = (resident: Resident, today: string): FollowUp[] =>
  (resident.follow_ups ?? []).filter((f) => f.expires >= today);

/** The follow-ups as the agent is given them. Never empty: the prompt always needs a value. */
export const followUpsLine = (resident: Resident, today = japanDate()) =>
  openFollowUps(resident, today).map((f) => `・${f.text}`).join(" ") || "なし";

export const removeFollowUp = (resident: Resident, id: string): Resident => ({
  ...resident,
  follow_ups: (resident.follow_ups ?? []).filter((f) => f.id !== id),
});

/** Applies a proposed curation: drops expired and settled follow-ups, adds the new ones, within limits. */
export function applyCuration(resident: Resident, proposed: Curation, today: string): Resident {
  const settled = new Set(proposed.resolved);
  const kept = openFollowUps(resident, today).filter((f) => !settled.has(f.id));
  const known = new Set(kept.map((f) => f.text));
  const added: FollowUp[] = [];
  for (const { text, days } of proposed.new_follow_ups) {
    const clean = String(text).replace(/\s+/g, " ").trim();
    // Full is full: a new item never pushes out one that is still open.
    if (added.length === MAX_NEW_PER_CALL || kept.length + added.length >= MAX_OPEN) break;
    if (!clean || clean.length > MAX_LENGTH || known.has(clean) || NOT_A_NOTE.test(clean)) continue;
    known.add(clean);
    const lasts = Math.min(MAX_DAYS, Math.max(1, Math.round(Number(days) || 1)));
    added.push({ id: randomUUID().slice(0, 8), text: clean, created: today, expires: daysBefore(today, -lasts) });
  }
  return { ...resident, follow_ups: [...kept, ...added] };
}

/** After a call has been judged and saved: let the model propose memory changes, then apply them. */
export async function curateMemory(residentId: string, callId: string, transcript: Turn[]) {
  const resident = await getResident(residentId);
  if (!resident) return;
  const today = japanDate();
  const proposed = await curate(resident, openFollowUps(resident, today), transcript, today);

  // The model call can take a while, and the world may have moved on. Its answer is only applied if
  // the call it came from still exists (a demo reset removes it) and is still the resident's latest
  // answered call (a later call may already have settled what this one would ask about).
  const [source, calls] = await Promise.all([getCall(callId), listCalls(residentId)]);
  const latest = calls.find((c) => c.kind === "call" && c.extraction);
  if (!source || latest?.id !== callId) {
    console.warn(`Memory curation for call ${callId} is out of date; not applied`);
    return;
  }
  // Only now take the lock, and apply to the freshest copy.
  await updateResident(residentId, (fresh) => applyCuration(fresh, proposed, today));
}
