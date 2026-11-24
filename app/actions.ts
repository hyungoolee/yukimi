"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { placeCall } from "@/lib/elevenlabs";
import { dashboardAccess } from "@/lib/env";
import { missed } from "@/lib/ladder";
import { getCall, getResident, listResidents, saveCall, saveResident } from "@/lib/store";

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
    await saveResident({ ...resident, phone });
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
    const sameVolunteer = (await listResidents()).filter((r) => r.snow_volunteer.name === resident.snow_volunteer.name);
    for (const r of sameVolunteer) await saveResident({ ...r, snow_volunteer: { ...r.snow_volunteer, location } });
  } else {
    await saveResident({ ...resident, location });
  }
  revalidatePath(`/residents/${resident.id}`);
}
