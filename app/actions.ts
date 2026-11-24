"use server";

import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";
import { volunteerKey } from "@/lib/dashboard";
import { browserCall, placeCall } from "@/lib/elevenlabs";
import { DEMO_MODE, dashboardAccess } from "@/lib/env";
import { missed } from "@/lib/ladder";
import { addFact, deleteFact, editFact, removeFollowUp, restoreFact, retireFact, setCareNotes } from "@/lib/memory";
import { japanDate } from "@/lib/trends";
import type { Resident } from "@/lib/types";
import { getCall, getResident, listResidents, resetDemoData, saveCall, updateResident } from "@/lib/store";

// Server actions are reachable on their own, so each checks the password too, not just the proxy.
async function requireAccess() {
  if (dashboardAccess((await headers()).get("authorization")) !== "ok") throw new Error("Unauthorized");
}

export async function callNow(formData: FormData) {
  await requireAccess();
  const resident = await getResident(String(formData.get("resident_id")));
  if (resident?.phone) {
    await placeCall(resident).catch((e) => {
      console.error(e);
      return missed(resident.id, 1);
    });
  }
  revalidatePath("/");
}

export async function markHandled(formData: FormData) {
  await requireAccess();
  const call = await getCall(String(formData.get("call_id")));
  if (call) await saveCall({ ...call, handled: true });
  revalidatePath("/");
}

/** Saves the number the check-in call goes to. Kept on the server's disk, never in the repo. */
export async function savePhone(formData: FormData) {
  await requireAccess();
  const resident = await getResident(String(formData.get("resident_id")));
  // Accept 090-1234-5678, 011-…, +81 90…, and the common +81 090… slip; store +81….
  // Not 010…: that is no Japanese number (it is a Korean mobile prefix), so it needs its + country code.
  const phone = String(formData.get("phone"))
    .normalize("NFKC")
    .replace(/[\s-]/g, "")
    .replace(/^(\+81)?0(?!10)/, "+81");
  // International format only, e.g. +819012345678.
  if (resident && (phone === "" || /^\+\d{8,15}$/.test(phone))) {
    await updateResident(resident.id, (fresh) => ({ ...fresh, phone }));
  }
  revalidatePath(`/residents/${resident?.id}`);
}

/** Places a resident's home pin, or their snow volunteer's pin, from the click-to-place map. */
export async function saveLocation(formData: FormData) {
  await requireAccess();
  const resident = await getResident(String(formData.get("resident_id")));
  const location = { lat: Number(formData.get("lat")), lng: Number(formData.get("lng")) };
  // Japan only; Number("") is 0, so an empty form is refused too.
  const inJapan = location.lat > 20 && location.lat < 46 && location.lng > 122 && location.lng < 154;
  if (!resident || !inJapan) return;

  if (formData.get("who") === "snow_volunteer") {
    // The volunteer sits in each resident's profile, as LINE registration writes them: update every copy.
    const key = volunteerKey(resident.snow_volunteer);
    for (const { id } of await listResidents()) {
      await updateResident(id, (fresh) =>
        key && volunteerKey(fresh.snow_volunteer) === key
          ? { ...fresh, snow_volunteer: { ...fresh.snow_volunteer, location } }
          : fresh,
      );
    }
  } else {
    await updateResident(resident.id, (fresh) => ({ ...fresh, location }));
  }
  revalidatePath(`/residents/${resident.id}`);
}

/** Starts a check-in call in this browser tab, for when there is no phone line. */
export async function startBrowserCall(residentId: string) {
  await requireAccess();
  const resident = await getResident(residentId);
  if (!resident) throw new Error("Unknown resident");
  return browserCall(resident);
}

/** Demo only: act as if today's call rang out, to show the missed-call ladder without a phone. */
export async function simulateNoAnswer(formData: FormData) {
  await requireAccess();
  if (DEMO_MODE) await missed(String(formData.get("resident_id")), 1);
  revalidatePath("/");
}

/** The language toggle: remembers the choice in a cookie for a year. */
export async function setLanguage(formData: FormData) {
  const lang = formData.get("lang") === "en" ? "en" : "ja";
  (await cookies()).set("lang", lang, { maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  revalidatePath("/", "layout");
}

/** Demo only: clear calls and ladders and restore the residents' seeded memory, for a clean rehearsal. */
export async function resetDemo() {
  await requireAccess();
  if (DEMO_MODE) await resetDemoData();
  revalidatePath("/", "layout");
}

/** The helper drops a follow-up that no longer needs asking. */
export async function deleteFollowUp(formData: FormData) {
  await requireAccess();
  const residentId = String(formData.get("resident_id"));
  await updateResident(residentId, (r) => removeFollowUp(r, String(formData.get("follow_up_id"))));
  revalidatePath(`/residents/${residentId}`);
}

// The helper's edits to what Yukimi remembers. The rules for each live in lib/memory.ts.
async function editMemory(formData: FormData, change: (resident: Resident, value: string) => Resident) {
  await requireAccess();
  const residentId = String(formData.get("resident_id"));
  const value = String(formData.get("fact_id") ?? formData.get("text") ?? "");
  await updateResident(residentId, (r) => change(r, value));
  revalidatePath(`/residents/${residentId}`);
}

export const addFactAction = async (formData: FormData) => editMemory(formData, (r, text) => addFact(r, text, japanDate()));
export const retireFactAction = async (formData: FormData) => editMemory(formData, (r, id) => retireFact(r, id, japanDate()));
export const restoreFactAction = async (formData: FormData) => editMemory(formData, restoreFact);
export const deleteFactAction = async (formData: FormData) => editMemory(formData, deleteFact);
export const saveCareNotes = async (formData: FormData) => editMemory(formData, setCareNotes);
export const editFactAction = async (formData: FormData) =>
  editMemory(formData, (r, id) => editFact(r, id, String(formData.get("text") ?? "")));
