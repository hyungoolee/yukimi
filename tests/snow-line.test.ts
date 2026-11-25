import { createHmac } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Action } from "@/lib/types";

// More than one person in line for snow clearing: volunteers and businesses, asked in order.
// LINE is replaced; the store, the request steps, the scheduler and the LINE webhook are real.
const { checkRequest, runActions } = await import("@/lib/actions");
const { askedHelpers, helpLine, openRequests } = await import("@/lib/requests");
const { coverage } = await import("@/lib/coverage");
const { mapData, rankedRows, snowRequest } = await import("@/lib/dashboard");
const { strings } = await import("@/lib/i18n");
const store = await import("@/lib/store");
const { runDue } = await import("@/lib/tick");
const { POST: line } = await import("@/app/api/webhooks/line/route");

const pushed: { to: string; text: string; data: string[] }[] = [];
const replies: string[] = [];
const snow: Extract<Action, { type: "request" }> = { type: "request", kind: "snow", to: ["snow_volunteer"] };
let second = "";
let business = "";
let n = 0;
/** LINE accounts whose messages LINE refuses, and one whose next message hangs until released. */
const refused = new Set<string>();
let held: { to: string; release: Promise<void> } | undefined;

/** A call that found her snowed in, saved and sent the way the pipeline does it. */
async function raise(requestId?: string) {
  const id = `line_${++n}`;
  const action = requestId ? { ...snow, request_id: requestId } : snow;
  // Later than any record before it, as a later call is.
  const at = new Date(Date.now() + n).toISOString();
  await store.saveCall({ id, resident_id: "sato", at, kind: "call", risk: "yellow", reasons: [], actions: [{ ...action, sent: false }] });
  const results = await runActions((await store.getResident("sato"))!, id, "yellow", [], [action]);
  await store.updateCall(id, (c) => ({ actions: c.actions.map((a, i) => ({ ...a, sent: results[i].sent, deliveries: a.deliveries?.length ? a.deliveries : results[i].deliveries })) }));
  return id;
}
const open = async () => openRequests((await store.getResident("sato"))!, await store.listCalls("sato"))[0];
/** Runs scheduled work as if this many seconds had passed (the waits are 20–30 s in demo mode). */
const after = (seconds: number) => runDue(Date.now() + seconds * 1000);
const tap = (data: string, userId: string) => {
  const body = JSON.stringify({ events: [{ type: "postback", replyToken: "r", source: { userId }, postback: { data } }] });
  const sig = createHmac("sha256", "test-line-secret").update(body).digest("base64");
  return line(new Request("http://test/api/webhooks/line", { method: "POST", body, headers: { "x-line-signature": sig } }));
};
const to = () => pushed.map((p) => p.to);

beforeAll(async () => {
  second = (await store.addPerson("佐々木")).id;
  business = (await store.addPerson("北野除雪", undefined, "business")).id;
  await store.updatePerson(second, (p) => ({ ...p, line_id: "U_second" }));
  await store.updatePerson(business, (p) => ({ ...p, line_id: "U_business", location: { lat: 43.21, lng: 141.78 } }));
  await store.updatePerson("p_tanaka", (p) => ({ ...p, line_id: "U_coordinator", coordinator: true }));
  await store.updatePerson("p_yamamoto", (p) => ({ ...p, line_id: "U_volunteer" }));
});

beforeEach(async () => {
  pushed.length = 0;
  replies.length = 0;
  refused.clear();
  held = undefined;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    const [message] = body.messages;
    if (url.endsWith("/reply")) replies.push(message.text);
    else if (refused.has(body.to)) return new Response("{}", { status: 500 });
    else {
      // Only the first message to them hangs; later ones go straight through.
      const waiting = held?.to === body.to ? held : undefined;
      if (waiting) {
        held = undefined;
        await waiting.release;
      }
      pushed.push({ to: body.to, text: message.text ?? message.template.text, data: (message.template?.actions ?? []).map((a: { data: string }) => a.data) });
    }
    return new Response("{}");
  }));
  for (const task of await store.listTasks()) await store.deleteTask(task.id);
  for (const call of await store.listCalls()) await store.updateCall(call.id, () => ({ handled: true }));
  await store.updatePerson("p_yuki", (p) => ({ ...p, line_id: "U_family" }));
  await store.assign("sato", { snow_volunteer: "p_yamamoto", snow_next: [] });
});

