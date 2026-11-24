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
        // Filled in by ElevenLabs from the call's variables, not by the model.
        resident_id: { type: "string", dynamic_variable: "resident_id" },
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
      // Stand-in values for ElevenLabs' own test call, which doesn't go through our app.
      // A real call always sends its own (lib/elevenlabs.ts). The ID matches no resident on purpose,
      // so a test call can't write to a resident's history, start their ladder, or alert their family.
      dynamic_variables: {
        dynamic_variable_placeholders: {
          resident_id: "test",
          attempt: "1",
          name: "佐藤",
          introducer: "娘のゆきさん",
          facts: "孫の健太が大学受験中、庭でバラを育てている、ひざが少し悪い",
          recent_calls: "2026-11-25：元気。孫の健太の模試の結果を気にしていた。",
          follow_ups: "なし",
          weather: "今朝の最低気温は-12℃、この24時間の降雪は30センチ、積雪は62センチ",
          winter_check: "必要。暖房が動いているか、玄関から出られるか、食料と薬が足りているかを必ず確認する。",
        },
      },
      prompt: {
        prompt: readFileSync(new URL("./prompt.md", import.meta.url), "utf8"),
        // The fastest model that handles Japanese well; judge it on the M1 test call.
        llm: process.env.ELEVENLABS_LLM ?? "claude-haiku-5-5",
        // No thinking step: on the first test call it added 2–5 s before every reply.
        reasoning_effort: "none",
        tool_ids: [tool.id],
        timezone: "Asia/Tokyo",
      },
    },
    // Japanese needs one of the multilingual voice models.
    tts: { voice_id: need("ELEVENLABS_VOICE_ID"), model_id: process.env.ELEVENLABS_TTS_MODEL ?? "eleven_flash_v2_5" },
    // Seconds of silence before the agent prompts the resident again.
    turn: {
      turn_timeout: 10,
      // If a reply takes longer than this, say a short filler first, as a person would.
      soft_timeout_config: { timeout_seconds: 1.5, message: "はい…" },
    },
  },
  platform_settings: {
    // Only our server (with the API key) may start a conversation; knowing the agent ID is not enough.
    auth: { enable_auth: true },
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
