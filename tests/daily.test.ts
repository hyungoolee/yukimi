import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const placeCall = vi.fn<(resident: { id: string }) => Promise<string>>(async () => "conv_daily");
vi.mock("@/lib/elevenlabs", async (original) => ({ ...(await original<typeof import("@/lib/elevenlabs")>()), placeCall }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { placeDailyCalls, UNPLACED } = await import("@/lib/daily");
const { missed } = await import("@/lib/ladder");
const store = await import("@/lib/store");

// Seed call times: Sato 09:00, Suzuki 09:30, Takahashi 10:00. Japan is UTC+9.
const at = (time: string, date = "2026-11-26") => new Date(`${date}T${time}:00+09:00`);
const called = () => placeCall.mock.calls.map(([resident]) => resident.id);
const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
};

beforeEach(async () => {
  placeCall.mockClear();
  placeCall.mockImplementation(async () => "conv_daily");
  vi.stubEnv("DAILY_CALLS", "1");
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}")));
  for (const { id } of await store.listResidents()) {
    await store.updateResident(id, (r) => ({ ...r, phone: "+819000000000", active: undefined, scheduled_on: undefined }));
    await store.clearLadder(id);
  }
  for (const task of await store.listTasks()) await store.deleteTask(task.id);
  for (const call of await store.listCalls()) await store.saveCall({ ...call, at: "2026-11-01T00:00:00Z", reasons: [] });
  await store.clearPending("conv_busy");
});
afterEach(() => vi.unstubAllEnvs());

