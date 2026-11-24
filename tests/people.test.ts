import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = { value: "ok" as "ok" | "denied" };
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/env", async (original) => ({
  ...(await original<typeof import("@/lib/env")>()),
  dashboardAccess: () => auth.value,
}));

const { sendTestMessage } = await import("@/app/people/actions");
const store = await import("@/lib/store");

const sent: { url: string; body: { to: string; messages: { text: string }[] } }[] = [];
const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
};

beforeEach(async () => {
  auth.value = "ok";
  sent.length = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    sent.push({ url, body: JSON.parse(String(init.body)) });
    return new Response("{}");
  }));
  const sato = (await store.getResident("sato"))!;
  await store.saveResident({
    ...sato, helper: { ...sato.helper, line_id: "U_helper" }, snow_volunteer: { ...sato.snow_volunteer, line_id: "U_snow" },
  });
});

describe("test message", () => {
  it("sends one message to the person on file, looked up on the server", async () => {
    expect(await sendTestMessage(undefined, form({ resident_id: "sato", role: "helper" }))).toEqual({ status: "sent" });
    expect(sent).toHaveLength(1);
    expect(sent[0].body.to).toBe("U_helper");
    expect(sent[0].body.messages[0].text).toContain("テスト");
    await sendTestMessage(undefined, form({ resident_id: "sato", role: "snow_volunteer" }));
    expect(sent[1].body.to).toBe("U_snow"); // each role goes to its own person
  });

  it("reports failure when the person isn't registered, the role is made up, or LINE refuses", async () => {
    expect(await sendTestMessage(undefined, form({ resident_id: "sato", role: "second_contact" }))).toEqual({ status: "failed" });
    expect(await sendTestMessage(undefined, form({ resident_id: "sato", role: "name" }))).toEqual({ status: "failed" });
    expect(sent).toHaveLength(0);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("no", { status: 400 })));
    expect(await sendTestMessage(undefined, form({ resident_id: "sato", role: "helper" }))).toEqual({ status: "failed" });
  });

  it("refuses without the dashboard password", async () => {
    auth.value = "denied";
    await expect(sendTestMessage(undefined, form({ resident_id: "sato", role: "helper" }))).rejects.toThrow("Unauthorized");
    expect(sent).toHaveLength(0);
  });
});
