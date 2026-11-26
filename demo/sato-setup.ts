// Creates or updates the AI Sato-san for the demo video: an ElevenLabs agent that answers Yukimi's
// browser call from /demo/sato. Demo only; it leaves the Yukimi agents as they are.
// Run: pnpm demo:sato   (prints ELEVENLABS_SATO_AGENT_ID; add it to .env, and rerun after editing demo/sato.md)
import { readFileSync } from "node:fs";

const need = (name: string) => {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable ${name}`);
  return v;
};

const config = {
  name: "Sato-san (demo actor)",
  conversation_config: {
    agent: {
      language: "ja",
      // Empty: she waits for Yukimi's first line, as someone picking up the phone would.
      first_message: "",
      prompt: {
        prompt: readFileSync(new URL("./sato.md", import.meta.url), "utf8"),
        llm: process.env.ELEVENLABS_LLM ?? "claude-haiku-5-5",
        reasoning_effort: "none",
      },
    },
    tts: {
      voice_id: need("ELEVENLABS_SATO_VOICE_ID"),
      model_id: "eleven_v3_conversational",
      speed: 0.85,
      expressive_mode: true,
    },
    // Patient, and never filling a silence herself: the two agents talking over each other is the main risk.
    turn: { turn_eagerness: "patient", turn_timeout: 30, initial_wait_time: 30 },
  },
  // Started only with a token from our server (app/actions.ts startSatoCall).
  platform_settings: { auth: { enable_auth: true } },
};

const id = process.env.ELEVENLABS_SATO_AGENT_ID;
const res = await fetch(`https://api.elevenlabs.io/v1/convai/agents/${id ?? "create"}`, {
  method: id ? "PATCH" : "POST",
  headers: { "xi-api-key": need("ELEVENLABS_API_KEY"), "content-type": "application/json" },
  body: JSON.stringify(config),
});
const json = await res.json();
if (!res.ok) throw new Error(`Sato agent setup failed (${res.status}): ${JSON.stringify(json)}`);
console.log(`ELEVENLABS_SATO_AGENT_ID=${json.agent_id}`);
