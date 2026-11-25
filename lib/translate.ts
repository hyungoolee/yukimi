import Anthropic from "@anthropic-ai/sdk";

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

/** English for a note the helper wrote about a resident, stored beside it. "" if the translation fails. */
export async function translateNote(japanese: string): Promise<string> {
  if (!japanese) return "";
  try {
    const response = await new Anthropic().messages.create({
      model: "claude-haiku-5-5",
      max_tokens: 1024,
      output_config: { effort: "low" },
      system:
        "You translate a short note a check-in service keeps about an older person living alone in Hokkaido, from Japanese into plain English. Keep names as they are with their honorific, such as Sato-san. Reply with the English translation only, adding nothing.",
      messages: [{ role: "user", content: japanese }],
    });
    return response.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("").trim();
  } catch (e) {
    console.error("Note translation failed", e);
    return "";
  }
}
