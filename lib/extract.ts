import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { MEASURES, type Observations } from "./measures.ts";
import type { Extraction, Resident, Turn } from "./types";

const tri = z.enum(["yes", "no", "unknown"]);

const ExtractionSchema = z.object({
  answered_by_person: z.boolean(),
  summary: z.string(),
  notes: z.object({
    mood: z.string(),
    health: z.string(),
    winter: z.string(),
    needs: z.array(z.string()),
  }),
  // not_eating, pain and low_mood are not asked for here: code derives them from observations,
  // so the two can never disagree.
  signals: z.object({
    emergency: z.boolean(),
    self_harm: z.boolean(),
    fall_recent: z.boolean(),
    cant_move: z.boolean(),
    snowed_in: z.boolean(),
    heater_problem: z.boolean(),
    confused: z.boolean(),
    money_request: z.boolean(),
  }),
  // One field per daily measure (lib/measures.ts).
  observations: z.object(Object.fromEntries(MEASURES.map((m) => [m.field, tri]))),
  english: z.object({
    summary: z.string(),
    mood: z.string(),
    health: z.string(),
    winter: z.string(),
    needs: z.array(z.string()),
  }),
});

const SYSTEM = `You read the transcript of a daily check-in phone call between an AI caller ("agent") and an older person living alone in Hokkaido ("user"), and report what the resident said. A welfare volunteer reads your notes to decide whom to visit, and fixed rules turn your signals into alerts, so a missed signal means nobody goes to help.

Set answered_by_person to false when the "user" side is a voicemail or answering-machine greeting (留守番電話), a recorded announcement, or someone other than the resident who says the resident is not there. Otherwise set it to true.

Write summary and notes in Japanese. In english, give a faithful English translation of the summary and of each note, adding nothing. summary is one or two sentences the caller can refer to tomorrow.

Set each signal to true only when the resident's own words support it. When the resident corrects or denies something, go with the correction.
- emergency: describes something needing an ambulance now, such as chest pain, trouble breathing, or signs of a stroke.
- self_harm: talks about wanting to die or to end their life.
- fall_recent: slipped or fell today or in the last two days.
- cant_move: cannot stand up or walk right now.
- snowed_in: snow keeps them from opening the door or leaving the house.
- heater_problem: the heater is broken, or they are out of fuel.
- confused: wrong about the day or season, repeats the same story within the call, or does not recognize this service.
- money_request: someone else (a caller, visitor or message) asked them for money, a transfer, or bank or card details.

Each observation is "yes", "no" or "unknown", taken only from the resident's own words. Use "unknown" when the subject did not come up. When what they said points to the worrying answer, give that answer: do not soften it to "unknown". As with the signals, when the resident corrects or denies something, go with the correction.
${MEASURES.map((m) => `- ${m.ask}`).join("\n")}`;

/** Turns a call transcript into notes and yes/no signals. Throws if the model returns nothing usable. */
export async function extract(resident: Resident, transcript: Turn[]): Promise<Extraction> {
  const client = new Anthropic();
  const response = await client.messages.parse({
    model: "claude-opus-5-5",
    max_tokens: 16000,
    system: SYSTEM,
    messages: [
      {
        role: "user",
        // The resident's remembered facts are deliberately not given here: memory is curated by a
        // model, and nothing a model wrote should feed the step that decides alerts.
        content: `The resident is ${resident.name}さん.\n\nTranscript:\n${transcript
          .map((t) => `${t.role}: ${t.message}`)
          .join("\n")}`,
      },
    ],
    output_config: { format: zodOutputFormat(ExtractionSchema) },
  });
  if (!response.parsed_output) {
    throw new Error(`Extraction returned no output (stop_reason: ${response.stop_reason})`);
  }
  const { signals, ...rest } = response.parsed_output;
  const observations = rest.observations as Observations; // the schema above has exactly these fields
  return {
    ...rest,
    observations,
    signals: {
      ...signals,
      not_eating: observations.ate === "no",
      pain: observations.pain_or_injury === "yes",
      low_mood: observations.low_mood === "yes",
    },
  };
}