describe("daily calls", () => {
  it("places nothing unless DAILY_CALLS is on", async () => {
    vi.stubEnv("DAILY_CALLS", "");
    await placeDailyCalls(at("11:00"));
    expect(called()).toEqual([]);
  });

  it("calls each resident once, at their time, one call per run", async () => {
    await placeDailyCalls(at("08:59"));
    expect(called()).toEqual([]);
    await placeDailyCalls(at("09:00"));
    await placeDailyCalls(at("09:01")); // Sato is done; Suzuki is not due yet
    expect(called()).toEqual(["sato"]);
    await placeDailyCalls(at("10:00")); // Suzuki and Takahashi are both due: one now, one on the next run
    expect(called()).toEqual(["sato", "suzuki"]);
    await placeDailyCalls(at("10:00"));
    await placeDailyCalls(at("10:00"));
    expect(called()).toEqual(["sato", "suzuki", "takahashi"]);

    await placeDailyCalls(at("09:00", "2026-11-27")); // and again the next day
    expect(called()).toEqual(["sato", "suzuki", "takahashi", "sato"]);
  });

  it("waits while as many calls are in progress as the plan allows", async () => {
    vi.stubEnv("MAX_CONCURRENT_CALLS", "1");
    vi.useFakeTimers({ now: at("09:00") });
    await store.savePending("conv_busy", { resident_id: "takahashi", attempt: 1 });
    await placeDailyCalls(at("09:00"));
    expect(called()).toEqual([]);
    await placeDailyCalls(at("09:20")); // a call that never reported back stops counting
    expect(called()).toEqual(["sato"]);
    vi.useRealTimers();
  });

  it("skips a resident with no number, one who is stopped, and one already spoken to today", async () => {
    await store.updateResident("sato", (r) => ({ ...r, phone: "" }));
    await store.updateResident("suzuki", (r) => ({ ...r, active: false }));
    await store.saveCall({ id: "by_hand", resident_id: "takahashi", at: at("08:00").toISOString(), kind: "call", risk: "green", reasons: [], actions: [] });
    for (let i = 0; i < 3; i++) await placeDailyCalls(at("10:30"));
    expect(called()).toEqual([]);
  });

  it("still calls someone who waited more than two hours for a free line", async () => {
    vi.stubEnv("MAX_CONCURRENT_CALLS", "1");
    vi.useFakeTimers({ now: at("11:25") });
    await store.savePending("conv_busy", { resident_id: "takahashi", attempt: 1 });
    await placeDailyCalls(at("09:00")); // Sato joins the queue on time, but the line is taken
    await placeDailyCalls(at("11:30"));
    expect(called()).toEqual([]);
    await store.clearPending("conv_busy");
    await placeDailyCalls(at("11:30"));
    expect(called()).toEqual(["sato"]);
    expect(await store.listCalls("sato")).not.toContainEqual(expect.objectContaining({ reasons: [UNPLACED] }));
    vi.useRealTimers();
  });

  it("leaves alone someone already on the phone or in the missed-call steps", async () => {
    await missed("sato", 1); // a call by hand rang out earlier: the retry is already booked
    await store.savePending("conv_busy", { resident_id: "suzuki", attempt: 1 }); // on the phone right now
    for (let i = 0; i < 3; i++) await placeDailyCalls(new Date());
    expect(called().filter((id) => id !== "takahashi")).toEqual([]);
    await store.clearPending("conv_busy");
  });

  it("does not phone late or tell the family: a call the app was down for is noted for the coordinator", async () => {
    await store.updateResident("sato", (r) => ({ ...r, scheduled_on: "2026-11-25" }));
    await placeDailyCalls(at("11:01")); // Sato's 09:00 call is more than two hours late
    expect(called()).toEqual(["suzuki"]); // Sato is not phoned; Suzuki's 09:30 is still within two hours
    expect(await store.getLadder("sato")).toBeNull();
    expect((await store.listCalls("sato"))[0]).toMatchObject({ kind: "missed", risk: "yellow", reasons: [UNPLACED] });
  });

  it("stays quiet on the day daily calls are first switched on after someone's time", async () => {
    await placeDailyCalls(at("11:01")); // Sato was never scheduled before
    expect((await store.listCalls("sato")).filter((c) => c.reasons.includes(UNPLACED))).toEqual([]);
    expect((await store.getResident("sato"))!.scheduled_on).toBe("2026-11-26");
  });

  it("notes a call the phone service refuses, without telling the family nobody answered", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    placeCall.mockRejectedValueOnce(new Error("no lines"));
    await placeDailyCalls(at("09:00"));
    expect(await store.getLadder("sato")).toBeNull();
    expect((await store.listCalls("sato"))[0]).toMatchObject({ risk: "yellow", reasons: [UNPLACED] });
    await placeDailyCalls(at("09:01"));
    expect(called()).toEqual(["sato"]); // not dialled again today
  });

  it("never rings someone whose call time can't be read", async () => {
    await store.updateResident("sato", (r) => ({ ...r, call_time: "9:" }));
    await placeDailyCalls(at("00:05"));
    await placeDailyCalls(at("12:00"));
    expect(called()).not.toContain("sato");
    await store.updateResident("sato", (r) => ({ ...r, call_time: "09:00" }));
  });
});

describe("a stopped resident", () => {
  it("can't be called by hand, and missed-call steps stop", async () => {
    const { setActive, callNow } = await import("@/app/actions");
    await missed("sato", 1);
    expect(await store.getLadder("sato")).not.toBeNull();
    await setActive(form({ resident_id: "sato", active: "0" }));
    expect((await store.getResident("sato"))!.active).toBe(false);
    expect(await store.getLadder("sato")).toBeNull();

    await callNow(form({ resident_id: "sato" }));
    await missed("sato", 1);
    expect(called()).toEqual([]);
    expect(await store.getLadder("sato")).toBeNull();

    await setActive(form({ resident_id: "sato", active: "1" }));
    await callNow(form({ resident_id: "sato" }));
    expect(called()).toEqual(["sato"]);
  });

  it("is picked up the next day when resumed, with today not reported as a failed call", async () => {
    const { setActive } = await import("@/app/actions");
    await store.updateResident("sato", (r) => ({ ...r, scheduled_on: "2026-11-25", active: false }));
    await setActive(form({ resident_id: "sato", active: "1" }));
    placeCall.mockClear();
    await placeDailyCalls(at("15:00"));
    expect(called()).not.toContain("sato");
    expect((await store.listCalls("sato")).filter((c) => c.reasons.includes(UNPLACED))).toEqual([]);
    await placeDailyCalls(at("09:00", "2026-11-27"));
    expect(called()).toContain("sato");
  });
});
