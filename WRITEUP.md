# Yukimi: a winter check-in call for older people living alone in Hokkaido

**Category:** Winter-proof

## The problem

Older people living alone in Hokkaido face heavy snow, deep cold and icy roads on their own every winter. In Sapporo alone, about 122,000 households are someone aged 65 or over living alone (2020 census). In winter 2023–24, a record 1,887 people in the city were taken to hospital after falling on snowy roads.

Today they rely on people who can't be there every day:

- **Family:** often far away, for example in Tokyo, calling at weekends.
- **Welfare commissioners (minsei-iin):** volunteers who each look after dozens of people and visit once or twice a month.
- **Neighbours and snow volunteers:** they would help, but only if asked, and many older people don't want to be a bother.

So when the heating fails, the kerosene runs low, the front door is snowed in or someone falls, the danger isn't only the weather. Nobody finds out in time, and the person rarely asks for help.

## What we built

Yukimi phones each resident every morning in Japanese, and turns what they say into action by the right person.

- **A friendly daily call.** A voice agent chats like someone the resident knows. It remembers things about them, such as a grandson's exams or the roses in the garden, and follows up on them.
- **A winter check on heavy-snow or freezing days,** using live weather data from the Japan Meteorological Agency (JMA): is the heating working, can they get out of the front door, do they have enough food, medicine and kerosene?
- **A risk level and alerts.** After each call, the transcript is read for health, mood and winter needs. Fixed rules set a risk level (red means check now, yellow means visit soon), and the family and welfare commissioner are told on LINE.
- **It asks for help so the resident doesn't have to.** If they can't get out, Yukimi sends a snow-clearing request on LINE to up to three volunteers, in order. The first to accept taps a time, and Yukimi calls the resident back to say who is coming. When food, medicine or kerosene runs low, it asks the family to bring supplies in the same way.
- **Nobody is missed.**
  - If the resident doesn't answer, Yukimi calls again, then asks the family on LINE whether they're all right. If nobody can confirm, it sends a red alert.
  - If they describe an emergency during the call, Yukimi tells them to call 119 and alerts their contacts immediately.
- **It spots patterns over the week,** such as meals skipped over several days.
- **A dashboard for coordinators** in Japanese and English: residents ranked by risk, a map of residents and snow volunteers, and each resident's call history and memory.

**The AI part:**
- **The voice agent** holds a natural Japanese conversation.
- **A language model** turns each call transcript into structured observations, such as falls, pain, meals, whether they can get out, and supplies.
- **The model also curates the resident's memory:** facts to keep, and things to follow up on in the next call.
- **The decisions are plain code.** Who gets alerted, and how urgently, is set by tested rules, not by the model, so the escalation stays predictable and auditable.

## How it works

- **Voice calls:** ElevenLabs Conversational AI, with a Japanese voice and a fast Claude model as the agent's LLM. Calls go over the phone through Twilio, or in the browser for demos. The agent has an emergency tool that triggers an immediate alert.
- **After the call:** ElevenLabs sends a webhook to the app. Claude (Anthropic API) extracts structured observations, against a Zod schema, and proposes memory changes. Rules in TypeScript set the risk level and decide who to alert.
- **Messaging:** the LINE Messaging API, with tap-to-respond buttons for volunteers and family. The app works through each resident's list of volunteers and sends reminders when nobody responds.
- **Data sources:** JMA AMeDAS live observations (snowfall, snow depth, low temperature) and the GSI (国土地理院) map tiles.
- **App:** Next.js and TypeScript, with data stored as JSON files on a persistent disk, deployed with Docker.
- **Quality:**
  - About 280 automated tests (Vitest), including replays of recorded webhooks.
  - Scripted evaluations through the real extraction and rules.
  - Simulated conversations against the live voice agent.

All residents in the demo are fictional. `DEMO_MODE` shortens calls and the missed-call timings, and the saved weather fixes a snowy morning (−12°C, 30 cm overnight). Everything else runs as it would for real.

## What's next

- **A pilot with a social welfare council (shakyo)** and its welfare commissioners in one district, starting with a handful of residents and their families.
- **Consent and privacy:** consent from residents and families, a clear policy on call recordings and data, and Japanese hosting.
- **Safety review:** the emergency and escalation rules reviewed with care professionals, and a person on call during the pilot.
- **Production setup:** a Japanese phone number, a database instead of files, and monitoring.
- **Partners:** links with kerosene and grocery delivery services and paid snow-clearing businesses, which the app already supports with the family's agreement.

## Prior work

None. The repository was started after kickoff (first commit on 24 November), and all the code was written during the event. It uses open-source libraries (Next.js, React, Zod, Leaflet, Tailwind) and the ElevenLabs, Anthropic and LINE SDKs and APIs.

## Main AI tools

- **Claude Code,** for writing and reviewing most of the code.
- **Claude models (Anthropic API),** for call extraction, memory curation and caption translation, and as the LLM behind the voice agent.
- **ElevenLabs Conversational AI,** for the Japanese voice agent.
