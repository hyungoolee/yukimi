// Creates or updates the ElevenLabs agent and its emergency tool from this folder.
// Run: node --env-file=.env agent/setup.ts
// Field names are checked against the ElevenLabs API reference, but this has not yet run
// against the live API: read any error it prints on first use.
import { readFileSync } from "node:fs";

const need = (name: string) => {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable ${name}`);
  return v;
};

const API = "https://api.elevenlabs.io/v1/convai";
const headers = { "xi-api-key": need("ELEVENLABS_API_KEY"), "content-type": "application/json" };

async function call(method: string, path: string, body: object) {
  const res = await fetch(`${API}${path}`, { method, headers, body: JSON.stringify(body) });
  const json = await res.json();
  if (!res.ok) throw new Error(`${method} ${path} failed (${res.status}): ${JSON.stringify(json)}`);
  return json;
}

const toolConfig = {
  type: "webhook",
  name: "report_emergency",
  description:
    "Call at once when the resident describes a medical emergency or talks about wanting to die. Alerts their family and welfare volunteer, and returns the exact wording to read out.",
  api_schema: {
    url: `${need("APP_URL")}/api/tools/emergency`,
    method: "POST",
    request_headers: { "x-app-secret": need("APP_SECRET") },
    request_body_schema: {
      type: "object",
      properties: {
        resident_id: { type: "string", description: "The resident's ID from the system prompt" },
        kind: { type: "string", enum: ["emergency", "self_harm"], description: "Which kind of emergency" },
        detail: { type: "string", description: "What the resident said, in Japanese, in one sentence" },
      },
      required: ["resident_id", "kind", "detail"],
    },
  },
};

const toolId = process.env.ELEVENLABS_TOOL_ID;
const tool = toolId
  ? await call("PATCH", `/tools/${toolId}`, { tool_config: toolConfig })
  : await call("POST", "/tools", { tool_config: toolConfig });

const agentConfig = {
  name: "Yukimi check-in",
  conversation_config: {
    agent: {
      language: "ja",
      first_message: "もしもし、{{name}}さんですか。おはようございます。{{introducer}}からご紹介いただいた、見守り電話です。",
      prompt: {
        prompt: readFileSync(new URL("./prompt.md", import.meta.url), "utf8"),
        // The fastest model that handles Japanese well; judge it on the M1 test call.
        llm: process.env.ELEVENLABS_LLM ?? "claude-haiku-5-5",
        tool_ids: [tool.id],
        timezone: "Asia/Tokyo",
      },
    },
    // Japanese needs one of the multilingual voice models.
    tts: { voice_id: need("ELEVENLABS_VOICE_ID"), model_id: process.env.ELEVENLABS_TTS_MODEL ?? "eleven_flash_v2_5" },
    // Older callers pause; wait longer before deciding they have finished.
    turn: { turn_timeout: 10 },
  },
  platform_settings: {
    workspace_overrides: {
      webhooks: {
        post_call_webhook_id: need("ELEVENLABS_WEBHOOK_ID"),
        events: ["transcript", "call_initiation_failure"],
      },
    },
  },
};

const agentId = process.env.ELEVENLABS_AGENT_ID;
const agent = agentId
  ? await call("PATCH", `/agents/${agentId}`, agentConfig)
  : await call("POST", "/agents/create", agentConfig);

console.log(`ELEVENLABS_TOOL_ID=${tool.id}`);
console.log(`ELEVENLABS_AGENT_ID=${agent.agent_id}`);
