# Yukimi

Winter check-in calls for older residents of Hokkaido. Hackathon MVP; all residents are fictional.

```bash
cp .env.example .env   # copy, don't rename: the template stays in the repo
pnpm install
pnpm dev
```

- `pnpm test`: rules and webhook replays, with the model call mocked.
- `pnpm eval`: ten scripted residents through the real extraction and rules. Needs `ANTHROPIC_API_KEY`; costs one model call each.

## Setup checklist

Deploy the `Dockerfile` on a host with a persistent disk mounted at `/data`. Set every value from `.env` on the host too, except `DATA_DIR`. Always set `DASHBOARD_PASSWORD` on a public deploy: without it, anyone with the address can change phone numbers and place calls. `APP_URL` is the public address with `https://` and no trailing slash.

1. **ElevenLabs:** create an API key and choose a Japanese voice (`ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`).
2. **Post-call webhook:** in ElevenLabs, create one pointing at `<APP_URL>/api/webhooks/elevenlabs` (`ELEVENLABS_WEBHOOK_ID`, `ELEVENLABS_WEBHOOK_SECRET`).
3. **Agent:** run `pnpm agent:setup`. It prints `ELEVENLABS_TOOL_ID` and `ELEVENLABS_AGENT_ID`; add both to `.env` and the host. Run it again after editing `agent/prompt.md`.
4. **Twilio:** buy a voice number, enable Japan under Voice geo permissions, and import the number into ElevenLabs (`ELEVENLABS_PHONE_NUMBER_ID`).
5. **LINE:** create a Messaging API channel with webhook `<APP_URL>/api/webhooks/line` (`LINE_CHANNEL_ACCESS_TOKEN`, `LINE_CHANNEL_SECRET`). Turn off the channel's auto-reply.
6. **Roles:** each teammate adds the bot and sends a role word with `REGISTER_CODE`, e.g. `家族 1234`. Words: `民生委員` (helper), `家族` (second contact), `除雪` (snow volunteer).
7. **Phone number:** open a resident on the dashboard and save the number to call, in international format (`+81…`).
8. **First call:** press 今すぐ電話.
9. **Map (optional):** the dashboard's 地図 view shows residents and snow volunteers. Place each pin from the resident's page, under 地図上の位置. The base map is 国土地理院's tiles; keep the credit visible.

No phone line yet? Skip steps 4 and 7: open a resident and press ブラウザで通話 to take the call in the browser tab. With `DEMO_MODE=1`, 電話に出ない（デモ） starts the missed-call ladder as if the call rang out.

For the demo, set `DEMO_MODE=1` (the missed-call ladder runs in under a minute) and `WEATHER_SOURCE=saved` (uses `data/seed/weather.json`).