describe("a second volunteer in line", () => {
  beforeEach(() => store.assign("sato", { snow_next: [second] }));

  it("is asked when the first doesn't take it, and the coordinators hear only after both", async () => {
    const id = await raise();
    expect(to()).toEqual(["U_volunteer"]);
    await tap(pushed[0].data[0], "U_second"); // not asked yet: not theirs to take
    expect((await open()).status).toBe("sent");

    await after(25);
    expect(to()).toEqual(["U_volunteer", "U_second"]);
    expect(await open()).toMatchObject({ asked: 1, who: "佐々木", escalated: false });
    const sato = (await store.getResident("sato"))!;
    expect(askedHelpers(sato, await store.listCalls("sato"), "snow", id).map((c) => c.name)).toEqual(["山本", "佐々木"]);

    await after(50);
    expect(to()).toEqual(["U_volunteer", "U_second", "U_coordinator"]);
    expect(pushed[2].text).toContain("【引き受け手なし】");
    expect((await open()).escalated).toBe(true);
    await after(500);
    expect(pushed).toHaveLength(3);
  });

  it("lets either of them take it once asked, and the first to answer has it", async () => {
    await raise();
    await after(25);
    await tap(pushed[1].data[0], "U_second");
    expect(to()).not.toContain("U_family"); // a volunteer coming is not the family's bill
    expect(await open()).toMatchObject({ status: "accepted", who: "佐々木", business: false });
    expect(replies.at(-1)).toContain("承りました");
    await tap(pushed[0].data[0], "U_volunteer");
    expect(replies.at(-1)).toBe("すでに引き受け済みです。ありがとうございます。");
    await after(500);
    expect(to()).toEqual(["U_volunteer", "U_second"]); // nobody else is troubled
  });

  it("records who each message went to", async () => {
    const id = await raise();
    await after(25);
    const [request] = (await store.getCall(id))!.actions;
    expect(request.deliveries).toMatchObject([{ role: "snow_volunteer", sent: true }, { role: "snow_volunteer", person: second, name: "佐々木", sent: true }]);
    expect(request.deliveries![0].name).toBeUndefined();
  });

  it("skips someone who can't be reached", async () => {
    await store.updatePerson("p_yamamoto", (p) => ({ ...p, line_id: undefined }));
    try {
      await raise();
      expect(to()).toEqual(["U_second"]);
      expect(await open()).toMatchObject({ asked: 1, status: "sent" });
      expect(coverage((await store.getResident("sato"))!).gaps).not.toContain("snow_unreachable");
    } finally {
      await store.updatePerson("p_yamamoto", (p) => ({ ...p, line_id: "U_volunteer" }));
    }
  });
});

