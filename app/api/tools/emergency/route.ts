import { sendAlert } from "@/lib/actions";
import { hasAppSecret } from "@/lib/env";
import { CRISIS_MESSAGE, EMERGENCY_MESSAGE } from "@/lib/fixed";
import { getResident, saveCall } from "@/lib/store";
import type { Role } from "@/lib/types";

// The agent calls this during a call. It alerts people at once and returns the wording to read out.
export async function POST(request: Request) {
  if (!hasAppSecret(request)) return new Response("Unauthorized", { status: 401 });
  const { resident_id, kind, detail } = await request.json();
  const resident = await getResident(resident_id);
  if (!resident) return new Response("Unknown resident", { status: 404 });

  const selfHarm = kind === "self_harm";
  const to: Role[] = selfHarm ? ["helper"] : ["helper", "second_contact"];
  const reasons = [`${selfHarm ? "死にたい気持ちの訴え" : "緊急の訴え（119番を案内）"}：${detail ?? ""}`];
  const sent = await sendAlert(resident, to, reasons);
  await saveCall({
    id: `emergency-${Date.now()}`,
    resident_id,
    at: new Date().toISOString(),
    kind: "emergency",
    risk: "red",
    reasons,
    actions: [{ type: "alert", to, sent }],
  });
  return Response.json({ say_exactly: selfHarm ? CRISIS_MESSAGE : EMERGENCY_MESSAGE });
}
