import { env } from "@/lib/env";
import { secondContactAnswered } from "@/lib/ladder";
import { reply, verifyLineSignature } from "@/lib/line";
import { getCall, getResident, listPeople, updateCall, updatePerson } from "@/lib/store";

export async function POST(request: Request) {
  const raw = await request.text();
  if (!verifyLineSignature(raw, request.headers.get("x-line-signature"), env("LINE_CHANNEL_SECRET"))) {
    return new Response("Invalid signature", { status: 401 });
  }

  for (const event of JSON.parse(raw).events ?? []) {
    const userId: string | undefined = event.source?.userId;

    if (event.type === "message" && event.message?.type === "text" && userId) {
      // Each person has their own code, shown on their page. Japanese keyboards often type full-width digits.
      const code = event.message.text.normalize("NFKC").trim();
      const match = /^\d{8}$/.test(code) && (await listPeople()).find((p) => p.code === code);
      // Checked again inside the update, so a code can't register two people who send it at once.
      const person = match && (await updatePerson(match.id, (p) => (p.code === code ? { ...p, line_id: userId, code: undefined } : null)));
      await reply(event.replyToken, person ? `登録しました（${person.name}さん）` : "登録コード（8けたの数字）を送ってください");
    }

    if (event.type === "postback") {
      const [kind, id] = String(event.postback.data).split(":");
      if (kind === "snow_accept") {
        const call = await getCall(id);
        const resident = call && (await getResident(call.resident_id));
        if (call && userId && resident?.snow_volunteer.line_id === userId) {
          await updateCall(id, () => ({ snow_accepted: true }));
        }
      } else if (kind === "ack") {
        // Someone who was sent the red alert says they've seen it: stop sending it again.
        const call = await getCall(id);
        const resident = call && (await getResident(call.resident_id));
        const who = resident && [resident.helper, resident.second_contact].find((c) => userId && c.line_id === userId);
        if (call && who) {
          // The first person to tap is recorded; anyone after is told who already has it.
          const mine = await updateCall(id, (c) => (c.acknowledged_by ? null : { acknowledged_by: who.name }));
          const by = mine?.acknowledged_by ?? (await getCall(id))?.acknowledged_by;
          await reply(event.replyToken, mine ? "確認を記録しました。ありがとうございます。" : `${by}さんが確認済みです。`);
        }
      } else if (kind === "ok" || kind === "ng") {
        await secondContactAnswered(id, kind === "ok", userId);
      }
    }
  }
  return Response.json({ received: true });
}
