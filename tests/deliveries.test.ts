import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Action } from "@/lib/types";

const { checkRequest, runActions, sendRedAlert } = await import("@/lib/actions");
const { openRequests } = await import("@/lib/requests");
const store = await import("@/lib/store");

const pushed: { to: string; text: string }[] = [];
let lineOk = true;

beforeEach(async () => {
  pushed.length = 0;
  lineOk = true;
  process.env.APP_URL = "https://example.test";
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    pushed.push({ to: body.to, text: body.messages[0].text ?? body.messages[0].template.text });
    return new Response("{}", { status: lineOk ? 200 : 500 });
  }));
  // The family (p_yuki) has not registered on LINE.
  await store.updatePerson("p_tanaka", (p) => ({ ...p, line_id: "U_helper" }));
  await store.updatePerson("p_yamamoto", (p) => ({ ...p, line_id: "U_volunteer" }));
});

describe("what was sent, per recipient", () => {
  it("records each person's own result, not one result for the whole alert", async () => {
    const sato = (await store.getResident("sato"))!;
    const [alert] = await runActions(sato, "call_1", "yellow", ["食事をとれていない"], [{ type: "alert", to: ["helper", "second_contact"] }]);
    expect(alert.sent).toBe(true);
    expect(alert.deliveries).toMatchObject([
      { role: "helper", sent: true, registered: true },
      { role: "second_contact", sent: false, registered: false },
    ]);
    expect(pushed.map((p) => p.to)).toEqual(["U_helper"]);
  });

  it("records the reasons each recipient actually got", async () => {
    const sato = (await store.getResident("sato"))!;
    const [alert] = await runActions(sato, "call_2", "yellow", ["全員向け", "民生委員だけ"], [
      { type: "alert", to: ["helper", "second_contact"], reasonsByRole: { helper: ["全員向け", "民生委員だけ"], second_contact: ["全員向け"] } },
    ]);
    const family = alert.deliveries!.find((d) => d.role === "second_contact")!;
    expect(family.reasons).toEqual(["全員向け"]);
    expect(family.text).not.toContain("民生委員だけ");
    expect(alert.deliveries!.find((d) => d.role === "helper")!.text).toContain("民生委員だけ");
  });

  it("keeps the full text that went out, with the link and the button", async () => {
    const sato = (await store.getResident("sato"))!;
    const [helper] = await sendRedAlert(sato, "call_3", ["helper"], ["転倒・痛みあり"]);
    expect(helper.text).toBe(pushed[0].text);
    expect(helper.text).toContain("https://example.test/residents/sato");
    expect(helper.button).toBe("確認しました");
  });

  it("tells a LINE failure apart from a person who is not registered", async () => {
    lineOk = false;
    const sato = (await store.getResident("sato"))!;
    const [snow] = await runActions(sato, "call_4", "yellow", ["雪で玄関から出られない"], [{ type: "request", kind: "snow", to: ["snow_helper"] }]);
    expect(snow.sent).toBe(false);
    expect(snow.deliveries).toMatchObject([{ role: "snow_helper", sent: false, registered: true }]);
    // What is left of today, then a way to say no.
    const { choicesFor, slotLabel } = await import("@/lib/requests");
    expect(snow.deliveries[0].button!.split(" / ")).toEqual([...choicesFor("snow").map((s) => slotLabel(s)), "行けません"]);
    expect(snow).toMatchObject({ type: "request", kind: "snow" });
  });
});

