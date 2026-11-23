import { after } from "next/server";
import { runActions } from "@/lib/actions";
import { verifySignature } from "@/lib/elevenlabs";
import { env } from "@/lib/env";
import { missed } from "@/lib/ladder";
import { needsReview, processCall } from "@/lib/pipeline";
import { getResident, saveCall, takePending } from "@/lib/store";
import type { Turn } from "@/lib/types";

export async function POST(request: Request) {
  const raw = await request.text();
  try {
    verifySignature(raw, request.headers.get("elevenlabs-signature"), env("ELEVENLABS_WEBHOOK_SECRET"));
  } catch {
    return new Response("Invalid signature", { status: 401 });
  }

  const { type, data } = JSON.parse(raw);
  const pending = await takePending(data.conversation_id);
  const residentId: string | undefined =
    data.conversation_initiation_client_data?.dynamic_variables?.resident_id ?? pending?.resident_id;
  if (!residentId) return new Response("No resident for this conversation", { status: 422 });
  const attempt = pending?.attempt ?? 1;

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
        if (!transcript.some((t) => t.role === "user")) await missed(residentId, attempt);
        else await processCall(residentId, data.conversation_id, transcript, attempt);
      }
    } catch (e) {
      // Never lose a call: record it for a person to read.
      console.error("Webhook processing failed", e);
      const resident = await getResident(residentId);
      const rules = needsReview("通話の処理に失敗。確認してください");
      await saveCall({
        id: data.conversation_id,
        resident_id: residentId,
        at: new Date().toISOString(),
        kind: "call",
        risk: rules.risk,
        reasons: rules.reasons,
        actions: resident ? await runActions(resident, data.conversation_id, rules.reasons, rules.actions) : [],
        transcript: data.transcript,
      });
    }
  });
  return Response.json({ received: true });
}
