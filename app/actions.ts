"use server";

import { revalidatePath } from "next/cache";
import { placeCall } from "@/lib/elevenlabs";
import { missed } from "@/lib/ladder";
import { getCall, getResident, saveCall, saveResident } from "@/lib/store";

export async function callNow(formData: FormData) {
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
  const call = await getCall(String(formData.get("call_id")));
  if (call) await saveCall({ ...call, handled: true });
  revalidatePath("/");
}

/** Saves the number the check-in call goes to. Kept on the server's disk, never in the repo. */
export async function savePhone(formData: FormData) {
  const resident = await getResident(String(formData.get("resident_id")));
  // Strip spaces and hyphens, and the leading 0 people often keep after +81.
  const phone = String(formData.get("phone")).replace(/[\s-]/g, "").replace(/^\+810/, "+81");
  // International format only, e.g. +819012345678.
  if (resident && (phone === "" || /^\+\d{8,15}$/.test(phone))) {
    await saveResident({ ...resident, phone });
  }
  revalidatePath(`/residents/${resident?.id}`);
}
