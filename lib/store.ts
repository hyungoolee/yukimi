import { randomInt } from "node:crypto";
import { cp, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { ROLES } from "./coverage";
import { normalizeResident } from "./resident";
import { daysBefore, japanDate } from "./trends";
import type { AlertReasons, CallRecord, Contact, FollowUp, Person, RequestKind, Resident, Role, Weather } from "./types";

const DATA_DIR = process.env.DATA_DIR ?? path.join(/* turbopackIgnore: true */ process.cwd(), ".data");
const SEED_DIR = path.join(/* turbopackIgnore: true */ process.cwd(), "data", "seed");
function file(dir: string, id: string) {
  // IDs come from forms and webhooks; never let one point outside its folder.
  if (!/^[\w-]+$/.test(id)) throw new Error(`Invalid id: ${id}`);
  return path.join(DATA_DIR, dir, `${id}.json`);
}

// All copies of the store in this process wait for the same initialization of a data directory.
const seeding: Map<string, Promise<void>> = ((globalThis as { yukimiSeeding?: Map<string, Promise<void>> }).yukimiSeeding ??=
  new Map());
function ensureSeeded() {
  const pending = seeding.get(DATA_DIR);
  if (pending) return pending;
  const initialization = seed();
  seeding.set(DATA_DIR, initialization);
  return initialization;
}
/**
 * A seed file gives each follow-up a number of days, not dates, so the demo's are open whenever it is
 * seeded or reset: each reads as raised on yesterday's call.
 */
type SeedFollowUp = { text: string; kind?: FollowUp["kind"]; days: number };
const seededFollowUps = (seed: { follow_ups?: unknown }, today = japanDate()): FollowUp[] =>
  ((seed.follow_ups ?? []) as SeedFollowUp[]).map((f, i) => ({
    id: `seed${i}`,
    text: f.text,
    kind: f.kind,
    created: daysBefore(today, 1),
    expires: daysBefore(today, -f.days),
  }));

async function seed() {
  const existing = await readdir(path.join(DATA_DIR, "residents")).catch(() => []);
  if (existing.length === 0) {
    await mkdir(DATA_DIR, { recursive: true });
    await cp(SEED_DIR, DATA_DIR, { recursive: true });
    for (const name of await readdir(path.join(DATA_DIR, "residents"))) {
      const at = path.join(DATA_DIR, "residents", name);
      const resident = JSON.parse(await readFile(at, "utf8"));
      await write("residents", name.slice(0, -5), { ...resident, follow_ups: seededFollowUps(resident) });
    }
    return;
  }
  // A disk from before people had their own files holds names inside each resident. Nobody had
  // registered for real then, so such a resident takes its three people from the seed data.
  const json = <T>(at: string) => readFile(at, "utf8").then((raw) => JSON.parse(raw) as T).catch(() => null);
  // A disk from before the snow helper's role was renamed. First, so the step below doesn't take it for a missing role.
  for (const name of existing.filter((n) => /^[\w-]+\.json$/.test(n))) {
    const old = await json<Stored & { snow_volunteer?: unknown }>(path.join(DATA_DIR, "residents", name));
    if (!old || !("snow_volunteer" in old)) continue;
    const { snow_volunteer, ...rest } = old;
    // Both keys: an older release ran on this disk after this one and filled the old key in from the seed.
    await write("residents", name.slice(0, -5), { ...rest, snow_helper: typeof old.snow_helper === "string" ? old.snow_helper : snow_volunteer });
  }
  for (const name of existing.filter((n) => /^[\w-]+\.json$/.test(n))) {
    // A file that can't be read is left alone, as before: that resident is missing, the rest still work.
    const old = await json<Stored>(path.join(DATA_DIR, "residents", name));
    if (!old || ROLES.every((role) => typeof old[role] === "string")) continue;
    await cp(path.join(SEED_DIR, "people"), path.join(DATA_DIR, "people"), { recursive: true, force: false });
    const fresh = await json<Stored>(path.join(SEED_DIR, "residents", name));
    const roles = Object.fromEntries(ROLES.map((role) => [role, typeof old[role] === "string" ? old[role] : (fresh?.[role] ?? "")]));
    await write("residents", name.slice(0, -5), { ...old, ...roles });
  }
  // A disk seeded before family_of existed: the seed's family contacts get their resident, so each
  // is offered only as that resident's family. Read directly: the store's own reads wait on this seeding.
  for (const name of await readdir(path.join(SEED_DIR, "people"))) {
    const seed = await json<Person>(path.join(SEED_DIR, "people", name));
    const person = await json<Person>(path.join(DATA_DIR, "people", name));
    if (seed?.family_of && person && !person.family_of) await write("people", person.id, { ...person, family_of: seed.family_of });
  }
}

async function read<T>(dir: string, id: string): Promise<T | null> {
  await ensureSeeded();
  try {
    return JSON.parse(await readFile(file(dir, id), "utf8")) as T;
  } catch {
    return null;
  }
}

async function write(dir: string, id: string, data: unknown) {
  await mkdir(path.join(DATA_DIR, dir), { recursive: true });
  // Write then rename, so a reader never sees a half-written file.
  const tmp = `${file(dir, id)}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 2));
  await rename(tmp, file(dir, id));
}

async function readAll<T>(dir: string): Promise<T[]> {
  await ensureSeeded();
  const names = await readdir(path.join(DATA_DIR, dir)).catch(() => []);
  const items = await Promise.all(
    names.filter((n) => n.endsWith(".json")).map((n) => read<T>(dir, n.slice(0, -5))),
  );
  return items.filter((x) => x !== null);
}

// One writer per file at a time. Kept on globalThis so route handlers and server actions,
// which Next may load as separate copies of this module, share the same queue.
const queues: Map<string, Promise<unknown>> = ((globalThis as { yukimiQueues?: Map<string, Promise<unknown>> }).yukimiQueues ??=
  new Map());
function queued<T>(key: string, work: () => Promise<T>): Promise<T> {
  const run = (queues.get(key) ?? Promise.resolve()).catch(() => {}).then(work);
  queues.set(key, run);
  void run.finally(() => queues.get(key) === run && queues.delete(key)).catch(() => {});
  return run;
}

export const getPerson = (id: string) => read<Person>("people", id);
export const listPeople = async () => (await readAll<Person>("people")).sort((a, b) => a.name.localeCompare(b.name, "ja"));
export const deletePerson = (id: string) => rm(file("people", id), { force: true });
const newCode = () => String(randomInt(1e8)).padStart(8, "0");
/** A new person, with the code they register on LINE with. */
export async function addPerson(name: string, phone?: string, family_of?: string, kind?: Person["kind"]) {
  const person: Person = { id: `p_${randomInt(36 ** 6).toString(36)}`, name, phone, family_of, kind, code: newCode() };
  await write("people", person.id, person);
  return person;
}
/** Reads a person, applies `change` and saves, one writer at a time. `change` returns null to leave them as they are. */
export function updatePerson(id: string, change: (person: Person) => Person | null) {
  return queued(`people/${id}`, async () => {
    const person = await getPerson(id);
    const next = person && change(person);
    if (next) await write("people", id, next);
    return next;
  });
}
/** A fresh registration code, replacing any old one. */
export const renewCode = (id: string) => updatePerson(id, (p) => ({ ...p, code: newCode() }));

/** A resident as saved: each role holds a person's id, or "" when the post is vacant. */
type Stored = Omit<Resident, Role | "snow_next"> & Record<Role, string> & { snow_next?: string[] };

// The rest of the app reads a resident with the three people filled in.
async function withPeople(stored: Stored): Promise<Resident> {
  const contact = async (id: string): Promise<Contact> => {
    const person = id ? await getPerson(id) : null;
    // A person who can't be read keeps their id, so the next save of this resident doesn't drop them.
    if (!person) return id ? { id, name: "" } : { name: "" };
    const contact: Person = { ...person };
    delete contact.code; // the registration code stays on the person's own page
    return contact;
  };
  const [helper, second_contact, snow_helper] = await Promise.all(ROLES.map((role) => contact(stored[role])));
  const snow_next = await Promise.all((stored.snow_next ?? []).map(contact));
  // Facts are brought to today's shape on every read (lib/resident.ts).
  return normalizeResident({ ...stored, helper, second_contact, snow_helper, snow_next });
}

export async function getResident(id: string) {
  const stored = await read<Stored>("residents", id);
  return stored && withPeople(stored);
}
/** Saves the resident and who holds each role. A person's own details are saved with updatePerson. */
export function saveResident(r: Resident) {
  for (const role of ROLES) {
    // Only the id is kept, so details typed into a role here would be lost without a sound.
    if (r[role].name && !r[role].id) throw new Error(`${role} of ${r.id} is not a saved person`);
  }
  const roles = Object.fromEntries(ROLES.map((role) => [role, r[role].id ?? ""]));
  const snow_next = (r.snow_next ?? []).flatMap((c) => c.id ?? []);
  return write("residents", r.id, { ...r, ...roles, snow_next });
}

/**
 * Reads a resident, applies `change` and saves, without another writer getting in between.
 * `change` gets the freshest copy and must be quick: do model calls before, not inside.
 * Returns the saved resident, or null if there is no such resident.
 */
export function updateResident(id: string, change: (resident: Resident) => Resident): Promise<Resident | null> {
  return queued(`residents/${id}`, async () => {
    const resident = await getResident(id);
    if (!resident) return null;
    const next = change(resident);
    await saveResident(next);
    return next;
  });
}
/** Puts a person in a role for a resident; an empty id leaves the post vacant. */
export function assign(residentId: string, roles: Partial<Record<Role, string>> & { snow_next?: string[] }, chosen?: string[]) {
  return queued(`residents/${residentId}`, async () => {
    const stored = await read<Stored>("residents", residentId);
    if (!stored) return;
    const next = { ...stored, ...roles };
    // Choosing someone for the snow line is the agreement to them as a business, as they are marked
    // now. Only the people this save chose count (`chosen`, else everyone it set): a save of one place
    // agrees nothing about the others, who keep whatever was agreed before.
    if (roles.snow_helper !== undefined || roles.snow_next !== undefined) {
      const saved = new Set(chosen ?? [...(roles.snow_helper ? [roles.snow_helper] : []), ...(roles.snow_next ?? [])]);
      const was = new Set(stored.paid_ok ?? []);
      const line = [next.snow_helper, ...(next.snow_next ?? [])].filter(Boolean);
      const people = await Promise.all(line.map(getPerson));
      next.paid_ok = people.flatMap((p) => (p?.kind === "business" && (saved.has(p.id) || was.has(p.id)) ? [p.id] : []));
    }
    await write("residents", residentId, next);
  });
}
export function assignFamilyIfVacant(residentId: string, personId: string) {
  return queued(`residents/${residentId}`, async () => {
    const stored = await read<Stored>("residents", residentId);
    if (stored && !stored.second_contact) await write("residents", residentId, { ...stored, second_contact: personId });
  });
}
export async function listResidents() {
  const stored = await readAll<Stored>("residents");
  return (await Promise.all(stored.map(withPeople))).sort((a, b) => a.call_time.localeCompare(b.call_time));
}

// Records from before help requests had kinds: a snow request with its own "accepted" flag.
type OldCall = { snow_accepted?: boolean; actions: { type: string }[] };
// Records from before the snow helper's role was renamed.
const role = (r: string) => (r === "snow_volunteer" ? "snow_helper" : r) as Role;
function normalizeCall(raw: CallRecord): CallRecord {
  const { snow_accepted, ...call } = raw as CallRecord & OldCall;
  return {
    ...call,
    actions: call.actions.map((a) => ({
      ...((a.type as string) === "snow_request"
        ? { ...a, type: "request", kind: "snow", ...(snow_accepted ? { accepted_by: "" } : {}) }
        : a),
      to: a.to.map(role),
      ...(a.deliveries && { deliveries: a.deliveries.map((d) => ({ ...d, role: role(d.role) })) }),
    })),
  };
}

export const getCall = async (id: string) => {
  const call = await read<CallRecord>("calls", id);
  return call && normalizeCall(call);
};
export const saveCall = (c: CallRecord) => write("calls", c.id, c);
// Several things change the same call record (an acknowledgement, a re-send count, "handled",
// a volunteer accepting). Each change re-reads the record and waits its turn, so none overwrites another.
const callQueue = new Map<string, Promise<unknown>>();
export function updateCall(id: string, change: (call: CallRecord) => Partial<CallRecord> | null) {
  const run = (callQueue.get(id) ?? Promise.resolve())
    .catch(() => {})
    .then(async () => {
      const call = await getCall(id);
      const patch = call && change(call);
      if (!call || !patch) return null;
      const next = { ...call, ...patch };
      await saveCall(next);
      return next;
    });
  callQueue.set(id, run);
  run.finally(() => callQueue.get(id) === run && callQueue.delete(id)).catch(() => {});
  return run;
}

/** Newest first. */
export async function listCalls(residentId?: string) {
  const calls = await readAll<CallRecord>("calls");
  return calls
    .map(normalizeCall)
    .filter((c) => !residentId || c.resident_id === residentId)
    .sort((a, b) => b.at.localeCompare(a.at));
}

const TREND_FIRINGS = "trend-firings";

/** Claim a firing on disk before dispatch so overlapping calls cannot send it twice. */
export async function claimTrendFiring(residentId: string, trendId: string, date: string) {
  const marker = file(TREND_FIRINGS, `${residentId}--${trendId}--${date}`);
  await mkdir(path.dirname(marker), { recursive: true });
  try {
    await writeFile(marker, "", { flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return null;
    throw error;
  }
  return () => rm(marker, { force: true });
}

// A call we placed and are waiting to hear back about, keyed by ElevenLabs conversation ID.
/** `news`: a news call (lib/elevenlabs.ts placeNewsCall), and which request it was about. */
export type Pending = { resident_id: string; attempt: number; winter_checks?: boolean; at?: number; news?: { call_id: string; request_kind: string } };
export const savePending = (conversationId: string, p: Pending) => write("pending", conversationId, { ...p, at: Date.now() });
/** Calls placed and not yet reported back. One that never reports stops counting after 15 minutes. */
export const pendingCalls = async (now = Date.now(), residentId?: string) =>
  (await readAll<Pending>("pending")).filter((p) => (p.at ?? 0) > now - 15 * 60_000 && (!residentId || p.resident_id === residentId));
export const callsInProgress = async (now = Date.now(), residentId?: string) => (await pendingCalls(now, residentId)).length;
export const getPending = (conversationId: string) => read<Pending>("pending", conversationId);
export const clearPending = (conversationId: string) => rm(file("pending", conversationId), { force: true });

// Where a resident is on the missed-call ladder.
export type LadderState = { stage: "retry" | "second_contact"; at: number };
export const getLadder = (residentId: string) => read<LadderState>("ladder", residentId);
export const saveLadder = (residentId: string, s: LadderState) => write("ladder", residentId, s);
export const clearLadder = (residentId: string) => rm(file("ladder", residentId), { force: true });

/**
 * Back to a clean demo: no calls or ladders, and each resident's memory as seeded.
 * Phone numbers and LINE registrations are kept, so nobody has to set up again.
 * Map pins are kept too; a demo resident with no pin yet gets the made-up one from the seed data.
 */
export async function resetDemoData() {
  await ensureSeeded();
  await Promise.all(["calls", "ladder", "pending", "tasks", TREND_FIRINGS].map((dir) => rm(path.join(/* turbopackIgnore: true */ DATA_DIR, dir), { recursive: true, force: true })));
  const seedFile = async <T>(dir: string, id: string) =>
    JSON.parse(await readFile(path.join(/* turbopackIgnore: true */ SEED_DIR, dir, `${id}.json`), "utf8").catch(() => "null")) as T | null;
  for (const { id } of await readAll<Person>("people")) {
    const seed = await seedFile<Person>("people", id);
    if (seed?.location) await updatePerson(id, (p) => (p.location ? null : { ...p, location: seed.location }));
  }
  for (const current of await readAll<Stored>("residents")) {
    const seed = await seedFile<Stored>("residents", current.id);
    if (!seed) continue;
    const { facts, recent_calls } = normalizeResident(seed);
    await updateResident(current.id, (r) => ({
      ...r,
      facts,
      recent_calls,
      follow_ups: seededFollowUps(seed),
      retired_facts: [],
      care_notes: "",
      care_notes_en: "",
      memory_log: [],
      blocked_facts: [],
      location: r.location ?? seed.location,
    }));
  }
}

// Work that must happen later (ladder steps, alert re-sends). Kept on disk so a restart doesn't lose it.
export type Task = {
  id: string;
  due: number; // epoch ms
  kind: "ladder_retry" | "ladder_confirm" | "alert_recheck" | "request_check" | "news_call";
  resident_id: string;
  call_id?: string; // request_check: the call that first asked; news_call: the record holding the request
  record?: string; // for request_check: the call record the request stood on when this was booked
  stage?: string; // for request_check: how far down the line it had got then (lib/actions.ts stageKey)
  request_kind?: RequestKind;
  round?: number;
  reasonsByRole?: AlertReasons; // for alert_recheck, even if the call record is missing
  to?: Role[]; // legacy alert_recheck tasks used the same reasons for every recipient
  reasons?: string[];
  ladder_at?: number; // which ladder this step belongs to, so a step from an old ladder can't act on a new one
};
export async function schedule(task: Omit<Task, "id">) {
  const id = `${task.kind}-${task.resident_id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await write("tasks", id, { ...task, id });
}
export const listTasks = () => readAll<Task>("tasks");
export const deleteTask = (id: string) => rm(file("tasks", id), { force: true });

export async function getSavedWeather(): Promise<Weather> {
  await ensureSeeded();
  return JSON.parse(await readFile(path.join(DATA_DIR, "weather.json"), "utf8"));
}
