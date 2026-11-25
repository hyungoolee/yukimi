"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { eligible, ROLES } from "@/lib/coverage";
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
  const person = await addPerson(name, field(formData, "phone") || undefined);
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
  await updatePerson(field(formData, "person_id"), (p) => ({ ...p, name, phone: field(formData, "phone") || undefined, coordinator }));
  revalidatePath("/", "layout");
}

/** Only someone who serves nobody can be removed, so no resident is left pointing at a missing person. */
export async function removePerson(formData: FormData) {
  await requireAccess();
  const id = field(formData, "person_id");
  if ((await listResidents()).some((r) => ROLES.some((role) => r[role].id === id))) return;
  await deletePerson(id);
  redirect("/people");
}

/** Who holds each of a resident's three roles. An empty choice leaves the post vacant. */
/** Returns whether it saved, since the menus save on change and have no button to show a failure. */
export async function assignRoles(formData: FormData) {
  await requireAccess();
  const resident = await getResident(field(formData, "resident_id"));
  if (!resident) return false;
  const roles: Record<string, string> = {};
  for (const role of ROLES) {
    const id = field(formData, role);
    const person = id ? await getPerson(id) : null;
    if (id && !(person && eligible(person, role, resident))) return false;
    roles[role] = id;
  }
  await assign(resident.id, roles);
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
