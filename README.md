# Yukimi

Winter check-in calls for older residents of Hokkaido. Hackathon MVP; all residents are fictional.

```bash
cp .env.example .env   # copy, don't rename: the template stays in the repo
pnpm install
pnpm dev
```

- `pnpm test`: rules and webhook replays, with the model call mocked.
- `pnpm eval`: scripted calls and a multi-day trend through the real extraction and rules. Requires `ANTHROPIC_API_KEY` and makes one model call per scripted conversation.

The resident page shows observations across seven Japan dates. A meal trend alerts the helper and family on its first qualifying day and every third qualifying observation day thereafter, once per Japan date. Persistent alert tasks retain the reasons intended for each recipient.

## Setup checklist

Deploy the `Dockerfile` on a host with a persistent disk mounted at `/data`. Set every value from `.env` on the host too, except `DATA_DIR`. Always set `DASHBOARD_PASSWORD` on a public deploy: without it, anyone with the address can change phone numbers and place calls. `APP_URL` is the public address with `https://` and no trailing slash.

1. **ElevenLabs:** create an API key and choose a Japanese voice (`ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`; we use Hiyori, `AP6mVmGgRkbG5mCR7fCS`).
2. **Post-call webhook:** in ElevenLabs, create one pointing at `<APP_URL>/api/webhooks/elevenlabs` (`ELEVENLABS_WEBHOOK_ID`, `ELEVENLABS_WEBHOOK_SECRET`).
3. **Agent:** run `pnpm agent:setup`. It prints `ELEVENLABS_TOOL_ID`, `ELEVENLABS_AGENT_ID` and `ELEVENLABS_NEWS_AGENT_ID`; add all three to `.env` and the host. Run it again after editing `agent/prompt.md` or `agent/news.md`.
   **Order matters when the prompt gains a `{{variable}}`:** the deployed app must already be sending that variable, or calls may fail and the missed-call ladder will alert families. So deploy the app first, confirm it is live, then run `pnpm agent:setup`. To undo, go in reverse: check out the previous `agent/` and run `pnpm agent:setup` to restore the old prompt, then roll the app back. **Exception:** once the app stores facts as objects (`lib/resident.ts`), an older app cannot read the resident files it has rewritten in `DATA_DIR/residents`, so do not roll back past that release: fix forward, or restore the resident files from a copy taken before it.
4. **Twilio:** buy a voice number, enable Japan under Voice geo permissions, and import the number into ElevenLabs (`ELEVENLABS_PHONE_NUMBER_ID`).
5. **LINE:** create a Messaging API channel with webhook `<APP_URL>/api/webhooks/line` (`LINE_CHANNEL_ACCESS_TOKEN`, `LINE_CHANNEL_SECRET`). Turn off the channel's auto-reply.
6. **People:** on the dashboard's 連絡体制 page (`/people`), add helpers and snow helpers. Then assign them on each resident's page under 設定, and add family there with 家族を追加. This fills the family role if it’s vacant. Each person’s page shows an 8-digit code they send to the LINE bot to register.
   **More than one snow helper:** a snow request offers only what is left of today, since she can't get out now. Each resident can have up to three people in line for snow clearing, asked in order; when one taps 行けません (can't come), or doesn't take the request in an hour, the next is asked, and the coordinators hear when the line runs out. Tick 事業者（有料） on a person's page for a business that charges. Put a business in a resident's line, in the resident's settings, only once the family has agreed to it; choosing it there is the agreement, per resident. Someone already in a line who is ticked as a business afterwards is not asked for that resident until they are chosen again in that resident's settings, and the settings say so. Once agreed, it is asked like anyone else when its turn comes, and the family gets a LINE message saying so. When it accepts, the family's usual message about who is coming names it as paid. The price is settled between the family and the business; the app handles no payment. Each request works through the line as it stood when it started, so a change to the line applies to the next request; to make it count for one already under way, press 「今の順番で最初から頼み直す」 on the resident's page.
7. **Phone number:** open a resident on the dashboard and save the number to call, in international format (`+81…`).
8. **First call:** press 今すぐ電話.
9. **Map (optional):** the dashboard's 地図 view shows residents and snow volunteers. Place each pin from the resident's page, under 地図上の位置. The base map is 国土地理院's tiles; keep the credit visible.

No phone line yet? Skip steps 4 and 7: open a resident and press ブラウザで通話 to take the call in the browser tab. With `DEMO_MODE=1`, 電話に出ない（デモ） starts the missed-call ladder as if the call rang out.

For the demo, set `DEMO_MODE=1` (the missed-call ladder runs in under a minute) and `WEATHER_SOURCE=saved` (uses `data/seed/weather.json`). To record a morning at any hour, also set `DEMO_JAPAN_HOUR=9`: the app reads Japan time as 9 o'clock when the server starts, and the clock runs on from there. Never set `DEMO_MODE=1` on a deployment that calls real residents: every call becomes a short demo call with a lighter health check.
