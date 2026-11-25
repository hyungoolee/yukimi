import { createHmac } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Action } from "@/lib/types";

// More than one person in line for snow clearing: volunteers and businesses, asked in order.
// LINE is replaced; the store, the request steps, the scheduler and the LINE webhook are real.
const { checkRequest, runActions } = await import("@/lib/actions");
const { askedHelpers, helpLine, openRequests } = await import("@/lib/requests");
const { coverage } = await import("@/lib/coverage");
const { mapData, rankedRows, snowRequest } = await import("@/lib/dashboard");
const store = await import("@/lib/store");
const { runDue } = await import("@/lib/tick");
const { POST: line } = await import("@/app/api/webhooks/line/route");

const pushed: { to: string; text: string; data: string[] }[] = [];
const replies: string[] = [];
const snow: Extract<Action, { type: "request" }> = { type: "request", kind: "snow", to: ["snow_volunteer"] };
let second = "";
let business = "";
let n = 0;

/** A call that found her snowed in, saved and sent the way the pipeline does it. */
async function raise() {
  const id = `line_${++n}`;
  await store.saveCall({ id, resident_id: "sato", at: new Date().toISOString(), kind: "call", risk: "yellow", reasons: [], actions: [{ ...snow, sent: false }] });
  const results = await runActions((await store.getResident("sato"))!, id, "yellow", [], [snow]);
  await store.updateCall(id, (c) => ({ actions: c.actions.map((a, i) => ({ ...a, sent: results[i].sent, deliveries: results[i].deliveries })) }));
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
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    const [message] = body.messages;
    if (url.endsWith("/reply")) replies.push(message.text);
    else pushed.push({ to: body.to, text: message.text ?? message.template.text, data: (message.template?.actions ?? []).map((a: { data: string }) => a.data) });
    return new Response("{}");
  }));
  for (const task of await store.listTasks()) await store.deleteTask(task.id);
  for (const call of await store.listCalls()) await store.updateCall(call.id, () => ({ handled: true }));
  await store.updatePerson("p_yuki", (p) => ({ ...p, line_id: "U_family" }));
  await store.assign("sato", { snow_volunteer: "p_yamamoto", snow_next: [], paid_help_ok: undefined });
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
  const consent = () => pushed.find((p) => p.to === "U_family")!;

  it("is asked only after the family says yes", async () => {
    await raise();
    await after(25);
    expect(to()).toEqual(["U_volunteer", "U_family"]);
    expect(consent().text).toContain("北野除雪（有料）");
    expect(consent().data).toHaveLength(2);
    expect(await open()).toMatchObject({ asked: 1, awaitingConsent: true, business: true });

    await tap(consent().data[0], "U_volunteer"); // only the family may answer
    expect(to()).toEqual(["U_volunteer", "U_family"]);
    await tap(consent().data[0], "U_family");
    expect(replies.at(-1)).toBe("北野除雪に依頼します。ありがとうございます。");
    expect(to()).toEqual(["U_volunteer", "U_family", "U_business"]);
    expect(await open()).toMatchObject({ asked: 1, awaitingConsent: false, status: "sent" });
    await tap(consent().data[1], "U_family"); // a second tap changes nothing
    expect(replies.at(-1)).toBe("この件はもう済んでいます。ありがとうございます。");

    // The check booked for the family's answer comes due, but they answered: the business keeps its own time.
    const waiting = (await store.listTasks()).filter((t) => t.kind === "request_check");
    expect(waiting.map((t) => t.stage).sort()).toEqual(["1:asked", "1:yes"]);
    await checkRequest(waiting.find((t) => t.stage === "1:asked")!);
    expect(to()).toHaveLength(3);

    await tap(pushed[2].data[0], "U_business");
    const sato = (await store.getResident("sato"))!;
    const calls = await store.listCalls("sato");
    expect(await open()).toMatchObject({ status: "accepted", who: "北野除雪", business: true });
    expect(helpLine(sato, calls)).toContain("北野除雪が");
    expect(helpLine(sato, calls)).not.toContain("北野除雪さん");
    expect(snowRequest(sato, calls)).toMatchObject({ volunteer: "北野除雪", business: true, to: { lat: 43.21, lng: 141.78 } });
    await after(500);
    expect(to()).toHaveLength(3);
  });

  it("is not asked when the family says no: the coordinators hear at once", async () => {
    await raise();
    await after(25);
    await tap(consent().data[1], "U_family");
    expect(replies.at(-1)).toBe("承知しました。依頼しません。");
    expect(to()).toEqual(["U_volunteer", "U_family", "U_coordinator"]);
    expect((await open()).escalated).toBe(true);
  });

  it("is not asked when the family doesn't answer in time", async () => {
    await raise();
    await after(25);
    await after(50);
    expect(to()).toEqual(["U_volunteer", "U_family", "U_coordinator"]);
    await tap(consent().data[0], "U_family"); // too late: the coordinators have it now
    expect(to()).not.toContain("U_business");
  });

  it("is passed over when the family can't be asked", async () => {
    await store.updatePerson("p_yuki", (p) => ({ ...p, line_id: undefined }));
    await raise();
    await after(25);
    expect(to()).toEqual(["U_volunteer", "U_coordinator"]);
  });

  it("is asked straight away when the family has agreed once and for all", async () => {
    await store.assign("sato", { paid_help_ok: true });
    await raise();
    await after(25);
    expect(to()).toEqual(["U_volunteer", "U_business"]);
  });

  it("can be first in line: the family is asked before anyone", async () => {
    await store.assign("sato", { snow_volunteer: business, snow_next: ["p_yamamoto"] });
    await raise();
    expect(to()).toEqual(["U_family"]);
    expect(await open()).toMatchObject({ asked: 0, awaitingConsent: true, status: "sent" });
    await tap(consent().data[1], "U_family");
    expect(to()).toEqual(["U_family", "U_volunteer"]); // the volunteer behind them is next
    expect(await open()).toMatchObject({ asked: 1, who: "山本", business: false });
  });

  it("shows on the map, marked as a business", async () => {
    const sato = (await store.getResident("sato"))!;
    const { volunteers } = mapData(rankedRows([sato], []), []);
    expect(volunteers.find((v) => v.id === business)).toMatchObject({ name: "北野除雪", business: true });
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
