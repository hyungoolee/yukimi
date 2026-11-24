import { after } from "next/server";
import { runActions } from "@/lib/actions";
import { verifySignature } from "@/lib/elevenlabs";
import { env } from "@/lib/env";
import { missed } from "@/lib/ladder";
import { needsReview, processCall } from "@/lib/pipeline";
import { clearPending, getPending, getResident, saveCall } from "@/lib/store";
import type { Turn } from "@/lib/types";

export async function POST(request: Request) {
  const raw = await request.text();
  try {
    verifySignature(raw, request.headers.get("elevenlabs-signature"), env("ELEVENLABS_WEBHOOK_SECRET"));
  } catch {
    return new Response("Invalid signature", { status: 401 });
  }

  const { type, data } = JSON.parse(raw);
  // Other event types (audio, for one) are not ours to handle, and must not use up the pending entry.
  if (type !== "post_call_transcription" && type !== "call_initiation_failure") {
    return Response.json({ received: true });
  }

  // Who and which attempt: from the call's own variables, else from what we saved when placing it.
  const variables = data.conversation_initiation_client_data?.dynamic_variables;
  const pending = await getPending(data.conversation_id);
  await clearPending(data.conversation_id);
  const residentId: string | undefined = variables?.resident_id ?? pending?.resident_id;
  if (!residentId) return new Response("No resident for this conversation", { status: 422 });
  // A test call from ElevenLabs' console (agent/setup.ts placeholder): nothing to record.
  if (residentId === "test") return Response.json({ received: true });
  const attempt = Number(variables?.attempt) || pending?.attempt || 1;
  // A call taken in the browser has no phone to retry: a silent or abandoned one is simply dropped.
  const byPhone = variables?.channel !== "browser";

  // Answer ElevenLabs right away; the model call and LINE messages run after the response.
  after(async () => {
    try {
      if (type === "call_initiation_failure") {
        await missed(residentId, attempt);
      } else if (type === "post_call_transcription") {
        const transcript: Turn[] = (data.transcript ?? [])
          .filter((t: Turn) => t.message)
          .map((t: Turn) => ({ role: t.role, message: t.message }));
        // Nobody spoke: a silent pickup counts as a missed call.
        if (!transcript.some((t) => t.role === "user")) {
          if (byPhone) await missed(residentId, attempt);
        } else {
          // What this call's agent was told (lib/weather.ts describeWeather starts it with 必要 or 不要).
          const winterChecks = String(variables?.winter_check ?? "").startsWith("必要");
          await processCall(residentId, data.conversation_id, transcript, byPhone ? attempt : null, winterChecks);
        }
      }
    } catch (e) {
      // Never lose a call: record it for a person to read, beside (not over) anything already saved.
      console.error("Webhook processing failed", e);
      try {
        const id = `${data.conversation_id}-error`;
        const resident = await getResident(residentId);
        const rules = needsReview("通話の処理に失敗。確認してください");
        await saveCall({
          id,
          resident_id: residentId,
          at: new Date().toISOString(),
          kind: "call",
          risk: rules.risk,
          reasons: rules.reasons,
          actions: resident ? await runActions(resident, id, rules.risk, rules.reasons, rules.actions) : [],
          transcript: data.transcript,
        });
      } catch (again) {
        console.error("Could not record the failed call", again);
      }
    }
  });
  return Response.json({ received: true });
}
