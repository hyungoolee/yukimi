import { env } from "@/lib/env";
import { secondContactAnswered } from "@/lib/ladder";
import { reply, verifyLineSignature } from "@/lib/line";
import { getCall, getResident, listResidents, saveCall, saveResident } from "@/lib/store";
import type { Role } from "@/lib/types";

// A teammate adds the bot and sends "<role word> <REGISTER_CODE>" to take a role for every demo resident.
// The code stops a stranger who finds the bot from taking over a role.
const ROLE_WORDS: Record<string, Role> = {
  helper: "helper",
  民生委員: "helper",
  family: "second_contact",
  家族: "second_contact",
  volunteer: "snow_volunteer",
  除雪: "snow_volunteer",
};

export async function POST(request: Request) {
  const raw = await request.text();
  if (!verifyLineSignature(raw, request.headers.get("x-line-signature"), env("LINE_CHANNEL_SECRET"))) {
    return new Response("Invalid signature", { status: 401 });
  }

  for (const event of JSON.parse(raw).events ?? []) {
    const userId: string | undefined = event.source?.userId;

    if (event.type === "message" && event.message?.type === "text" && userId) {
      const [word, code] = event.message.text.trim().toLowerCase().split(/\s+/);
      const role = ROLE_WORDS[word];
      if (!role || code !== env("REGISTER_CODE")) {
        await reply(event.replyToken, "役割と登録コードを送ってください（例：家族 1234）");
        continue;
      }
      for (const resident of await listResidents()) {
        resident[role].line_id = userId;
        await saveResident(resident);
      }
      await reply(event.replyToken, `登録しました（${word}）`);
    }

    if (event.type === "postback") {
      const [kind, id] = String(event.postback.data).split(":");
      if (kind === "snow_accept") {
        const call = await getCall(id);
        const resident = call && (await getResident(call.resident_id));
        if (call && userId && resident?.snow_volunteer.line_id === userId) {
          await saveCall({ ...call, snow_accepted: true });
        }
      } else if (kind === "ok" || kind === "ng") {
        await secondContactAnswered(id, kind === "ok", userId);
      }
    }
  }
  return Response.json({ received: true });
}
