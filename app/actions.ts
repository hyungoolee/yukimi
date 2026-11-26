"use server";

import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";
import { acceptRequest } from "@/lib/actions";
import { browserCall, placeCall } from "@/lib/elevenlabs";
import { DEMO_MODE, dashboardAccess } from "@/lib/env";
import { missed } from "@/lib/ladder";
import { addFact, deleteFact, editFact, removeFollowUp, restoreFact, retireFact, setCareNotes } from "@/lib/memory";
import { isRequestKind, REQUESTS, slotChoices } from "@/lib/requests";
import { japanDate } from "@/lib/trends";
import type { Resident } from "@/lib/types";
import { translateNote, translateToEnglish } from "@/lib/translate";
import { clearLadder, getCall, getResident, resetDemoData, updateCall, updatePerson, updateResident } from "@/lib/store";

// Server actions are reachable on their own, so each checks the password too, not just the proxy.
async function requireAccess() {
  if (dashboardAccess((await headers()).get("authorization")) !== "ok") throw new Error("Unauthorized");
}

export async function callNow(formData: FormData) {
  await requireAccess();
  const resident = await getResident(String(formData.get("resident_id")));
  if (resident?.phone && resident.active !== false) {
    await placeCall(resident).catch((e) => {
      console.error(e);
      return missed(resident.id, 1);
    });
  }
  revalidatePath("/", "layout"); // the list and the resident's own page
}

export async function markHandled(formData: FormData) {
  await requireAccess();
  await updateCall(String(formData.get("call_id")), () => ({ handled: true }));
  revalidatePath("/", "layout");
}

/** Saves the number the check-in call goes to. Kept on the server's disk, never in the repo. */
export type PhoneResult = { status: "saved" | "invalid"; typed: string };

export async function savePhone(_previous: PhoneResult | undefined, formData: FormData): Promise<PhoneResult> {
  await requireAccess();
  const resident = await getResident(String(formData.get("resident_id")));
  // Accept 090-1234-5678, 011-…, +81 90…, and the common +81 090… slip; store +81….
  // Not 010…: that is no Japanese number (it is a Korean mobile prefix), so it needs its + country code.
  const typed = String(formData.get("phone"));
  const phone = typed
    .normalize("NFKC")
    .replace(/[\s-]/g, "")
    .replace(/^(\+81)?0(?!10)/, "+81");
  // International format only, e.g. +819012345678.
  // The typed text goes back, so the form keeps it on screen to be corrected.
  if (!resident || !(phone === "" || /^\+\d{8,15}$/.test(phone))) return { status: "invalid", typed };
  await updateResident(resident.id, (fresh) => ({ ...fresh, phone }));
  revalidatePath("/", "layout"); // the list's call button depends on it too
  return { status: "saved", typed: phone };
}

/** Places a resident's home pin, or their snow volunteer's pin, from the click-to-place map. */
export async function saveLocation(formData: FormData) {
  await requireAccess();
  const resident = await getResident(String(formData.get("resident_id")));
  const location = { lat: Number(formData.get("lat")), lng: Number(formData.get("lng")) };
  // Japan only; Number("") is 0, so an empty form is refused too.
  const inJapan = location.lat > 20 && location.lat < 46 && location.lng > 122 && location.lng < 154;
  if (!resident || !inJapan) return;

  if (formData.get("who") === "snow_helper") {
    // The pin belongs to the person, so it moves for every resident they help.
    if (resident.snow_helper.id) await updatePerson(resident.snow_helper.id, (p) => ({ ...p, location }));
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
  // A thrown error reaches the browser with its message removed in production. The reason is returned
  // instead, so the page can say what is wrong (a missing key, a refused request).
  return browserCall(resident).catch((e) => {
    console.error(e);
    return { error: e instanceof Error ? e.message : String(e) };
  });
}

/** Demo only: act as if today's call rang out, to show the missed-call ladder without a phone. */
export async function simulateNoAnswer(formData: FormData) {
  await requireAccess();
  if (DEMO_MODE) await missed(String(formData.get("resident_id")), 1);
  revalidatePath("/", "layout"); // the resident's page shows the ladder's stage
}

/** Demo only: act as if the person asked had tapped the first time slot, to show the rest without a phone in hand. */
export async function acceptDemo(formData: FormData) {
  await requireAccess();
  const callId = String(formData.get("call_id"));
  const kind = String(formData.get("kind"));
  const call = await getCall(callId);
  const resident = call && (await getResident(call.resident_id));
  if (DEMO_MODE && resident && isRequestKind(kind)) {
    await acceptRequest(callId, kind, resident[REQUESTS[kind].role].name, slotChoices()[0]);
  }
  revalidatePath("/", "layout");
}

/** The language toggle: remembers the choice in a cookie for a year. */
export async function setLanguage(formData: FormData) {
  const lang = formData.get("lang") === "en" ? "en" : "ja";
  (await cookies()).set("lang", lang, { maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  revalidatePath("/", "layout");
}

/** Stops or resumes the service for a resident. Stopping also ends any missed-call steps under way. */
export async function setActive(formData: FormData) {
  await requireAccess();
  const id = String(formData.get("resident_id"));
  const active = formData.get("active") === "1";
  // Resuming starts the schedule afresh, so today is not reported as a call the app failed to place.
  await updateResident(id, (fresh) => ({ ...fresh, active, scheduled_on: undefined, call_queued: undefined }));
  if (!active) await clearLadder(id);
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

/** English for one line of a live call, shown as a caption. Empty if the translation fails. */
export async function translateCaption(text: string) {
  await requireAccess();
  return translateToEnglish(text.slice(0, 1000)).catch((e) => {
    console.error("Caption translation failed", e);
    return "";
  });
}

// The helper's edits to what Yukimi remembers. The rules for each live in lib/memory.ts.
// Text the helper writes is translated once, here, for the English view (lib/translate.ts).
async function editMemory(formData: FormData, change: (resident: Resident, value: string, en: string) => Resident, translate = false) {
  await requireAccess();
  const residentId = String(formData.get("resident_id"));
  const value = String(formData.get("fact_id") ?? formData.get("text") ?? "");
  const en = translate ? await translateNote(String(formData.get("text") ?? "").trim().slice(0, 300)) : "";
  await updateResident(residentId, (r) => change(r, value, en));
  revalidatePath(`/residents/${residentId}`);
}

export const addFactAction = async (formData: FormData) => editMemory(formData, (r, text, en) => addFact(r, text, japanDate(), en), true);
export const retireFactAction = async (formData: FormData) => editMemory(formData, (r, id) => retireFact(r, id, japanDate()));
export const restoreFactAction = async (formData: FormData) => editMemory(formData, restoreFact);
export const deleteFactAction = async (formData: FormData) => editMemory(formData, deleteFact);
export const saveCareNotes = async (formData: FormData) => editMemory(formData, setCareNotes, true);
export const editFactAction = async (formData: FormData) =>
  editMemory(formData, (r, id, en) => editFact(r, id, String(formData.get("text") ?? ""), en), true);
