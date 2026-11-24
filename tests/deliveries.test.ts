import { beforeEach, describe, expect, it, vi } from "vitest";

const { runActions, sendRedAlert } = await import("@/lib/actions");
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
    const [snow] = await runActions(sato, "call_4", "yellow", ["雪で玄関から出られない"], [{ type: "snow_request", to: ["snow_volunteer"] }]);
    expect(snow.sent).toBe(false);
    expect(snow.deliveries).toMatchObject([{ role: "snow_volunteer", sent: false, registered: true, button: "引き受けます" }]);
  });
});
