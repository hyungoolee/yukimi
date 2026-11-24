import { after } from "next/server";
import { sendAlert } from "@/lib/actions";
import { hasAppSecret } from "@/lib/env";
import { CRISIS_MESSAGE, EMERGENCY_MESSAGE } from "@/lib/fixed";
import { push, text } from "@/lib/line";
import { listResidents, saveCall } from "@/lib/store";
import type { Role } from "@/lib/types";

// The agent calls this during a call. It always returns the wording to read out, at once;
// the alert goes out right after the response so a slow LINE can't hold up the call.
export async function POST(request: Request) {
  if (!hasAppSecret(request)) return new Response("Unauthorized", { status: 401 });
  const { resident_id, kind, detail } = await request.json().catch(() => ({}));
  const selfHarm = kind === "self_harm";
  after(() =>
    alertPeople(String(resident_id ?? "").trim(), selfHarm, String(detail ?? "")).catch((e) =>
      console.error("Emergency alert failed", e),
    ),
  );
  return Response.json({ say_exactly: selfHarm ? CRISIS_MESSAGE : EMERGENCY_MESSAGE });
}

async function alertPeople(who: string, selfHarm: boolean, detail: string) {
  const what = selfHarm ? "死にたい気持ちの訴え" : "緊急の訴え（119番を案内）";
  const residents = await listResidents();
  const resident = residents.find((r) => r.id === who || r.name === who.replace(/さん$/, ""));

  if (!resident) {
    // We can't tell whose call this is, so every helper hears about it.
    const helpers = [...new Set(residents.map((r) => r.helper.line_id).filter(Boolean))];
    const message = text(`【要確認】通話中の方から${what}：${detail}（利用者を特定できませんでした：${who || "ID不明"}）`);
    await Promise.all(helpers.map((to) => push(to, [message])));
    return;
  }

  const to: Role[] = selfHarm ? ["helper"] : ["helper", "second_contact"];
  const reasons = [`${what}：${detail}`];
  const sent = await sendAlert(resident, to, reasons);
  await saveCall({
    id: `emergency-${Date.now()}`,
    resident_id: resident.id,
    at: new Date().toISOString(),
    kind: "emergency",
    risk: "red",
    reasons,
    actions: [{ type: "alert", to, sent }],
  });
}
