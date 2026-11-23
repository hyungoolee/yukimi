import { env } from "@/lib/env";
import { secondContactAnswered } from "@/lib/ladder";
import { reply, verifyLineSignature } from "@/lib/line";
import { getCall, listResidents, saveCall, saveResident } from "@/lib/store";
import type { Role } from "@/lib/types";

// A teammate adds the bot and sends one of these words to take a role for every demo resident.
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
      const role = ROLE_WORDS[event.message.text.trim().toLowerCase()];
      if (!role) {
        await reply(event.replyToken, "役割を送ってください：民生委員 / 家族 / 除雪");
        continue;
      }
      for (const resident of await listResidents()) {
        resident[role].line_id = userId;
        await saveResident(resident);
      }
      await reply(event.replyToken, `登録しました（${event.message.text.trim()}）`);
    }

    if (event.type === "postback") {
      const [kind, id] = String(event.postback.data).split(":");
      if (kind === "snow_accept") {
        const call = await getCall(id);
        if (call) await saveCall({ ...call, snow_accepted: true });
      } else if (kind === "ok" || kind === "ng") {
        await secondContactAnswered(id, kind === "ok");
      }
    }
  }
  return Response.json({ received: true });
}
