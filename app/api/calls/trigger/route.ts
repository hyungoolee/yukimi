import { placeCall } from "@/lib/elevenlabs";
import { hasAppSecret } from "@/lib/env";
import { missed } from "@/lib/ladder";
import { getResident } from "@/lib/store";

// Called by the daily timer or Hermes. The dashboard button uses a server action instead.
export async function POST(request: Request) {
  if (!hasAppSecret(request)) return new Response("Unauthorized", { status: 401 });
  const { resident_id } = await request.json();
  const resident = await getResident(resident_id);
  if (!resident) return new Response("Unknown resident", { status: 404 });
  if (!resident.phone) return new Response("Resident has no phone number", { status: 400 });
  try {
    return Response.json({ conversation_id: await placeCall(resident) });
  } catch (e) {
    // A check-in that could not be placed is a missed check-in.
    console.error(e);
    await missed(resident.id, 1);
    return new Response("Call could not be placed", { status: 502 });
  }
}
