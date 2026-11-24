import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "./env";
import { savePending } from "./store";
import type { Resident } from "./types";
import { describeWeather, getWeather } from "./weather";

/** What the agent is told about this call: who it is, what we remember, and this morning's weather. */
async function callVariables(resident: Resident, attempt: number) {
  return {
    resident_id: resident.id,
    attempt: String(attempt),
    name: resident.name,
    introducer: resident.introducer,
    facts: resident.facts.join("、"),
    recent_calls: resident.recent_calls.map((c) => `${c.date}：${c.summary}`).join(" / ") || "なし",
    ...describeWeather(await getWeather(resident.amedas_station)),
  };
}

/** Ask ElevenLabs to phone the resident. attempt 2 is the missed-call retry. */
export async function placeCall(resident: Resident, attempt = 1) {
  const res = await fetch("https://api.elevenlabs.io/v1/convai/twilio/outbound-call", {
    method: "POST",
    headers: { "xi-api-key": env("ELEVENLABS_API_KEY"), "content-type": "application/json" },
    body: JSON.stringify({
      agent_id: env("ELEVENLABS_AGENT_ID"),
      agent_phone_number_id: env("ELEVENLABS_PHONE_NUMBER_ID"),
      to_number: resident.phone,
      conversation_initiation_client_data: { dynamic_variables: await callVariables(resident, attempt) },
    }),
  });
  const body = await res.json();
  if (!res.ok || !body.conversation_id) {
    throw new Error(`ElevenLabs outbound call failed (${res.status}): ${JSON.stringify(body)}`);
  }
  await savePending(body.conversation_id, { resident_id: resident.id, attempt });
  return body.conversation_id as string;
}

/** A one-time token and the call's variables, for a call taken in the browser instead of on a phone. */
export async function browserCall(resident: Resident) {
  const res = await fetch(
    `https://api.elevenlabs.io/v1/convai/conversation/token?agent_id=${env("ELEVENLABS_AGENT_ID")}`,
    { headers: { "xi-api-key": env("ELEVENLABS_API_KEY") } },
  );
  const body = await res.json();
  if (!res.ok || !body.token) throw new Error(`ElevenLabs token request failed (${res.status})`);
  return { token: body.token as string, variables: await callVariables(resident, 1) };
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
