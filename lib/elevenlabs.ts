import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "./env";
import { savePending } from "./store";
import type { Resident } from "./types";
import { describeWeather, getWeather } from "./weather";

/** Ask ElevenLabs to phone the resident. attempt 2 is the missed-call retry. */
export async function placeCall(resident: Resident, attempt = 1) {
  const weather = describeWeather(await getWeather(resident.amedas_station));
  const res = await fetch("https://api.elevenlabs.io/v1/convai/twilio/outbound-call", {
    method: "POST",
    headers: { "xi-api-key": env("ELEVENLABS_API_KEY"), "content-type": "application/json" },
    body: JSON.stringify({
      agent_id: env("ELEVENLABS_AGENT_ID"),
      agent_phone_number_id: env("ELEVENLABS_PHONE_NUMBER_ID"),
      to_number: resident.phone,
      conversation_initiation_client_data: {
        dynamic_variables: {
          resident_id: resident.id,
          name: resident.name,
          introducer: resident.introducer,
          facts: resident.facts.join("、"),
          recent_calls: resident.recent_calls.map((c) => `${c.date}：${c.summary}`).join(" / ") || "なし",
          ...weather,
        },
      },
    }),
  });
  const body = await res.json();
  if (!res.ok || !body.conversation_id) {
    throw new Error(`ElevenLabs outbound call failed (${res.status}): ${JSON.stringify(body)}`);
  }
  await savePending(body.conversation_id, { resident_id: resident.id, attempt });
  return body.conversation_id as string;
}

/** Checks the ElevenLabs-Signature header ("t=<unix>,v0=<hex hmac>"). Throws if invalid. */
export function verifySignature(rawBody: string, header: string | null, secret: string) {
  const values = Object.fromEntries((header ?? "").split(",").map((part) => part.split("=", 2)));
  const timestamp = values.t;
  if (!timestamp || Math.abs(Date.now() / 1000 - Number(timestamp)) > 30 * 60) {
    throw new Error("Stale webhook signature");
  }
  const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest();
  const received = Buffer.from(values.v0 ?? "", "hex");
  if (received.length !== expected.length || !timingSafeEqual(expected, received)) {
    throw new Error("Invalid webhook signature");
  }
}
