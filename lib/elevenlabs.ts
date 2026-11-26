import { createHmac, timingSafeEqual } from "node:crypto";
import { DEMO_MODE, env } from "./env";
import { briefingLine } from "./briefing";
import { DEMO_CALL, NORMAL_CALL } from "./call-length";
import { careNotesLine, factsLine, followUpsLine, threadsLine } from "./memory";
import { helpLine } from "./requests";
import { listCalls, savePending } from "./store";
import type { Resident } from "./types";
import { describeWeather, getWeather } from "./weather";

/** The greeting for the time of day in Japan, said in the agent's first line. */
export function greeting(d = new Date()) {
  const hour = Number(d.toLocaleString("en-US", { timeZone: "Asia/Tokyo", hour: "numeric", hourCycle: "h23" }));
  return hour < 11 ? "おはようございます" : hour < 18 ? "こんにちは" : "こんばんは";
}

/** What the agent is told about this call: who it is, what we remember, and this morning's weather. */
async function callVariables(resident: Resident, attempt: number) {
  // If the history can't be read, the call still goes out, just without what it would have added.
  const calls = await listCalls(resident.id).catch(() => null);
  return {
    resident_id: resident.id,
    attempt: String(attempt),
    name: resident.name,
    introducer: resident.introducer,
    facts: factsLine(resident),
    care_notes: careNotesLine(resident),
    follow_ups: followUpsLine(resident),
    threads: threadsLine(resident),
    briefing: calls ? briefingLine(calls) : "なし",
    help_status: calls ? helpLine(resident, calls) : "なし",
    // A demo runs the same checks in a minute or two.
    call_length: DEMO_MODE ? DEMO_CALL : NORMAL_CALL,
    greeting: greeting(),
    ...describeWeather(await getWeather(resident.amedas_station)),
  };
}

/** Whether a call's variables told its agent to run the winter checks (lib/weather.ts describeWeather). */
export const toldToRunWinterChecks = (variables: { winter_check?: unknown }) => String(variables.winter_check ?? "").startsWith("必要");

async function outboundCall(resident: Resident, clientData: object, agentId = env("ELEVENLABS_AGENT_ID")) {
  const res = await fetch("https://api.elevenlabs.io/v1/convai/twilio/outbound-call", {
    signal: AbortSignal.timeout(15_000),
    method: "POST",
    headers: { "xi-api-key": env("ELEVENLABS_API_KEY"), "content-type": "application/json" },
    body: JSON.stringify({
      agent_id: agentId,
      agent_phone_number_id: env("ELEVENLABS_PHONE_NUMBER_ID"),
      to_number: resident.phone,
      conversation_initiation_client_data: clientData,
    }),
  });
  const body = await res.json();
  if (!res.ok || !body.conversation_id) {
    throw new Error(`ElevenLabs outbound call failed (${res.status}): ${JSON.stringify(body)}`);
  }
  return body.conversation_id as string;
}

/** Ask ElevenLabs to phone the resident. attempt 2 is the missed-call retry. */
export async function placeCall(resident: Resident, attempt = 1) {
  const variables = await callVariables(resident, attempt);
  const id = await outboundCall(resident, { dynamic_variables: variables });
  await savePending(id, { resident_id: resident.id, attempt, winter_checks: toldToRunWinterChecks(variables) });
  return id;
}

/**
 * A short call that only tells the resident that someone is coming (lib/actions.ts newsStep), placed by
 * the news agent (agent/news.md). `purpose: "news"` tells the post-call webhook this is not a check-in.
 */
export async function placeNewsCall(resident: Resident, news: string, request: { call_id: string; request_kind: string }) {
  const variables = { resident_id: resident.id, name: resident.name, news, purpose: "news", ...request };
  const id = await outboundCall(resident, { dynamic_variables: variables }, env("ELEVENLABS_NEWS_AGENT_ID"));
  // Counted as a call in progress, so no other call rings her phone at the same time.
  await savePending(id, { resident_id: resident.id, attempt: 1, news: request });
  return id;
}

/** A one-time token and the call's variables, for a call taken in the browser instead of on a phone. */
export async function browserCall(resident: Resident) {
  const res = await fetch(
    `https://api.elevenlabs.io/v1/convai/conversation/token?agent_id=${env("ELEVENLABS_AGENT_ID")}`,
    { headers: { "xi-api-key": env("ELEVENLABS_API_KEY") } },
  );
  const body = await res.json();
  if (!res.ok || !body.token) throw new Error(`ElevenLabs token request failed (${res.status})`);
  return { token: body.token as string, variables: { ...(await callVariables(resident, 1)), channel: "browser" } };
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
