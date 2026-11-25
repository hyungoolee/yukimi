import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

/** One spoken line of a check-in call, Japanese to English, for the live captions. */
export async function translateToEnglish(japanese: string): Promise<string> {
  const client = new Anthropic();
  const response = await client.messages.create({
    model: "claude-haiku-5-5", // captions need speed more than depth
    max_tokens: 1024,
    output_config: { effort: "low" },
    system:
      "You translate one line from a phone call between a check-in caller and an older person in Hokkaido, from Japanese into plain English. The line comes from speech recognition, so it may contain small errors; translate what was most likely said. Keep names as they are with their honorific, such as Sato-san. Reply with the English translation only, with no quotation marks around it.",
    messages: [{ role: "user", content: japanese }],
  });
  return response.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("").trim();
}

const memoryCache = new Map<string, string>(); // Japanese → English; memory text changes rarely

/**
 * English for what Yukimi remembers about a resident, for the dashboard's English view. Cached per text,
 * so only new or edited lines reach the model. Texts it couldn't translate are missing from the map.
 */
export async function translateMemory(texts: string[]): Promise<Map<string, string>> {
  const missing = [...new Set(texts)].filter((t) => t && !memoryCache.has(t));
  if (missing.length) {
    try {
      const response = await new Anthropic().messages.parse({
        model: "claude-haiku-5-5",
        max_tokens: 4096,
        output_config: { effort: "low", format: zodOutputFormat(z.object({ english: z.array(z.string()) })) },
        system:
          "You translate short notes a check-in service keeps about an older person living alone in Hokkaido, from Japanese into plain English. Keep names as they are with their honorific, such as Sato-san. Return one translation per note, in the same order, adding nothing.",
        messages: [{ role: "user", content: JSON.stringify(missing) }],
      });
      const english = response.parsed_output?.english;
      if (english?.length === missing.length) missing.forEach((t, i) => memoryCache.set(t, english[i]));
      else console.error("Memory translation returned the wrong number of lines");
    } catch (e) {
      console.error("Memory translation failed", e);
    }
  }
  return memoryCache;
}
