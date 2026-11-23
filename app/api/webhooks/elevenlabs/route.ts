import { verifySignature } from "@/lib/elevenlabs";
import { env } from "@/lib/env";
import { missed } from "@/lib/ladder";
import { processCall } from "@/lib/pipeline";
import { clearLadder, takePending } from "@/lib/store";
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

  if (type === "call_initiation_failure") {
    if (pending) await missed(pending.resident_id, pending.attempt);
  } else if (type === "post_call_transcription") {
    const residentId: string | undefined =
      data.conversation_initiation_client_data?.dynamic_variables?.resident_id ?? pending?.resident_id;
    if (!residentId) return new Response("No resident for this conversation", { status: 422 });

    const transcript: Turn[] = (data.transcript ?? [])
      .filter((t: Turn) => t.message)
      .map((t: Turn) => ({ role: t.role, message: t.message }));

    // Nobody spoke: an answering machine or a silent pickup counts as a missed call.
    if (!transcript.some((t) => t.role === "user")) {
      await missed(residentId, pending?.attempt ?? 1);
    } else {
      await clearLadder(residentId);
      await processCall(residentId, data.conversation_id, transcript);
    }
  }
  return Response.json({ received: true });
}
