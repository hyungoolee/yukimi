/**
 * Expressive mode (agent/setup.ts) lets the agent put audio tags such as [warmly] in what it says.
 * They shape the voice; they are not words, so they are taken out of transcripts and captions.
 */
export const stripAudioTags = (text: string) => text.replace(/\s*\[[^\]\n]{1,40}\]\s*/g, " ").trim();
