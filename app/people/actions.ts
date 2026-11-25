"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { eligible, ROLES, serves, SNOW_NEXT_SLOTS } from "@/lib/coverage";
import { dashboardAccess } from "@/lib/env";
import { push, text } from "@/lib/line";
import { addPerson, assign, assignFamilyIfVacant, deletePerson, getPerson, getResident, listResidents, renewCode, updatePerson } from "@/lib/store";

const TEST_MESSAGE = "【テスト】見守り電話からのテストメッセージです。対応は不要です。";

// Server actions are reachable on their own, so each checks the password too, not just the proxy.
async function requireAccess() {
  if (dashboardAccess((await headers()).get("authorization")) !== "ok") throw new Error("Unauthorized");
}
const field = (formData: FormData, name: string) => String(formData.get(name) ?? "").normalize("NFKC").trim().slice(0, 60);

export async function createPerson(formData: FormData) {
  await requireAccess();
  const name = field(formData, "name");
  if (!name) return;
  const person = await addPerson(name, field(formData, "phone") || undefined, undefined, formData.get("business") === "on" ? "business" : undefined);
  redirect(`/people/${person.id}`);
}

/** A family contact belongs to one resident, and fills that resident's family post if it is vacant. */
export async function createFamily(formData: FormData) {
  await requireAccess();
  const name = field(formData, "name");
  const resident = await getResident(field(formData, "resident_id"));
  if (!name || !resident) return;
  const person = await addPerson(name, undefined, resident.id);
  await assignFamilyIfVacant(resident.id, person.id);
  redirect(`/people/${person.id}`);
}

export async function editPerson(formData: FormData) {
  await requireAccess();
  const name = field(formData, "name");
  if (!name) return;
  const coordinator = formData.get("coordinator") === "on" || undefined;
  const kind = formData.get("business") === "on" ? ("business" as const) : undefined;
  await updatePerson(field(formData, "person_id"), (p) => ({ ...p, name, phone: field(formData, "phone") || undefined, coordinator, kind }));
  revalidatePath("/", "layout");
}

/** Only someone who serves nobody can be removed, so no resident is left pointing at a missing person. */
export async function removePerson(formData: FormData) {
  await requireAccess();
  const id = field(formData, "person_id");
  if ((await listResidents()).some((r) => serves(r, id))) return;
  await deletePerson(id);
  redirect("/people");
}

/**
 * Who holds a resident's roles, and who is asked to clear snow after the first person (snow_next_<place>).
 * Only the roles and places in the form change, so a page open since before someone else filled a post
 * doesn't clear it. An empty choice leaves the post vacant.
 * Returns whether it saved, since the menus save on change and have no button to show a failure.
 */
export async function assignRoles(formData: FormData) {
  await requireAccess();
  const resident = await getResident(field(formData, "resident_id"));
  if (!resident) return false;
  const roles: Record<string, string> = {};
  for (const role of ROLES) {
    if (!formData.has(role)) continue;
    const id = field(formData, role);
    const person = id ? await getPerson(id) : null;
    if (id && !(person && eligible(person, role, resident))) return false;
    roles[role] = id;
  }
  // A place in the snow line that changed: that place only, the rest kept as stored. Then in order,
  // each person once, never the one first in line, and only someone who could hold the snow role for
  // this resident (not another resident's family). An empty choice empties the place.
  const places = Array.from({ length: SNOW_NEXT_SLOTS }, (_, i) => `snow_next_${i}`).filter((name) => formData.has(name));
  if (!places.length) {
    await assign(resident.id, roles);
    revalidatePath("/", "layout");
    return true;
  }
  const line = Array.from({ length: SNOW_NEXT_SLOTS }, (_, i) => resident.snow_next?.[i]?.id ?? "");
  const chosen = roles.snow_volunteer ? [roles.snow_volunteer] : [];
  for (const name of places) {
    const id = field(formData, name);
    const person = id ? await getPerson(id) : null;
    if (id && !(person && eligible(person, "snow_volunteer", resident))) return false;
    line[Number(name.slice("snow_next_".length))] = id;
    if (id) chosen.push(id);
  }
  const first = roles.snow_volunteer ?? resident.snow_volunteer.id ?? "";
  const snow_next = line.filter((id, i) => id && id !== first && line.indexOf(id) === i);
  // Only who was chosen in this save counts as agreed to as paid help (lib/store.ts assign).
  await assign(resident.id, { ...roles, snow_next }, chosen);
  revalidatePath("/", "layout");
  return true;
}

export async function newCode(formData: FormData) {
  await requireAccess();
  await renewCode(field(formData, "person_id"));
  revalidatePath("/", "layout");
}

/** For a changed phone or a wrong registration: forget the LINE account and hand out a fresh code. */
export async function unregister(formData: FormData) {
  await requireAccess();
  const id = field(formData, "person_id");
  await updatePerson(id, (p) => ({ ...p, line_id: undefined }));
  await renewCode(id);
  revalidatePath("/", "layout");
}

export type TestResult = { status: "sent" | "failed" } | undefined;

/** Sends one test message. The LINE ID is looked up here, so it never goes to the browser. */
export async function sendTestMessage(_previous: TestResult, formData: FormData): Promise<TestResult> {
  await requireAccess();
  const person = await getPerson(field(formData, "person_id"));
  const sent = await push(person?.line_id, [text(TEST_MESSAGE)]);
  return { status: sent ? "sent" : "failed" };
}
