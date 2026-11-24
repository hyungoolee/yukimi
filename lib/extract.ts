import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
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
  observations: z.object({
    ate: tri,
    slept_well: tri,
    went_out: tri,
    pain_or_injury: tri,
    low_mood: tri,
  }),
  new_facts: z.array(z.string()),
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

Write summary, notes and new_facts in Japanese. In english, give a faithful English translation of the summary and of each note, adding nothing. summary is one or two sentences the caller can refer to tomorrow. new_facts are lasting personal details not already in the known facts (family, hobbies, health conditions, routines); leave it empty if there are none.

Set each signal to true only when the resident's own words support it. When the resident corrects or denies something, go with the correction.
- emergency: describes something needing an ambulance now, such as chest pain, trouble breathing, or signs of a stroke.
- self_harm: talks about wanting to die or to end their life.
- fall_recent: slipped or fell today or in the last two days.
- cant_move: cannot stand up or walk right now.
- snowed_in: snow keeps them from opening the door or leaving the house.
- heater_problem: the heater is broken, or they are out of fuel.
- confused: wrong about the day or season, repeats the same story within the call, or does not recognize this service.
- money_request: someone else (a caller, visitor or message) asked them for money, a transfer, or bank or card details.

Each observation covers the time since yesterday's call. Answer "yes" or "no" only from the resident's own words, and "unknown" when it did not come up or the answer is unclear. Never guess: "unknown" is always safe, a wrong "no" is not.
- ate: "no" when they have not eaten today, or say they are not eating or have been skipping meals. "yes" when they say they have eaten. When the only thing they say is that they have not had breakfast yet this morning, answer "unknown".
- slept_well: "no" when they say they slept badly or could not sleep last night; "yes" when they say they slept well.
- went_out: "yes" when they say they have been outside the house since yesterday's call; "no" when they say they have not.
- pain_or_injury: "yes" when they report physical pain or an injury now, including an injury that does not hurt (swelling, a bruise, a cut). "no" when they say nothing hurts.
- low_mood: "yes" when they say they are lonely, hopeless, or that there is no point. "no" when they say they feel well or cheerful.`;

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
        content: `Known facts about ${resident.name}さん: ${[`紹介者は${resident.introducer}`, ...resident.facts].join("、")}\n\nTranscript:\n${transcript
          .map((t) => `${t.role}: ${t.message}`)
          .join("\n")}`,
      },
    ],
    output_config: { format: zodOutputFormat(ExtractionSchema) },
  });
  if (!response.parsed_output) {
    throw new Error(`Extraction returned no output (stop_reason: ${response.stop_reason})`);
  }
  const { signals, observations, ...rest } = response.parsed_output;
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
