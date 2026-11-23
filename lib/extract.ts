import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import type { Extraction, Resident, Turn } from "./types";

const ExtractionSchema = z.object({
  answered_by_person: z.boolean(),
  summary: z.string(),
  notes: z.object({
    mood: z.string(),
    health: z.string(),
    winter: z.string(),
    needs: z.array(z.string()),
  }),
  signals: z.object({
    emergency: z.boolean(),
    self_harm: z.boolean(),
    fall_recent: z.boolean(),
    pain: z.boolean(),
    cant_move: z.boolean(),
    snowed_in: z.boolean(),
    heater_problem: z.boolean(),
    not_eating: z.boolean(),
    confused: z.boolean(),
    money_request: z.boolean(),
    low_mood: z.boolean(),
  }),
  new_facts: z.array(z.string()),
});

const SYSTEM = `You read the transcript of a daily check-in phone call between an AI caller ("agent") and an older person living alone in Hokkaido ("user"), and report what the resident said. A welfare volunteer reads your notes to decide whom to visit, and fixed rules turn your signals into alerts, so a missed signal means nobody goes to help.

Set answered_by_person to false when the "user" side is a voicemail or answering-machine greeting (留守番電話), a recorded announcement, or someone other than the resident who says the resident is not there. Otherwise set it to true.

Write summary, notes and new_facts in Japanese. summary is one or two sentences the caller can refer to tomorrow. new_facts are lasting personal details not already in the known facts (family, hobbies, health conditions, routines); leave it empty if there are none.

Set each signal to true only when the resident's own words support it. When the resident corrects or denies something, go with the correction.
- emergency: describes something needing an ambulance now, such as chest pain, trouble breathing, or signs of a stroke.
- self_harm: talks about wanting to die or to end their life.
- fall_recent: slipped or fell today or in the last two days.
- pain: reports physical pain or an injury now.
- cant_move: cannot stand up or walk right now.
- snowed_in: snow keeps them from opening the door or leaving the house.
- heater_problem: the heater is broken, or they are out of fuel.
- not_eating: has not eaten today, or says they are not eating.
- confused: wrong about the day or season, repeats the same story within the call, or does not recognize this service.
- money_request: someone else (a caller, visitor or message) asked them for money, a transfer, or bank or card details.
- low_mood: says they are lonely, hopeless, or that there is no point.`;

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
  return response.parsed_output;
}
