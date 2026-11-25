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
    "Call at once when the resident describes a medical emergency or talks about wanting to die. Alerts their family and welfare volunteer, and returns the exact wording to read out. Never call it to report how the call went, to pass on a message, or when the resident is well: it tells them to phone an ambulance.",
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

// SCRATCH=1 makes or updates a throwaway copy of the agent, for trying new instructions with
// `SIM_AGENT_ID=<id> pnpm simulate`. It leaves the live agent and the shared tool as they are.
// Pass SCRATCH_AGENT_ID=<id> to update the copy made last time instead of making another.
const scratch = !!process.env.SCRATCH; // any value: a typo must never fall through to the live agent
// The copy gets a tool of its own (SCRATCH_TOOL_ID to reuse one), so a new description can be tried too.
const toolId = scratch ? process.env.SCRATCH_TOOL_ID : process.env.ELEVENLABS_TOOL_ID;
const tool = toolId
  ? await call("PATCH", `/tools/${toolId}`, { tool_config: toolConfig })
  : await call("POST", "/tools", { tool_config: toolConfig });

const agentConfig = {
  name: scratch ? "Yukimi check-in (scratch)" : "Yukimi check-in",
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
          care_notes: "なし",
          briefing: "なし",
          weather: "今朝の最低気温は-12℃、この24時間の降雪は30センチ、積雪は62センチ",
          winter_check: "必要。暖房が動いているか、玄関から出られるか、食料・薬・灯油が足りているかを必ず確認する。",
          help_status: "なし",
          call_length: "ふつう",
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

const agentId = scratch ? process.env.SCRATCH_AGENT_ID : process.env.ELEVENLABS_AGENT_ID;
const agent = agentId
  ? await call("PATCH", `/agents/${agentId}`, agentConfig)
  : await call("POST", "/agents/create", agentConfig);

// The news agent: a short call telling the resident that someone has said when they will come
// (lib/actions.ts newsStep). A separate agent rather than overrides on the check-in agent, whose
// browser-call token must not be able to replace its instructions. Same voice, tool and webhook.
const newsConfig = {
  ...agentConfig,
  name: scratch ? "Yukimi news (scratch)" : "Yukimi news",
  conversation_config: {
    ...agentConfig.conversation_config,
    agent: {
      ...agentConfig.conversation_config.agent,
      first_message: "もしもし、{{name}}さんですか。見守り電話です。お知らせがあって、お電話しました。{{news}}",
      dynamic_variables: {
        dynamic_variable_placeholders: {
          resident_id: "test",
          name: "佐藤",
          news: "山本さんが今日の午後に雪かきに伺います。",
          purpose: "news",
          call_id: "test",
          request_kind: "snow",
        },
      },
      prompt: { ...agentConfig.conversation_config.agent.prompt, prompt: readFileSync(new URL("./news.md", import.meta.url), "utf8") },
    },
  },
};
const newsId = scratch ? process.env.SCRATCH_NEWS_AGENT_ID : process.env.ELEVENLABS_NEWS_AGENT_ID;
const news = newsId
  ? await call("PATCH", `/agents/${newsId}`, newsConfig)
  : await call("POST", "/agents/create", newsConfig);

// A copy's ids are printed under their own names, so they are never pasted into .env as the live ones.
const prefix = scratch ? "SCRATCH" : "ELEVENLABS";
console.log(`${prefix}_TOOL_ID=${tool.id}`);
console.log(`${prefix}_AGENT_ID=${agent.agent_id}`);
console.log(`${prefix}_NEWS_AGENT_ID=${news.agent_id}`);
