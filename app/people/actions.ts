"use server";

import { headers } from "next/headers";
import { dashboardAccess } from "@/lib/env";
import { strings } from "@/lib/i18n";
import { push, text } from "@/lib/line";
import { getResident } from "@/lib/store";
import type { Role } from "@/lib/types";

export type TestResult = { status: "sent" | "failed" } | undefined;

/**
 * Sends one test message to a person on file. The form names where they are on file (a resident and
 * a role); the LINE ID is looked up here, so it never goes to the browser.
 */
export async function sendTestMessage(_previous: TestResult, formData: FormData): Promise<TestResult> {
  // Server actions are reachable on their own, so this checks the password too, not just the proxy.
  if (dashboardAccess((await headers()).get("authorization")) !== "ok") throw new Error("Unauthorized");
  const resident = await getResident(String(formData.get("resident_id")));
  const role = String(formData.get("role")) as Role;
  const contact = resident && ["helper", "second_contact", "snow_volunteer"].includes(role) ? resident[role] : undefined;
  const sent = await push(contact?.line_id, [text(strings.ja.testMessage)]);
  return { status: sent ? "sent" : "failed" };
}