describe("a business in line", () => {
  beforeEach(() => store.assign("sato", { snow_next: [business] }));
  const notice = () => pushed.find((p) => p.to === "U_family")!;

  it("is asked when its turn comes, and the family is told, not asked", async () => {
    const id = await raise();
    expect(to()).toEqual(["U_volunteer"]); // a volunteer being asked is no news for the family
    await after(25);
    expect(to()).toEqual(["U_volunteer", "U_business", "U_family"]);
    expect(notice().text).toBe("【有料の除雪のお願い】佐藤さんの件で、北野除雪（有料）にお願いしました。費用は先方と直接ご相談ください。");
    expect(notice().data).toEqual([]); // nothing to press: it does not wait on them
    expect(await open()).toMatchObject({ asked: 1, who: "北野除雪", business: true, status: "sent" });
    const [request] = (await store.getCall(id))!.actions;
    expect(request.deliveries).toMatchObject([
      { role: "snow_volunteer", sent: true },
      { role: "snow_volunteer", person: business, name: "北野除雪", sent: true },
      { role: "second_contact", sent: true },
    ]);

    await tap(pushed[1].data[0], "U_business");
    // The family hears who is coming and when.
    const { slotChoices, slotLabel } = await import("@/lib/requests");
    expect(to()).toEqual(["U_volunteer", "U_business", "U_family", "U_family"]);
    expect(pushed[3].text).toBe(`【有料の除雪のお願い】佐藤さんの件、北野除雪（有料）が${slotLabel(slotChoices()[0])}に伺います。費用は先方と直接ご相談ください。`);
    expect((await store.getCall(id))!.actions[0].deliveries).toHaveLength(4);
    await tap(pushed[1].data[1], "U_business"); // a second tap tells nobody anything new
    expect(to()).toHaveLength(4);
    const sato = (await store.getResident("sato"))!;
    const calls = await store.listCalls("sato");
    expect(await open()).toMatchObject({ status: "accepted", who: "北野除雪", business: true });
    expect(helpLine(sato, calls)).toContain("北野除雪が");
    expect(helpLine(sato, calls)).not.toContain("北野除雪さん");
    expect(snowRequest(sato, calls)).toMatchObject({ volunteer: "北野除雪", business: true, to: { lat: 43.21, lng: 141.78 } });
    await after(500);
    expect(to()).toHaveLength(4);
  });

  it("is asked even when the family can't be told", async () => {
    await store.updatePerson("p_yuki", (p) => ({ ...p, line_id: undefined }));
    const id = await raise();
    await after(25);
    expect(to()).toEqual(["U_volunteer", "U_business"]);
    expect((await store.getCall(id))!.actions[0].deliveries!.at(-1)).toMatchObject({ role: "second_contact", sent: false, registered: false });
  });

  it("can be first in line", async () => {
    await store.assign("sato", { snow_volunteer: business, snow_next: ["p_yamamoto"] });
    await raise();
    expect(to()).toEqual(["U_business", "U_family"]);
    expect(await open()).toMatchObject({ asked: 0, who: "北野除雪", business: true });
    await after(25);
    expect(to()).toEqual(["U_business", "U_family", "U_volunteer"]); // the volunteer behind it is next
  });

  it("does not tell the family when the business could not be asked", async () => {
    await store.updatePerson(business, (p) => ({ ...p, line_id: undefined }));
    try {
      await raise();
      await after(25);
      expect(to()).toEqual(["U_volunteer", "U_coordinator"]);
    } finally {
      await store.updatePerson(business, (p) => ({ ...p, line_id: "U_business" }));
    }
  });

  it("can take the request the moment its message arrives, before the family has been told", async () => {
    await store.assign("sato", { snow_volunteer: business, snow_next: [] });
    let release = () => {};
    held = { to: "U_family", release: new Promise((done) => (release = done)) };
    const raising = raise();
    await vi.waitFor(() => expect(to()).toEqual(["U_business"]));
    await tap(pushed[0].data[0], "U_business"); // the family's message is still on its way
    expect(await open()).toMatchObject({ status: "accepted", who: "北野除雪" });
    release();
    await raising;
    expect(await open()).toMatchObject({ status: "accepted", who: "北野除雪" });
  });

  it("shows on the map, marked as a business", async () => {
    const sato = (await store.getResident("sato"))!;
    const { volunteers } = mapData(rankedRows([sato], []), []);
    expect(volunteers.find((v) => v.id === business)).toMatchObject({ name: "北野除雪", business: true });
  });
});

describe("someone already in a line who is then marked as a business", () => {
  beforeEach(async () => {
    await store.assign("sato", { snow_next: [second] });
    await store.updatePerson(second, (p) => ({ ...p, kind: "business" })); // ticked on their own page; no resident's line saved
  });
  const undo = () => store.updatePerson(second, (p) => ({ ...p, kind: undefined }));

  it("is not asked as paid help until that resident's line is saved again", async () => {
    try {
      const sato = (await store.getResident("sato"))!;
      expect(coverage(sato).gaps).toContain("paid_unconfirmed");
      await raise();
      await after(25);
      expect(to()).toEqual(["U_volunteer", "U_coordinator"]); // passed over: no request, and no bill for the family
      expect(to()).not.toContain("U_family");

      // Saving the line with them in it, shown as paid, is the agreement.
      await store.assign("sato", { snow_next: [second] });
      expect(coverage((await store.getResident("sato"))!).gaps).not.toContain("paid_unconfirmed");
      for (const call of await store.listCalls()) await store.updateCall(call.id, () => ({ handled: true }));
      pushed.length = 0;
      await raise();
      await after(25);
      expect(to()).toEqual(["U_volunteer", "U_second", "U_family"]);
    } finally {
      await undo();
    }
  });

  it("is not agreed for one resident by saving another's line", async () => {
    try {
      await store.assign("suzuki", { snow_next: [second] });
      expect(coverage((await store.getResident("suzuki"))!).gaps).not.toContain("paid_unconfirmed");
      expect(coverage((await store.getResident("sato"))!).gaps).toContain("paid_unconfirmed");
    } finally {
      await store.assign("suzuki", { snow_next: [] });
      await undo();
    }
  });
});

describe("once everyone in line has had their turn", () => {
  it("says so, instead of showing the first person as still being waited on", async () => {
    await store.assign("sato", { snow_next: [second] });
    await raise();
    await after(25);
    await after(50);
    const sato = (await store.getResident("sato"))!;
    const calls = await store.listCalls("sato");
    expect(await open()).toMatchObject({ exhausted: true, who: "", escalated: true, status: "sent" });
    const request = snowRequest(sato, calls)!;
    expect(request).toMatchObject({ exhausted: true, escalated: true, to: undefined });
    expect(strings.ja.requestStatus(request)).toBe("除雪のお願い：順番の全員に頼みましたが、引き受け手がいません（コーディネーターに連絡済み）");
    expect(strings.ja.request(await open())).toContain("順番の全員に頼みましたが、引き受け手がいません");
    expect(strings.ja.request(await open())).not.toContain("山本");
  });

  it("says so for a line of one as well", async () => {
    await raise();
    await after(35);
    expect(await open()).toMatchObject({ exhausted: true, escalated: true });
  });
});

