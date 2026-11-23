"use server";

import { revalidatePath } from "next/cache";
import { placeCall } from "@/lib/elevenlabs";
import { getCall, getResident, saveCall } from "@/lib/store";

export async function callNow(formData: FormData) {
  const resident = await getResident(String(formData.get("resident_id")));
  if (resident) await placeCall(resident);
  revalidatePath("/");
}

export async function markHandled(formData: FormData) {
  const call = await getCall(String(formData.get("call_id")));
  if (call) await saveCall({ ...call, handled: true });
  revalidatePath("/");
}
