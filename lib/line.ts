import { createHmac, timingSafeEqual } from "node:crypto";

const API = "https://api.line.me/v2/bot/message";

async function send(path: string, body: object): Promise<boolean> {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) {
    console.warn("LINE_CHANNEL_ACCESS_TOKEN is not set; message not sent", JSON.stringify(body));
    return false;
  }
  try {
    const res = await fetch(`${API}/${path}`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000), // a stalled LINE must not hold up other residents' alerts
    });
    if (!res.ok) console.error(`LINE ${path} failed (${res.status})`, await res.text());
    return res.ok;
  } catch (e) {
    console.error(`LINE ${path} failed`, e);
    return false;
  }
}

/** Returns false when the message could not be sent (no LINE ID, no token, or LINE refused it). */
export async function push(to: string | undefined, messages: object[]) {
  if (!to) return false;
  return send("push", { to, messages });
}

export const reply = (replyToken: string, text: string) =>
  send("reply", { replyToken, messages: [{ type: "text", text }] });

export const text = (t: string) => ({ type: "text", text: t });

/** A message with tap-to-answer buttons. Each tap comes back to /api/webhooks/line as a postback. */
export const buttons = (body: string, actions: { label: string; data: string }[]) => ({
  type: "template",
  altText: body,
  template: {
    type: "buttons",
    text: body,
    actions: actions.map((a) => ({ type: "postback", label: a.label, data: a.data, displayText: a.label })),
  },
});

export function verifyLineSignature(rawBody: string, header: string | null, secret: string) {
  const expected = createHmac("sha256", secret).update(rawBody).digest();
  const received = Buffer.from(header ?? "", "base64");
  return received.length === expected.length && timingSafeEqual(expected, received);
}
