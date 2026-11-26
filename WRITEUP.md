# Yukimi: a winter check-in call for older people living alone in Hokkaido

**Category:** Winter-proof

## The problem

Every winter, older people living alone in Hokkaido face heavy snow, deep cold and icy roads on their own. When something goes wrong, the danger isn't only the snow. Nobody notices in time, and they rarely ask for help. Their family may be in Tokyo, the volunteer welfare commissioner (minsei-iin) looks after dozens of people, and the neighbour who would happily clear the snow is never asked. In Sapporo alone, about 122,000 households are someone aged 65 or over living alone (2020 census), and 1,887 people were taken to hospital after falling on snowy roads in winter 2023–24, a record.

## What Yukimi does

Every morning, Yukimi phones each resident in Japanese.

- **A friendly call, not a checklist.** The voice agent chats like someone the resident knows. It remembers things about them, such as a grandson's exams or the roses in the garden, and follows up on them.
- **A winter check on heavy-snow or freezing days.** Using live weather data from the Japan Meteorological Agency (JMA), it asks whether the heating works, whether they can get out of the front door, and whether they have enough food, medicine and kerosene.
- **It turns the call into action.** After the call, the transcript is read for health, mood and winter needs, and fixed rules set a risk level: red means check now, yellow means visit soon. The right people are told on LINE: the family, the welfare commissioner, or a snow volunteer.
- **It asks for help so the resident doesn't have to.** If they can't get out, Yukimi sends a snow-clearing request on LINE to up to three helpers, in order. The first to accept picks a time, and Yukimi calls the resident back to say who is coming. When food, medicine or kerosene runs low, it asks the family to bring supplies in the same way. Paid snow-clearing businesses can join the list once the family agrees.
- **Nobody falls through the cracks.** If the resident doesn't answer, Yukimi calls again, then asks the family on LINE whether they're all right. If nobody can confirm, it sends a red alert. If they describe an emergency during a call, Yukimi tells them to call 119 and alerts their contacts at once.
- **It spots patterns over the week.** For example, if someone has been skipping meals over several days, their helper and family are told.

Coordinators get a dashboard in Japanese and English, with a list ranked by risk and a map of residents and snow volunteers.

## How it's built

- **Calls:** ElevenLabs Conversational AI with a Japanese voice, over Twilio, or in the browser
- **Understanding calls:** Claude (Anthropic) for structured extraction, memory curation and caption translation. The risk decisions are plain code, not the model.
- **Messaging:** the LINE Messaging API, with tap-to-respond buttons for helpers and family
- **Weather:** JMA AMeDAS live observations
- **App:** Next.js and TypeScript, storing data as JSON files on disk, deployed with Docker
- **Tests:** about 280 tests (Vitest), plus scripted evaluations against the real voice agent

## What's real and what's demo-only

- **Real:** the voice calls, the extraction, the rules, the memory, the LINE alerts and requests, the missed-call steps, the live weather, the dashboard and the map.
- **Demo settings:** `DEMO_MODE` shortens calls and runs the missed-call steps in under a minute. `WEATHER_SOURCE=saved` uses a fixed snowy morning (−12°C, 30 cm overnight).
- **Fictional:** all residents, including Sato-san from our video, are fictional. Yukimi has not been tested with real residents yet.

## What's next

- Pilot it with a district social welfare council (shakyo) and its welfare commissioners.
- Connect with kerosene and grocery delivery services directly.
- Learn each resident's normal patterns, so changes stand out sooner.
