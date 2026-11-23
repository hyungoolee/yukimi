import { placeCall } from "@/lib/elevenlabs";
import { hasAppSecret } from "@/lib/env";
import { getResident } from "@/lib/store";

// Called by the daily timer or Hermes. The dashboard button uses a server action instead.
export async function POST(request: Request) {
  if (!hasAppSecret(request)) return new Response("Unauthorized", { status: 401 });
  const { resident_id } = await request.json();
  const resident = await getResident(resident_id);
  if (!resident) return new Response("Unknown resident", { status: 404 });
  return Response.json({ conversation_id: await placeCall(resident) });
}
