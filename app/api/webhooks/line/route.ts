import { env } from "@/lib/env";
import { secondContactAnswered } from "@/lib/ladder";
import { acceptRequest, declineRequest } from "@/lib/actions";
import { reply, verifyLineSignature } from "@/lib/line";
import { askedHelpers, helpers, isRequestKind, openRequests, passed, slotLabel } from "@/lib/requests";
import { getCall, getResident, listCalls, listPeople, updateCall, updatePerson } from "@/lib/store";

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
      const [kind, id, ...rest] = String(event.postback.data).split(":");
      // "accept:<request>:<kind>:<date>:<am|pm>", where <request> is the call that first asked.
      // "snow_accept:<call>" is the button from before there were time slots.
      const [requestKind, date, part] = kind === "snow_accept" ? ["snow"] : rest;
      if ((kind === "accept" || kind === "snow_accept") && isRequestKind(requestKind)) {
        const call = await getCall(id);
        const resident = call && (await getResident(call.resident_id));
        // Whoever holds the role, or someone further down the line the request has been sent to.
        const person = resident && userId
          ? askedHelpers(resident, await listCalls(resident.id), requestKind, id).find((c) => c.line_id === userId)
          : undefined;
        if (resident && userId && person) {
          const slot = /^\d{4}-\d\d-\d\d$/.test(date ?? "") && (part === "am" || part === "pm") ? { date, part } as const : undefined;
          // A later call may have sent a reminder: the answer goes on the newest record of this same request.
          const open = openRequests(resident, await listCalls(resident.id)).find((r) => r.kind === requestKind && r.requestId === id);
          if (!open) {
            await reply(event.replyToken, "この件はもう済んでいます。ありがとうございます。");
          } else if (slot && passed(slot, new Date())) {
            // The buttons were set when the message went out; that half-day is over now.
            await reply(event.replyToken, "その時間は過ぎています。ほかの時間を押してください。");
          } else {
            const { mine, request } = await acceptRequest(open.callId, requestKind, person.name, slot, person.kind === "business");
            const when = request?.slot ? `${slotLabel(request.slot)}で` : "";
            await reply(
              event.replyToken,
              mine ? `${resident.name}さん宅、${when}承りました。ありがとうございます。` : "すでに引き受け済みです。ありがとうございます。",
            );
          }
        }
      } else if (kind === "decline" && isRequestKind(rest[0])) {
        // "decline:<request>:<kind>": the person asked can't come. Only theirs to say while it is their turn.
        const call = await getCall(id);
        const resident = call && (await getResident(call.resident_id));
        if (resident && userId) {
          const open = openRequests(resident, await listCalls(resident.id)).find((r) => r.kind === rest[0] && r.requestId === id);
          const current = open && !open.exhausted ? helpers(resident, open.kind)[open.asked] : undefined;
          const theirs = !!current && current.line_id === userId && (!open!.askedId || current.id === open!.askedId);
          const passed = theirs && open!.status === "sent" && (await declineRequest(resident, open!));
          await reply(
            event.replyToken,
            passed
              ? "承知しました。ほかの方にお願いします。ありがとうございます。"
              : open?.status === "accepted"
                ? "すでに引き受け手が決まっています。ありがとうございます。"
                : "この件はもう済んでいます。ありがとうございます。",
          );
        }
      } else if (kind === "ack") {
        // Someone who was sent the red alert says they've seen it: stop sending it again.
        const call = await getCall(id);
        const resident = call && (await getResident(call.resident_id));
        // The resident's own people, or a coordinator: they are told when nobody else has answered.
        const who = resident && userId && [resident.helper, resident.second_contact, ...(await listPeople()).filter((p) => p.coordinator)]
          .find((c) => c.line_id === userId);
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
