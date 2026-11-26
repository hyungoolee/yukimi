import { cp, mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = { value: "ok" as "ok" | "denied" };
vi.mock("node:fs/promises", { spy: true });
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
    await store.assign("suzuki", { snow_helper: "p_nobody" });
    expect((await store.getResident("suzuki"))!.snow_helper).toEqual({ id: "p_nobody", name: "" });
    // Saving the resident for another reason keeps who was assigned, in case the person's file comes back.
    await store.updateResident("suzuki", (r) => ({ ...r, phone: r.phone }));
    expect((await store.getResident("suzuki"))!.snow_helper.id).toBe("p_nobody");
    await store.assign("suzuki", { snow_helper: "p_yamamoto" });
  });

  it("refuses to save a resident with a person typed into a role, since only the id is kept", async () => {
    const sato = (await store.getResident("sato"))!;
    expect(() => store.saveResident({ ...sato, helper: { name: "新しい人", line_id: "U_x" } })).toThrow("not a saved person");
    await store.saveResident({ ...sato, helper: { name: "" } }); // a vacant post is fine
    expect((await store.getResident("sato"))!.helper).toEqual({ name: "" });
    await store.assign("sato", { helper: "p_tanaka" });
  });

  it("backfills family metadata once across store copies and preserves the latest LINE registration", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "yukimi-family-"));
    await cp(path.join(process.cwd(), "data/seed"), dir, { recursive: true });
    const file = path.join(dir, "people", "p_yuki.json");
    const old = JSON.parse(await readFile(file, "utf8"));
    delete old.family_of;
    await writeFile(file, JSON.stringify({ ...old, code: "12345678" }));

    vi.stubEnv("DATA_DIR", dir);
    try {
      vi.resetModules();
      const reader = await import("@/lib/store");
      vi.resetModules();
      const writer = await import("@/lib/store");

      const [person] = await Promise.all([
        reader.getPerson("p_yuki"),
        writer.updatePerson("p_yuki", (p) => ({ ...p, line_id: "U_yuki", code: undefined })),
      ]);
      expect(person?.family_of).toBe("sato");
      const saved = await reader.getPerson("p_yuki");
      expect(saved).toMatchObject({ family_of: "sato", line_id: "U_yuki" });
      expect(saved?.code).toBeUndefined();
      expect(vi.mocked(readdir).mock.calls.filter(([at]) => at === path.join(dir, "residents"))).toHaveLength(1);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("gives a disk from before people had files its people from the seed, once, keeping everything else", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "yukimi-old-"));
    await mkdir(path.join(dir, "residents"));
    const old = { id: "sato", name: "佐藤", phone: "+819011112222", call_time: "09:00", facts: ["覚えていること"], recent_calls: [],
      helper: { name: "民生委員 田中", line_id: "" }, second_contact: { name: "ゆき" }, snow_volunteer: { name: "山本" } };
    const mine = { ...old, id: "mine", helper: { name: "だれか" } }; // not a seed resident
    await writeFile(path.join(dir, "residents", "sato.json"), JSON.stringify(old));
    await writeFile(path.join(dir, "residents", "mine.json"), JSON.stringify(mine));
    await writeFile(path.join(dir, "residents", "broken.json"), "{bad"); // one unreadable file must not stop the rest
    await cp(path.join(process.cwd(), "data/seed/weather.json"), path.join(dir, "weather.json"));

    vi.resetModules();
    vi.stubEnv("DATA_DIR", dir);
    const fresh = await import("@/lib/store");
    const sato = (await fresh.getResident("sato"))!;
    expect(sato).toMatchObject({ phone: "+819011112222", facts: [{ text: "覚えていること" }], helper: { id: "p_tanaka" }, second_contact: { id: "p_yuki" }, snow_helper: { id: "p_yamamoto" } });
    expect((await fresh.getResident("mine"))!.helper).toEqual({ name: "" });
    await fresh.updatePerson("p_tanaka", (p) => ({ ...p, line_id: "U_kept" }));

    vi.resetModules(); // a restart: nothing is converted twice, and a registration made since is kept
    const again = await import("@/lib/store");
    expect((await again.getResident("sato"))!.helper.line_id).toBe("U_kept");
    expect((await again.getPerson("p_yuki"))!.family_of).toBe("sato");
    expect(JSON.parse(await readFile(path.join(dir, "residents", "sato.json"), "utf8")).helper).toBe("p_tanaka");
    vi.unstubAllEnvs();
  });

  it("moves a snow helper saved under the role's old name, keeping who it is", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "yukimi-snow-"));
    await cp(path.join(process.cwd(), "data/seed"), dir, { recursive: true });
    const file = path.join(dir, "residents", "sato.json");
    const { snow_helper, ...rest } = JSON.parse(await readFile(file, "utf8"));
    expect(snow_helper).toBe("p_yamamoto");
    await writeFile(file, JSON.stringify({ ...rest, snow_volunteer: "p_tanaka" }));

    vi.resetModules();
    vi.stubEnv("DATA_DIR", dir);
    const fresh = await import("@/lib/store");
    expect((await fresh.getResident("sato"))!.snow_helper.id).toBe("p_tanaka");
    const saved = JSON.parse(await readFile(file, "utf8"));
    expect(saved).toMatchObject({ snow_helper: "p_tanaka" });
    expect("snow_volunteer" in saved).toBe(false);
    vi.unstubAllEnvs();
  });

  it("keeps the snow helper when an older release has since added the old name from the seed", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "yukimi-rollback-"));
    await cp(path.join(process.cwd(), "data/seed"), dir, { recursive: true });
    const file = path.join(dir, "residents", "sato.json");
    const stored = JSON.parse(await readFile(file, "utf8"));
    await writeFile(file, JSON.stringify({ ...stored, snow_helper: "p_tanaka", snow_volunteer: "p_yamamoto" }));

    vi.resetModules();
    vi.stubEnv("DATA_DIR", dir);
    const fresh = await import("@/lib/store");
    expect((await fresh.getResident("sato"))!.snow_helper.id).toBe("p_tanaka");
    expect("snow_volunteer" in JSON.parse(await readFile(file, "utf8"))).toBe(false);
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

    await actions.assignRoles(form({ resident_id: "suzuki", helper: sasaki.id, second_contact: "p_takada", snow_helper: "" }));
    const suzuki = (await store.getResident("suzuki"))!;
    expect([suzuki.helper.id, suzuki.second_contact.id, suzuki.snow_helper.name]).toEqual([sasaki.id, "p_takada", ""]);
    expect(suzuki.facts.length).toBeGreaterThan(0); // the rest of the file is untouched

    await actions.removePerson(form({ person_id: sasaki.id })); // serves Suzuki-san: refused
    expect(await store.getPerson(sasaki.id)).not.toBeNull();
    await actions.assignRoles(form({ resident_id: "suzuki", helper: "p_tanaka", second_contact: "p_takada", snow_helper: "p_yamamoto" }));
    await expect(actions.removePerson(form({ person_id: sasaki.id }))).rejects.toThrow("redirect:/people");
    expect(await store.getPerson(sasaki.id)).toBeNull();
  });

  it("saves one place in the snow line at a time, keeping the others and their agreement", async () => {
    const a = await store.addPerson("除雪A", undefined, undefined, "business");
    const b = await store.addPerson("除雪B");
    // Place 2, then place 3: each menu saves on its own, as the page sends only the one that changed.
    expect(await actions.assignRoles(form({ resident_id: "sato", snow_next_0: a.id }))).toBe(true);
    expect(await actions.assignRoles(form({ resident_id: "sato", snow_next_1: b.id }))).toBe(true);
    let sato = (await store.getResident("sato"))!;
    expect(sato.snow_next!.map((c) => c.id)).toEqual([a.id, b.id]);
    expect(sato.paid_ok).toEqual([a.id]); // chosen while marked as a business

    // b is marked as a business afterwards. Changing place 2 must not count as agreeing to b.
    await store.updatePerson(b.id, (p) => ({ ...p, kind: "business" }));
    await actions.assignRoles(form({ resident_id: "sato", snow_next_0: "" }));
    sato = (await store.getResident("sato"))!;
    expect(sato.snow_next!.map((c) => c.id)).toEqual([b.id]);
    expect(sato.paid_ok ?? []).toEqual([]);
    // Choosing b again, in a place of its own, is the agreement.
    await actions.assignRoles(form({ resident_id: "sato", snow_next_0: b.id }));
    expect((await store.getResident("sato"))!.paid_ok).toEqual([b.id]);
    // Someone first in line is not repeated after them, and another resident's family is refused.
    expect(await actions.assignRoles(form({ resident_id: "sato", snow_next_1: "p_yamamoto" }))).toBe(true);
    expect((await store.getResident("sato"))!.snow_next!.map((c) => c.id)).toEqual([b.id]);
    expect(await actions.assignRoles(form({ resident_id: "sato", snow_next_1: "p_takada" }))).toBe(false);
    await actions.assignRoles(form({ resident_id: "sato", snow_next_0: "" }));
  });

  it("refuses to assign someone who isn't on file", async () => {
    await actions.assignRoles(form({ resident_id: "sato", helper: "p_made_up", second_contact: "p_yuki", snow_helper: "p_yamamoto" }));
    expect((await store.getResident("sato"))!.helper.id).toBe("p_tanaka");
  });

  it("offers a family contact only for their own resident's family post", async () => {
    const before = (await store.getResident("sato"))!;
    // Suzuki-san's family (p_takada) can't become Sato-san's family or helper; someone else's helper can't be family.
    for (const roles of [
      { helper: "p_tanaka", second_contact: "p_takada", snow_helper: "p_yamamoto" },
      { helper: "p_takada", second_contact: "p_yuki", snow_helper: "p_yamamoto" },
      { helper: "p_tanaka", second_contact: "p_yamamoto", snow_helper: "p_yamamoto" },
    ]) await actions.assignRoles(form({ resident_id: "sato", ...roles }));
    const sato = (await store.getResident("sato"))!;
    expect([sato.helper.id, sato.second_contact.id]).toEqual([before.helper.id, before.second_contact.id]);
  });

  it("adds a family contact tied to one resident, filling the family post only when it is vacant", async () => {
    await expect(actions.createFamily(form({ resident_id: "sato", name: "ゆきの夫" }))).rejects.toThrow("redirect:/people/p_");
    const husband = (await store.listPeople()).find((p) => p.name === "ゆきの夫")!;
    expect(husband).toMatchObject({ family_of: "sato", code: expect.stringMatching(/^\d{8}$/) });
    expect((await store.getResident("sato"))!.second_contact.id).toBe("p_yuki"); // already held: unchanged

    await store.assign("sato", { second_contact: "" });
    await expect(actions.createFamily(form({ resident_id: "sato", name: "ゆきの娘" }))).rejects.toThrow("redirect:/people/p_");
    const daughter = (await store.listPeople()).find((p) => p.name === "ゆきの娘")!;
    expect((await store.getResident("sato"))!.second_contact.id).toBe(daughter.id);

    await store.assign("sato", { second_contact: "p_yuki" });
    for (const p of [husband, daughter]) await store.deletePerson(p.id);
  });

  it("keeps a family assignment saved while a new contact is being created", async () => {
    await store.assign("sato", { second_contact: "" });
    const started = Promise.withResolvers<void>();
    const resume = Promise.withResolvers<void>();
    const addPerson = store.addPerson;
    using create = vi.spyOn(store, "addPerson").mockImplementationOnce(async (...args) => {
      started.resolve();
      await resume.promise;
      return addPerson(...args);
    });

    const creation = expect(actions.createFamily(form({ resident_id: "sato", name: "New family contact" })))
      .rejects.toThrow("redirect:/people/p_");
    await started.promise;
    try {
      await actions.assignRoles(form({ resident_id: "sato", helper: "p_tanaka", second_contact: "p_yuki", snow_helper: "p_yamamoto" }));
    } finally {
      resume.resolve();
    }
    await creation;
    expect(create).toHaveBeenCalledWith("New family contact", undefined, "sato");
    expect((await store.getResident("sato"))?.second_contact.id).toBe("p_yuki");
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
    for (const action of [actions.createPerson, actions.createFamily, actions.editPerson, actions.removePerson, actions.assignRoles, actions.newCode, actions.unregister]) {
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
