import { cp, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { normalizeResident } from "./resident";
import type { AlertReasons, CallRecord, Resident, Role, Weather } from "./types";

const DATA_DIR = process.env.DATA_DIR ?? path.join(/* turbopackIgnore: true */ process.cwd(), ".data");
const SEED_DIR = path.join(/* turbopackIgnore: true */ process.cwd(), "data", "seed");
function file(dir: string, id: string) {
  // IDs come from forms and webhooks; never let one point outside its folder.
  if (!/^[\w-]+$/.test(id)) throw new Error(`Invalid id: ${id}`);
  return path.join(DATA_DIR, dir, `${id}.json`);
}

// First run on an empty disk: copy the fictional seed residents in.
// One shared promise, so parallel reads on a fresh disk don't seed twice.
let seeded: Promise<void> | undefined;
const ensureSeeded = () => (seeded ??= seed());
async function seed() {
  const existing = await readdir(path.join(DATA_DIR, "residents")).catch(() => []);
  if (existing.length > 0) return;
  await mkdir(DATA_DIR, { recursive: true });
  await cp(SEED_DIR, DATA_DIR, { recursive: true });
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

export const getResident = async (id: string) => {
  const raw = await read<Resident>("residents", id);
  return raw && normalizeResident(raw);
};
export const saveResident = (r: Resident) => write("residents", r.id, r);

// One writer per resident at a time. Kept on globalThis so route handlers and server actions,
// which Next may load as separate copies of this module, share the same queue.
const queues: Map<string, Promise<unknown>> = ((globalThis as { yukimiQueues?: Map<string, Promise<unknown>> }).yukimiQueues ??=
  new Map());

/**
 * Reads a resident, applies `change` and saves, without another writer getting in between.
 * `change` gets the freshest copy and must be quick: do model calls before, not inside.
 * Returns the saved resident, or null if there is no such resident.
 */
export function updateResident(id: string, change: (resident: Resident) => Resident): Promise<Resident | null> {
  const run = (queues.get(id) ?? Promise.resolve())
    .catch(() => {})
    .then(async () => {
      const resident = await getResident(id);
      if (!resident) return null;
      const next = change(resident);
      await saveResident(next);
      return next;
    });
  queues.set(id, run);
  void run.finally(() => queues.get(id) === run && queues.delete(id)).catch(() => {});
  return run;
}
export async function listResidents() {
  return (await readAll<Resident>("residents")).map(normalizeResident).sort((a, b) => a.call_time.localeCompare(b.call_time));
}

export const getCall = (id: string) => read<CallRecord>("calls", id);
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
export type Pending = { resident_id: string; attempt: number };
export const savePending = (conversationId: string, p: Pending) => write("pending", conversationId, p);
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
  for (const current of await readAll<Resident>("residents")) {
    const seed = JSON.parse(
      await readFile(path.join(/* turbopackIgnore: true */ SEED_DIR, "residents", `${current.id}.json`), "utf8").catch(() => "null"),
    ) as Resident | null;
    if (!seed) continue;
    const { facts, recent_calls } = normalizeResident(seed);
    await updateResident(current.id, (r) => ({
      ...r,
      facts,
      recent_calls,
      follow_ups: [],
      retired_facts: [],
      care_notes: "",
      memory_log: [],
      blocked_facts: [],
      location: r.location ?? seed.location,
      snow_volunteer: { ...r.snow_volunteer, location: r.snow_volunteer.location ?? seed.snow_volunteer.location },
    }));
  }
}

// Work that must happen later (ladder steps, alert re-sends). Kept on disk so a restart doesn't lose it.
export type Task = {
  id: string;
  due: number; // epoch ms
  kind: "ladder_retry" | "ladder_confirm" | "alert_recheck";
  resident_id: string;
  call_id?: string;
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