describe("a later call that raises the same request", () => {
  beforeEach(() => store.assign("sato", { snow_next: [second] }));

  it("leaves it with whoever has it, and keeps their deadline", async () => {
    const id = await raise();
    await after(25);
    expect(to()).toEqual(["U_volunteer", "U_second"]);
    const before = await open();

    await raise(id); // she says it again on a second call
    expect(to()).toEqual(["U_volunteer", "U_second", "U_second"]); // the second hears again; the first is not asked afresh
    const now = await open();
    expect(now).toMatchObject({ requestId: id, asked: 1, who: "佐々木", stepDue: before.stepDue });
    expect(now.callId).not.toBe(id);

    // The time the second was given runs out when it always would have.
    const due = (await store.listTasks()).filter((t) => t.kind === "request_check" && t.record === now.callId);
    expect(due).toMatchObject([{ due: before.stepDue }]);
    await after(50);
    expect(to().at(-1)).toBe("U_coordinator");
    expect(to().filter((t) => t === "U_volunteer")).toHaveLength(1);
  });

  it("does not tell the family a second time about the same business", async () => {
    await store.assign("sato", { snow_next: [business] });
    const id = await raise();
    await after(25);
    expect(to()).toEqual(["U_volunteer", "U_business", "U_family"]);
    await raise(id);
    expect(to()).toEqual(["U_volunteer", "U_business", "U_family", "U_business"]);
  });

  it("starts from the top again once the line has run out, and keeps moving, without telling the coordinators twice", async () => {
    const id = await raise();
    await after(25);
    await after(50);
    expect(to().at(-1)).toBe("U_coordinator");
    pushed.length = 0;
    await raise(id);
    expect(to()).toEqual(["U_volunteer"]);
    await after(25);
    expect(to()).toEqual(["U_volunteer", "U_second"]); // the second gets a turn on this run too
    await after(50);
    await after(500);
    expect(to()).toEqual(["U_volunteer", "U_second"]); // the coordinators already have it
    expect(await open()).toMatchObject({ exhausted: true, escalated: true });
  });

  it("does not let a coordinator retry from an earlier run speak during a fresh turn", async () => {
    const id = await raise();
    await after(25);
    refused.add("U_coordinator");
    await after(50); // the line runs out; LINE refuses the coordinator, so another try is booked
    expect((await open()).escalated).toBe(false);
    const retry = (await store.listTasks()).filter((t) => t.kind === "request_check" && (t.round ?? 1) > 1);
    expect(retry).toHaveLength(1);
    refused.clear();

    pushed.length = 0;
    await raise(id); // a later call starts the line again
    expect(to()).toEqual(["U_volunteer"]);
    await checkRequest(retry[0]); // the old try comes due during the first helper's turn
    expect(to()).toEqual(["U_volunteer"]);
    expect((await open()).escalated).toBe(false);
  });

  it("treats someone put in the waiting person's place as not yet asked", async () => {
    const id = await raise();
    await after(25);
    expect(to()).toEqual(["U_volunteer", "U_second"]);
    const before = await open();
    await store.assign("sato", { snow_next: [business] }); // the second volunteer is replaced by a business

    await new Promise((r) => setTimeout(r, 5));
    await raise(id);
    expect(to()).toEqual(["U_volunteer", "U_second", "U_business", "U_family"]); // a first request, and the family told
    const now = await open();
    expect(now).toMatchObject({ asked: 1, askedId: business, who: "北野除雪" });
    expect(now.stepDue).toBeGreaterThan(before.stepDue!); // its own time, not what the volunteer had left
  });
});

describe("who is in line", () => {
  it("keeps the order, survives a save, and blocks deleting someone in it", async () => {
    await store.assign("sato", { snow_next: [business, second] });
    await store.updateResident("sato", (r) => ({ ...r, care_notes: "" }));
    const sato = (await store.getResident("sato"))!;
    expect(sato.snow_next!.map((c) => c.name)).toEqual(["北野除雪", "佐々木"]);
    const { serves } = await import("@/lib/coverage");
    expect(serves(sato, second)).toBe(true);
  });

  it("reads a resident saved before there was a line", async () => {
    expect((await store.getResident("suzuki"))!.snow_next).toEqual([]);
  });
});
