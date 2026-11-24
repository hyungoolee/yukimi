import { cp, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CallRecord, Resident, Weather } from "./types";

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

export const getResident = (id: string) => read<Resident>("residents", id);
export const saveResident = (r: Resident) => write("residents", r.id, r);
export async function listResidents() {
  return (await readAll<Resident>("residents")).sort((a, b) => a.call_time.localeCompare(b.call_time));
}

export const getCall = (id: string) => read<CallRecord>("calls", id);
export const saveCall = (c: CallRecord) => write("calls", c.id, c);
/** Newest first. */
export async function listCalls(residentId?: string) {
  const calls = await readAll<CallRecord>("calls");
  return calls
    .filter((c) => !residentId || c.resident_id === residentId)
    .sort((a, b) => b.at.localeCompare(a.at));
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
 */
export async function resetDemoData() {
  await ensureSeeded();
  await Promise.all(["calls", "ladder", "pending", "tasks"].map((dir) => rm(path.join(/* turbopackIgnore: true */ DATA_DIR, dir), { recursive: true, force: true })));
  for (const current of await readAll<Resident>("residents")) {
    const seed = JSON.parse(
      await readFile(path.join(/* turbopackIgnore: true */ SEED_DIR, "residents", `${current.id}.json`), "utf8").catch(() => "null"),
    ) as Resident | null;
    if (seed) await saveResident({ ...current, facts: seed.facts, recent_calls: seed.recent_calls });
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
