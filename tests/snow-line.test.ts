import { createHmac } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Action } from "@/lib/types";

// More than one person in line for snow clearing: volunteers and businesses, asked in order.
// LINE is replaced; the store, the request steps, the scheduler and the LINE webhook are real.
const { checkRequest, handOff, runActions } = await import("@/lib/actions");
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
  business = (await store.addPerson("北野除雪", undefined, undefined, "business")).id;
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

  it("can still take it after being taken out of the line during their turn", async () => {
    await raise();
    await after(25);
    expect(to()).toEqual(["U_volunteer", "U_second"]);
    await store.assign("sato", { snow_next: [] });
    await tap(pushed[1].data[0], "U_second");
    expect(await open()).toMatchObject({ status: "accepted", who: "佐々木" });
  });

  it("is asked when the first doesn't take it, and the coordinators hear only after both", async () => {
    const id = await raise();
    expect(to()).toEqual(["U_volunteer"]);
    await tap(pushed[0].data[0], "U_second"); // not asked yet: not theirs to take
    expect((await open()).status).toBe("sent");

    await after(25);
    expect(to()).toEqual(["U_volunteer", "U_second"]);
    expect(await open()).toMatchObject({ askedId: second, run: { at: 1 }, who: "佐々木", escalated: false });
    const sato = (await store.getResident("sato"))!;
    expect(askedHelpers(sato, await store.listCalls("sato"), "snow", id, await store.listPeople()).map((c) => c.name)).toEqual(["山本", "佐々木"]);

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
    // The family hears who is coming, as for any helper; nothing about paying.
    expect(pushed.at(-1)).toMatchObject({ to: "U_family" });
    expect(pushed.at(-1)!.text).toContain("佐々木さんが");
    expect(pushed.at(-1)!.text).not.toContain("有料");
    expect(await open()).toMatchObject({ status: "accepted", who: "佐々木", business: false });
    expect(replies.at(-1)).toContain("承りました");
    await tap(pushed[0].data[0], "U_volunteer");
    expect(replies.at(-1)).toBe("すでに引き受け済みです。ありがとうございます。");
    await after(500);
    expect(to()).toEqual(["U_volunteer", "U_second", "U_family"]); // nobody else is troubled
  });

  it("records who each message went to", async () => {
    const id = await raise();
    await after(25);
    const [request] = (await store.getCall(id))!.actions;
    expect(request.deliveries).toMatchObject([{ role: "snow_volunteer", sent: true }, { role: "snow_volunteer", person: second, name: "佐々木", sent: true }]);
    expect(request.deliveries![0]).toMatchObject({ person: "p_yamamoto", name: "山本" });
  });

  it("skips someone who can't be reached", async () => {
    await store.updatePerson("p_yamamoto", (p) => ({ ...p, line_id: undefined }));
    try {
      await raise();
      expect(to()).toEqual(["U_second"]);
      expect(await open()).toMatchObject({ askedId: second, status: "sent" });
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
    expect(await open()).toMatchObject({ askedId: business, who: "北野除雪", business: true, status: "sent" });
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
    expect(pushed[3].text).toBe(`北野除雪（有料）が${slotLabel(slotChoices()[0])}、佐藤さん宅の雪かきに伺います。費用は先方と直接ご相談ください。`);
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
    expect(await open()).toMatchObject({ askedId: business, who: "北野除雪", business: true });
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
    // The run stays on the record it started on, with the second's time unchanged; the reminder points back to it.
    expect(now).toMatchObject({ requestId: id, askedId: second, who: "佐々木", runCallId: id, run: { due: before.run!.due } });
    expect(now.callId).not.toBe(id);

    // The time the second was given runs out when it always would have.
    // (An earlier hand-off's booked step may still be queued; it does nothing once the run has moved on.)
    const due = (await store.listTasks()).filter((t) => t.kind === "request_check" && t.record === id && t.stage === before.stage);
    expect(due).toMatchObject([{ due: before.run!.due }]);
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

  it("keeps the line it started with: someone put in the waiting person's place is asked on the next run", async () => {
    const id = await raise();
    await after(25);
    expect(to()).toEqual(["U_volunteer", "U_second"]);
    await store.assign("sato", { snow_next: [business] }); // the second volunteer is replaced by a business

    await raise(id); // a reminder: the request is still with the second, in this run
    expect(to()).toEqual(["U_volunteer", "U_second", "U_second"]);
    expect(await open()).toMatchObject({ askedId: second });
    await after(50); // the second's turn ends; this run's line is over
    expect(to().at(-1)).toBe("U_coordinator");
    expect(to()).not.toContain("U_business");

    pushed.length = 0;
    await raise(id); // the next run uses the line as it is now
    await after(25);
    expect(to()).toEqual(["U_volunteer", "U_business", "U_family"]);
  });
});

describe("the line changes while someone has the request", () => {
  let third = "";
  beforeAll(async () => {
    third = (await store.addPerson("加藤")).id;
    await store.updatePerson(third, (p) => ({ ...p, line_id: "U_third" }));
  });

  it("goes on to the next person still in line when the one waiting is taken out", async () => {
    await store.assign("sato", { snow_next: [second, third] });
    await raise();
    await after(25);
    expect(to()).toEqual(["U_volunteer", "U_second"]);
    await store.assign("sato", { snow_next: [third] }); // the second is taken out during their turn
    await after(50);
    expect(to()).toEqual(["U_volunteer", "U_second", "U_third"]); // the third is asked, not skipped
    expect(await open()).toMatchObject({ askedId: third, escalated: false });
  });

  it("asks someone moved ahead of the person waiting, before telling the coordinators", async () => {
    await store.assign("sato", { snow_next: [second, third] });
    await raise();
    await after(25); // the first's turn ends: the second is asked
    expect(to()).toEqual(["U_volunteer", "U_second"]);
    await store.assign("sato", { snow_next: [third, second] }); // the third moved ahead of the second
    await after(50);
    expect(to()).toEqual(["U_volunteer", "U_second", "U_third"]);
    expect(await open()).toMatchObject({ askedId: third, escalated: false });
  });

  it("keeps the run's line when it is cut short under the person waiting, and a restart uses the new one", async () => {
    let fourth = "";
    fourth = (await store.addPerson("木村")).id;
    await store.updatePerson(fourth, (p) => ({ ...p, line_id: "U_fourth" }));
    await store.assign("sato", { snow_next: [second, third] });
    await raise();
    await after(25);
    await after(50);
    expect(to()).toEqual(["U_volunteer", "U_second", "U_third"]); // the third, last in line, has it
    await store.assign("sato", { snow_next: [fourth] }); // shorter: the third is gone, someone new is in
    // The third keeps their turn in this run, which still ends after them.
    expect(await open()).toMatchObject({ askedId: third, exhausted: false });
    await after(75);
    expect(to().at(-1)).toBe("U_coordinator");
    expect(to()).not.toContain("U_fourth");
    // A coordinator restarts it, and the new line counts at once.
    const { restartRequest } = await import("@/lib/actions");
    pushed.length = 0;
    expect(await restartRequest("sato", "snow")).toBe(true);
    expect(to()).toEqual(["U_volunteer"]);
    await after(25);
    expect(to()).toEqual(["U_volunteer", "U_fourth"]);
  });

  it("draws the map line to the person who has it, after the line is reordered", async () => {
    await store.updatePerson(second, (p) => ({ ...p, location: { lat: 43.3, lng: 141.9 } }));
    await store.updatePerson(third, (p) => ({ ...p, location: { lat: 43.1, lng: 141.6 } }));
    await store.assign("sato", { snow_next: [second, third] });
    await raise();
    await after(25); // the second has it
    await store.assign("sato", { snow_next: [third, second] }); // swapped during their turn
    const sato = (await store.getResident("sato"))!;
    expect(snowRequest(sato, await store.listCalls("sato"))).toMatchObject({ volunteer: "佐々木", to: { lat: 43.3, lng: 141.9 } });
  });

  it("does not ask anyone twice on the same run when the line is reordered", async () => {
    await store.assign("sato", { snow_next: [second, third] });
    await raise();
    await after(25);
    await store.assign("sato", { snow_volunteer: second, snow_next: ["p_yamamoto", third] }); // reordered
    await after(50);
    expect(to()).toEqual(["U_volunteer", "U_second", "U_third"]);
  });
});

describe("a helper who can't come", () => {
  beforeEach(() => store.assign("sato", { snow_next: [second] }));
  const cant = (p: { data: string[] }) => p.data.at(-1)!;

  it("is offered today only, and a button to say no", async () => {
    const { choicesFor, slotChoices } = await import("@/lib/requests");
    await raise();
    expect(pushed[0].data).toHaveLength(choicesFor("snow").length + 1);
    expect(cant(pushed[0])).toMatch(/^decline:/);
    const today = slotChoices()[0].date;
    expect(pushed[0].data.slice(0, -1).every((d) => d.includes(`:${today}:`))).toBe(true);
  });

  it("passes the request on at once, without waiting for their time to run out", async () => {
    await raise();
    await tap(cant(pushed[0]), "U_volunteer");
    expect(replies.at(-1)).toBe("承知しました。ほかの方にお願いします。ありがとうございます。");
    expect(to()).toEqual(["U_volunteer", "U_second"]);
    // Their own timeout, when it comes, does nothing more: the second's turn runs its course, then the coordinators hear once.
    await after(25);
    await after(500);
    expect(to()).toEqual(["U_volunteer", "U_second", "U_coordinator"]);
  });

  it("tells the coordinators at once when the last in line can't come", async () => {
    await raise();
    await after(25);
    await tap(cant(pushed[1]), "U_second");
    expect(to()).toEqual(["U_volunteer", "U_second", "U_coordinator"]);
    expect((await open()).escalated).toBe(true);
  });

  it("is ignored from anyone whose turn it isn't, and once someone has taken it", async () => {
    await raise();
    await tap(cant(pushed[0]), "U_second"); // not their turn
    expect(to()).toEqual(["U_volunteer"]);
    await tap(pushed[0].data[0], "U_volunteer"); // takes it
    await tap(cant(pushed[0]), "U_volunteer"); // then says no
    expect(replies.at(-1)).toBe("すでに引き受け手が決まっています。ありがとうございます。");
    expect(to()).toEqual(["U_volunteer", "U_family"]);
  });

  it("does nothing from a card sent on an earlier run of the line", async () => {
    const id = await raise();
    await after(25);
    await after(50); // the line runs out; the coordinators are told
    const old = cant(pushed[0]);
    pushed.length = 0;
    await raise(id); // a later call starts the line again: the volunteer gets a fresh card
    expect(to()).toEqual(["U_volunteer"]);
    await tap(old, "U_volunteer"); // the earlier card
    expect(to()).toEqual(["U_volunteer"]);
    expect(await open()).toMatchObject({ askedId: "p_yamamoto", status: "sent" });
    await tap(cant(pushed[0]), "U_volunteer"); // the fresh card works
    expect(to()).toEqual(["U_volunteer", "U_second"]);
  });

  it("passes it on once when the same button is tapped twice while the next message is still going out", async () => {
    await store.assign("sato", { snow_next: [business] });
    await raise();
    let release = () => {};
    held = { to: "U_business", release: new Promise((done) => (release = done)) };
    const first = tap(cant(pushed[0]), "U_volunteer");
    await vi.waitFor(() => expect(held).toBeUndefined()); // the business's message is on its way and held
    await tap(cant(pushed[0]), "U_volunteer"); // the same button again
    release();
    await first;
    expect(to().filter((t) => t === "U_business")).toHaveLength(1);
    expect(to().filter((t) => t === "U_family")).toHaveLength(1);
  });

  it("asks the next person even if the app stops between ending a turn and asking them", async () => {
    await raise();
    // A turn ended (a can't-come tap, or its time ran out), and the app stopped before anyone else was asked.
    const ok = await handOff(await open());
    expect(ok).toBe(true);
    expect(to()).toEqual(["U_volunteer"]);
    expect((await open()).run).toMatchObject({ ending: true });
    // On restart the scheduler finds the booked step and carries on: the next person is asked, once.
    await after(1);
    expect(to()).toEqual(["U_volunteer", "U_second"]);
    await after(5);
    expect(to()).toEqual(["U_volunteer", "U_second"]);
  });

  it("moves it on once when the tap and the timeout come together", async () => {
    await raise();
    await Promise.all([tap(cant(pushed[0]), "U_volunteer"), after(25)]);
    // If the tap lands while a pass is running, the next person is asked on the following pass.
    await after(1);
    await after(2);
    expect(to().filter((t) => t === "U_second")).toHaveLength(1);
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

  it("leaves the rest of the line, and what was agreed for it, alone when only the first place is saved", async () => {
    await store.assign("sato", { snow_next: [business] });
    await store.updatePerson(second, (p) => ({ ...p, kind: "business" }));
    try {
      await store.assign("sato", { snow_next: [business, second] });
      await store.updatePerson(second, (p) => ({ ...p, kind: undefined }));
      await store.assign("sato", { snow_next: [business, second] }); // second is a volunteer here
      await store.updatePerson(second, (p) => ({ ...p, kind: "business" })); // ticked afterwards
      // The resident's own page saves the three roles, as its form does.
      await store.assign("sato", { helper: "p_tanaka", second_contact: "p_yuki", snow_volunteer: "p_yamamoto" });
      const sato = (await store.getResident("sato"))!;
      expect(sato.snow_next!.map((c) => c.name)).toEqual(["北野除雪", "佐々木"]);
      expect(sato.paid_ok).toEqual([business]); // still agreed; the one ticked afterwards still is not
    } finally {
      await store.updatePerson(second, (p) => ({ ...p, kind: undefined }));
    }
  });

  it("reads a resident saved before there was a line", async () => {
    expect((await store.getResident("suzuki"))!.snow_next).toEqual([]);
  });
});
