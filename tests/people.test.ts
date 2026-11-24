import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = { value: "ok" as "ok" | "denied" };
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`redirect:${to}`); } }));
vi.mock("@/lib/env", async (original) => ({
  ...(await original<typeof import("@/lib/env")>()),
  dashboardAccess: () => auth.value,
}));

const actions = await import("@/app/people/actions");
const store = await import("@/lib/store");

const sent: { body: { to: string; messages: { text: string }[] } }[] = [];
const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
};

beforeEach(async () => {
  auth.value = "ok";
  sent.length = 0;
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
    sent.push({ body: JSON.parse(String(init.body)) });
    return new Response("{}");
  }));
  await store.updatePerson("p_tanaka", (p) => ({ ...p, line_id: "U_helper" }));
});

describe("people in the store", () => {
  it("fills a resident's roles from the people files, without the registration code", async () => {
    await store.renewCode("p_tanaka");
    const sato = (await store.getResident("sato"))!;
    expect(sato.helper).toEqual({ id: "p_tanaka", name: "民生委員 田中", line_id: "U_helper" });
    expect(sato.second_contact).toMatchObject({ id: "p_yuki", name: "ゆき" });
  });

  it("reads a role whose person is gone as a vacant post", async () => {
    await store.assign("suzuki", { snow_volunteer: "p_nobody" });
    expect((await store.getResident("suzuki"))!.snow_volunteer).toEqual({ name: "" });
    await store.assign("suzuki", { snow_volunteer: "p_yamamoto" });
  });

  it("refuses to save a resident with a person typed into a role, since only the id is kept", async () => {
    const sato = (await store.getResident("sato"))!;
    expect(() => store.saveResident({ ...sato, helper: { name: "新しい人", line_id: "U_x" } })).toThrow("not a saved person");
    await store.saveResident({ ...sato, helper: { name: "" } }); // a vacant post is fine
    expect((await store.getResident("sato"))!.helper).toEqual({ name: "" });
    await store.assign("sato", { helper: "p_tanaka" });
  });

  it("gives a disk from before people had files its people from the seed, once, keeping everything else", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "yukimi-old-"));
    await mkdir(path.join(dir, "residents"));
    const old = { id: "sato", name: "佐藤", phone: "+819011112222", call_time: "09:00", facts: ["覚えていること"], recent_calls: [],
      helper: { name: "民生委員 田中", line_id: "" }, second_contact: { name: "ゆき" }, snow_volunteer: { name: "山本" } };
    const mine = { ...old, id: "mine", helper: { name: "だれか" } }; // not a seed resident
    await writeFile(path.join(dir, "residents", "sato.json"), JSON.stringify(old));
    await writeFile(path.join(dir, "residents", "mine.json"), JSON.stringify(mine));
    await cp(path.join(process.cwd(), "data/seed/weather.json"), path.join(dir, "weather.json"));

    vi.resetModules();
    vi.stubEnv("DATA_DIR", dir);
    const fresh = await import("@/lib/store");
    const sato = (await fresh.getResident("sato"))!;
    expect(sato).toMatchObject({ phone: "+819011112222", facts: ["覚えていること"], helper: { id: "p_tanaka" }, second_contact: { id: "p_yuki" } });
    expect((await fresh.getResident("mine"))!.helper).toEqual({ name: "" });
    await fresh.updatePerson("p_tanaka", (p) => ({ ...p, line_id: "U_kept" }));

    vi.resetModules(); // a restart: nothing is converted twice, and a registration made since is kept
    const again = await import("@/lib/store");
    expect((await again.getResident("sato"))!.helper.line_id).toBe("U_kept");
    expect(JSON.parse(await readFile(path.join(dir, "residents", "sato.json"), "utf8")).helper).toBe("p_tanaka");
    vi.unstubAllEnvs();
  });
});