describe("a help request nobody takes", () => {
  const snow: Extract<Action, { type: "request" }> = { type: "request", kind: "snow", to: ["snow_helper"] };
  const save = (id: string, actions: object[]) =>
    store.saveCall({ id, resident_id: "sato", at: new Date().toISOString(), kind: "call", risk: "yellow", reasons: [], actions } as never);
  const checks = async () => (await store.listTasks()).filter((t) => t.kind === "request_check");
  const open = async () => openRequests((await store.getResident("sato"))!, await store.listCalls("sato"))[0];

  beforeEach(async () => {
    for (const task of await store.listTasks()) await store.deleteTask(task.id);
    for (const call of await store.listCalls()) await store.updateCall(call.id, () => ({ handled: true }));
    // The helper doubles as the coordinator here.
    await store.updatePerson("p_tanaka", (p) => ({ ...p, coordinator: true }));
  });

  const check = (requestId: string, round?: number) => checkRequest({ resident_id: "sato", call_id: requestId, request_kind: "snow", round });

  it("books a check each time the request is sent, always for the request first raised", async () => {
    const sato = (await store.getResident("sato"))!;
    await runActions(sato, "ask_1", "yellow", [], [snow]);
    // A reminder: after a first try that reached nobody, or after a promised visit's time ran out.
    await runActions(sato, "ask_2", "yellow", [], [{ ...snow, request_id: "ask_1" }]);
    expect(await checks()).toMatchObject([{ call_id: "ask_1", request_kind: "snow" }, { call_id: "ask_1", request_kind: "snow" }]);
    expect(pushed.map((p) => p.to)).toEqual(["U_volunteer", "U_volunteer"]);
  });

  it("tries again when LINE refuses every coordinator, a few times only", async () => {
    await save("retry_1", [{ ...snow, sent: true }]);
    lineOk = false;
    await check("retry_1");
    expect(await open()).toMatchObject({ escalated: false });
    expect(await checks()).toMatchObject([{ call_id: "retry_1", round: 2 }]);
    await check("retry_1", 3);
    expect(await checks()).toHaveLength(1); // the last try books no more

    lineOk = true;
    await check("retry_1", 2);
    expect(await open()).toMatchObject({ escalated: true });
  });

  it("does not name who was asked: the role may have changed hands since", async () => {
    await save("name_1", [{ ...snow, sent: true }]);
    await check("name_1");
    expect(pushed[0].text).not.toContain("山本");
  });

  it("tells the coordinator once the wait is over, and keeps that across a reminder", async () => {
    await save("wait_1", [{ ...snow, sent: true }]);
    await check("wait_1");
    expect(pushed).toMatchObject([{ to: "U_helper" }]);
    expect(pushed[0].text).toContain("【引き受け手なし】");
    expect(pushed[0].text).toContain("https://example.test/residents/sato");
    expect(await open()).toMatchObject({ requestId: "wait_1", escalated: true });

    // The same step run again (a restart before its task was deleted) sends nothing more.
    await check("wait_1");
    expect(pushed).toHaveLength(1);

    // The next day's call writes a fresh record of the same request.
    await save("wait_2", [{ ...snow, request_id: "wait_1", sent: true }]);
    expect(await open()).toMatchObject({ requestId: "wait_1", callId: "wait_2", escalated: true });
  });

  it("stays quiet when someone has taken it", async () => {
    await save("taken_1", [{ ...snow, sent: true, accepted_by: "山本" }]);
    await check("taken_1");
    expect(pushed).toEqual([]);
  });

  it("tells the coordinator at once when the request reached nobody", async () => {
    await store.updatePerson("p_yamamoto", (p) => ({ ...p, line_id: undefined }));
    await save("nobody_1", [{ ...snow, sent: false }]);
    await runActions((await store.getResident("sato"))!, "nobody_1", "yellow", [], [snow]);
    expect(pushed).toMatchObject([{ to: "U_helper" }]);
    expect(pushed[0].text).toContain("【依頼先なし】");
    expect(await checks()).toEqual([]);
    expect(await open()).toMatchObject({ status: "not_sent", escalated: true });
  });

  it("does not claim the coordinator was told when the message reached none", async () => {
    await store.updatePerson("p_tanaka", (p) => ({ ...p, coordinator: undefined }));
    await save("silent_1", [{ ...snow, sent: true }]);
    await check("silent_1");
    expect(pushed).toEqual([]);
    expect(await open()).toMatchObject({ escalated: false });
  });
});
