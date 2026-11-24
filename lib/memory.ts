import { randomUUID } from "node:crypto";
import { curate, type Curation } from "./curate";
import { getResident, updateResident } from "./store";
import { daysBefore, japanDate } from "./trends";
import type { FollowUp, Resident, Turn } from "./types";

// The one place that changes what Yukimi remembers about a resident.
// The model proposes (lib/curate.ts); the functions here decide what is actually stored.

const MAX_OPEN = 5;
const MAX_NEW_PER_CALL = 3;
const MAX_DAYS = 14;
const MAX_LENGTH = 80;

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
    const clean = text.trim();
    if (added.length === MAX_NEW_PER_CALL) break;
    if (!clean || clean.length > MAX_LENGTH || known.has(clean)) continue;
    known.add(clean);
    const lasts = Math.min(MAX_DAYS, Math.max(1, Math.round(Number(days) || 1)));
    added.push({ id: randomUUID().slice(0, 8), text: clean, created: today, expires: daysBefore(today, -lasts) });
  }
  // Over the cap, the oldest go first.
  return { ...resident, follow_ups: [...kept, ...added].slice(-MAX_OPEN) };
}

/** After a call has been judged and saved: let the model propose memory changes, then apply them. */
export async function curateMemory(residentId: string, transcript: Turn[]) {
  const resident = await getResident(residentId);
  if (!resident) return;
  const today = japanDate();
  const proposed = await curate(resident, openFollowUps(resident, today), transcript, today);
  // The model call is done; only now take the lock, and apply to the freshest copy.
  await updateResident(residentId, (fresh) => applyCuration(fresh, proposed, today));
}