describe("managing people", () => {
  it("adds a person with a registration code, edits them, and deletes them only while they serve nobody", async () => {
    await expect(actions.createPerson(form({ name: " 佐々木 ", phone: "090" }))).rejects.toThrow("redirect:/people/p_");
    const sasaki = (await store.listPeople()).find((p) => p.name === "佐々木")!;
    expect(sasaki).toMatchObject({ phone: "090", code: expect.stringMatching(/^\d{8}$/) });

    await actions.editPerson(form({ person_id: sasaki.id, name: "佐々木 花", phone: "" }));
    expect(await store.getPerson(sasaki.id)).toEqual({ id: sasaki.id, name: "佐々木 花", code: sasaki.code });
    await actions.editPerson(form({ person_id: sasaki.id, name: "  " })); // a name is required
    expect((await store.getPerson(sasaki.id))!.name).toBe("佐々木 花");

    await actions.assignRoles(form({ resident_id: "suzuki", helper: "p_tanaka", second_contact: sasaki.id, snow_volunteer: "" }));
    const suzuki = (await store.getResident("suzuki"))!;
    expect([suzuki.helper.id, suzuki.second_contact.id, suzuki.snow_volunteer.name]).toEqual(["p_tanaka", sasaki.id, ""]);
    expect(suzuki.facts.length).toBeGreaterThan(0); // the rest of the file is untouched

    await actions.removePerson(form({ person_id: sasaki.id })); // serves Suzuki-san: refused
    expect(await store.getPerson(sasaki.id)).not.toBeNull();
    await actions.assignRoles(form({ resident_id: "suzuki", helper: "p_tanaka", second_contact: "p_takada", snow_volunteer: "p_yamamoto" }));
    await expect(actions.removePerson(form({ person_id: sasaki.id }))).rejects.toThrow("redirect:/people");
    expect(await store.getPerson(sasaki.id)).toBeNull();
  });

  it("refuses to assign someone who isn't on file", async () => {
    await actions.assignRoles(form({ resident_id: "sato", helper: "p_made_up", second_contact: "p_yuki", snow_volunteer: "p_yamamoto" }));
    expect((await store.getResident("sato"))!.helper.id).toBe("p_tanaka");
  });

  it("removes a LINE registration and hands out a fresh code", async () => {
    await actions.unregister(form({ person_id: "p_tanaka" }));
    const tanaka = (await store.getPerson("p_tanaka"))!;
    expect(tanaka.line_id).toBeUndefined();
    expect(tanaka.code).toMatch(/^\d{8}$/);
    await actions.newCode(form({ person_id: "p_tanaka" }));
    expect((await store.getPerson("p_tanaka"))!.code).toMatch(/^\d{8}$/);
  });

  it("refuses every change without the dashboard password", async () => {
    auth.value = "denied";
    const f = form({ person_id: "p_tanaka", name: "x", resident_id: "sato" });
    for (const action of [actions.createPerson, actions.editPerson, actions.removePerson, actions.assignRoles, actions.newCode, actions.unregister]) {
      await expect(action(f)).rejects.toThrow("Unauthorized");
    }
    await expect(actions.sendTestMessage(undefined, f)).rejects.toThrow("Unauthorized");
    expect((await store.getPerson("p_tanaka"))!.name).toBe("民生委員 田中");
  });
});

describe("test message", () => {
  it("sends one message to the person, looked up on the server", async () => {
    expect(await actions.sendTestMessage(undefined, form({ person_id: "p_tanaka" }))).toEqual({ status: "sent" });
    expect(sent).toHaveLength(1);
    expect(sent[0].body.to).toBe("U_helper");
    expect(sent[0].body.messages[0].text).toContain("テスト");
  });

  it("reports failure when the person isn't registered, doesn't exist, or LINE refuses", async () => {
    expect(await actions.sendTestMessage(undefined, form({ person_id: "p_yuki" }))).toEqual({ status: "failed" });
    expect(await actions.sendTestMessage(undefined, form({ person_id: "p_nobody" }))).toEqual({ status: "failed" });
    expect(sent).toHaveLength(0);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("no", { status: 400 })));
    expect(await actions.sendTestMessage(undefined, form({ person_id: "p_tanaka" }))).toEqual({ status: "failed" });
  });
});
