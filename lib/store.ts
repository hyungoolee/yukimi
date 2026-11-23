import { cp, mkdir, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { Resident } from "./types";

const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), ".data");
const SEED_DIR = path.join(process.cwd(), "data", "seed");
const residentsDir = path.join(DATA_DIR, "residents");

// First run on an empty disk: copy the fictional seed residents in.
async function ensureSeeded() {
  const existing = await readdir(residentsDir).catch(() => []);
  if (existing.length > 0) return;
  await mkdir(DATA_DIR, { recursive: true });
  await cp(SEED_DIR, DATA_DIR, { recursive: true });
}

export async function listResidents(): Promise<Resident[]> {
  await ensureSeeded();
  const files = (await readdir(residentsDir)).filter((f) => f.endsWith(".json"));
  const residents = await Promise.all(
    files.map(async (f) => JSON.parse(await readFile(path.join(residentsDir, f), "utf8")) as Resident),
  );
  return residents.sort((a, b) => a.call_time.localeCompare(b.call_time));
}
