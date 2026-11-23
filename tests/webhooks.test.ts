import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Extraction } from "@/lib/types";

// The model call is replaced; everything else (routes, rules, store, LINE requests) is real.
const extraction: Extraction = {
  answered_by_person: true,
  summary: "雪で玄関が開かず、きのう氷ですべって転び腰が痛い。暖房・食料・薬は足りている。",
  notes: { mood: "落ち着いている", health: "腰の痛み。ゆっくり歩ける", winter: "玄関が雪で開かない。暖房は動いている", needs: ["除雪"] },
  signals: {
    emergency: false, self_harm: false, fall_recent: true, pain: true, cant_move: false, snowed_in: true,
    heater_problem: false, not_eating: false, confused: false, money_request: false, low_mood: false,
  },
  new_facts: ["健太の模試はよくできた"],
};
const extract = vi.fn(async () => extraction);
vi.mock("@/lib/extract", () => ({ extract }));
const placeCall = vi.fn(async () => "conv_retry");
vi.mock("@/lib/elevenlabs", async (original) => ({ ...(await original<typeof import("@/lib/elevenlabs")>()), placeCall }));

// after() needs a real request; here its work is collected and awaited by the test.
const background: Promise<unknown>[] = [];
vi.mock("next/server", async (original) => ({
  ...(await original<typeof import("next/server")>()),
  after: (work: () => Promise<unknown>) => void background.push(work()),
}));

const { POST: elevenlabsRoute } = await import("@/app/api/webhooks/elevenlabs/route");
const { POST: trigger } = await import("@/app/api/calls/trigger/route");
const elevenlabs = async (request: Request) => {
  const res = await elevenlabsRoute(request);
  await Promise.all(background.splice(0));
  return res;
};
const { POST: line } = await import("@/app/api/webhooks/line/route");
const { POST: emergency } = await import("@/app/api/tools/emergency/route");
const store = await import("@/lib/store");

const fixture = readFileSync("tests/fixtures/slip-on-ice.json", "utf8");
type LinePush = {
  to: string;
  messages: { text: string; template: { actions: { data: string }[] } }[];
};
const lineCalls: { url: string; body: LinePush }[] = [];

function signedElevenLabs(body: string, secret = "test-webhook-secret") {
  const t = Math.floor(Date.now() / 1000);
  const v0 = createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
  return new Request("http://test/api/webhooks/elevenlabs", {
    method: "POST", body, headers: { "elevenlabs-signature": `t=${t},v0=${v0}` },
  });
}

function signedLine(events: object[]) {
  const body = JSON.stringify({ events });
  const sig = createHmac("sha256", "test-line-secret").update(body).digest("base64");
  return new Request("http://test/api/webhooks/line", { method: "POST", body, headers: { "x-line-signature": sig } });
}

const say = (userId: string, text: string) =>
  line(signedLine([{ type: "message", replyToken: "r", source: { userId }, message: { type: "text", text } }]));
const tap = (data: string, userId = "U_family") =>
  line(signedLine([{ type: "postback", source: { userId }, postback: { data } }]));
const pushes = () => lineCalls.filter((c) => c.url.endsWith("/push")).map((c) => c.body);

beforeEach(() => {
  lineCalls.length = 0;
  extract.mockClear();
  placeCall.mockClear();
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    lineCalls.push({ url, body: JSON.parse(String(init.body)) });
    return new Response("{}");
  }));
});

describe("LINE roles", () => {
  it("registers teammates for every resident", async () => {
    await say("U_stranger", "家族");
    await say("U_stranger", "家族 0000");
    expect((await store.getResident("sato"))!.second_contact.line_id).toBe("");

    await say("U_helper", "民生委員 1234");
    await say("U_family", "家族 1234");
    await say("U_volunteer", "除雪 1234");
    const sato = await store.getResident("sato");
    expect([sato!.helper.line_id, sato!.second_contact.line_id, sato!.snow_volunteer.line_id])
      .toEqual(["U_helper", "U_family", "U_volunteer"]);
  });

  it("rejects a bad signature", async () => {
    const res = await line(new Request("http://test", { method: "POST", body: "{}", headers: { "x-line-signature": "bad" } }));
    expect(res.status).toBe(401);
  });
});

describe("after a call", () => {
  it("rejects a bad signature without doing anything", async () => {
    const res = await elevenlabs(signedElevenLabs(fixture, "wrong-secret"));
    expect(res.status).toBe(401);
    expect(extract).not.toHaveBeenCalled();
  });

  it("turns the slip-on-ice call into a red alert and a snow request", async () => {
    const res = await elevenlabs(signedElevenLabs(fixture));
    expect(res.status).toBe(200);

    const call = await store.getCall("conv_slip");
    expect(call).toMatchObject({ risk: "red", kind: "call", reasons: ["転倒・痛みあり", "雪で玄関から出られない"] });
    expect(call!.actions).toEqual([
      { type: "alert", to: ["helper", "second_contact"], sent: true },
      { type: "snow_request", to: ["snow_volunteer"], sent: true },
    ]);

    const sent = pushes();
    expect(sent.map((p) => p.to).sort()).toEqual(["U_family", "U_helper", "U_volunteer"]);
    expect(sent.find((p) => p.to === "U_helper")!.messages[0].text).toContain("【要確認】佐藤さん — 転倒・痛みあり");
    expect(sent.find((p) => p.to === "U_volunteer")!.messages[0].template.actions[0].data).toBe("snow_accept:conv_slip");

    const sato = await store.getResident("sato");
    expect(sato!.recent_calls[0].summary).toBe(extraction.summary);
    expect(sato!.facts).toContain("健太の模試はよくできた");
  });

  it("records the volunteer accepting the snow request, and nobody else", async () => {
    await tap("snow_accept:conv_slip", "U_stranger");
    expect((await store.getCall("conv_slip"))!.snow_accepted).toBeUndefined();
    await tap("snow_accept:conv_slip", "U_volunteer");
    expect((await store.getCall("conv_slip"))!.snow_accepted).toBe(true);
  });

  it("puts the call on the visit list and tells the helper when extraction fails", async () => {
    extract.mockRejectedValueOnce(new Error("model unavailable"));
    const body = fixture.replace("conv_slip", "conv_broken").replace('"resident_id": "sato"', '"resident_id": "suzuki"');
    await elevenlabs(signedElevenLabs(body));
    expect(await store.getCall("conv_broken")).toMatchObject({ risk: "yellow", resident_id: "suzuki" });
    expect(pushes().map((p) => p.to)).toEqual(["U_helper"]);
  });

  it("still records the call when LINE is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network down"); }));
    const body = fixture.replace("conv_slip", "conv_offline").replace('"resident_id": "sato"', '"resident_id": "suzuki"');
    await elevenlabs(signedElevenLabs(body));
    const call = await store.getCall("conv_offline");
    expect(call).toMatchObject({ risk: "red" });
    expect(call!.actions.every((a) => !a.sent)).toBe(true);
  });

  it("treats a voicemail greeting as a missed call", async () => {
    extract.mockResolvedValueOnce({ ...extraction, answered_by_person: false });
    const body = fixture.replace("conv_slip", "conv_voicemail").replace('"resident_id": "sato"', '"resident_id": "takahashi"');
    await elevenlabs(signedElevenLabs(body));
    expect(await store.getCall("conv_voicemail")).toBeNull();
    expect(await store.getLadder("takahashi")).toEqual({ stage: "retry" });
    await store.clearLadder("takahashi");
  });
});

describe("in-call emergency", () => {
  const request = (body: object, secret = "test-app-secret") =>
    new Request("http://test", { method: "POST", body: JSON.stringify(body), headers: { "x-app-secret": secret } });

  it("needs the app secret", async () => {
    expect((await emergency(request({ resident_id: "takahashi", kind: "emergency" }, "nope"))).status).toBe(401);
  });

  it("alerts at once, returns the fixed wording, and the after-call alert still goes out", async () => {
    const res = await emergency(request({ resident_id: "takahashi", kind: "emergency", detail: "胸が苦しい" }));
    expect((await res.json()).say_exactly).toContain("119番");
    expect(pushes().map((p) => p.to).sort()).toEqual(["U_family", "U_helper"]);
    expect((await store.listCalls("takahashi"))[0]).toMatchObject({ kind: "emergency", risk: "red" });

    lineCalls.length = 0;
    extract.mockResolvedValueOnce({ ...extraction, signals: { ...extraction.signals, emergency: true, snowed_in: false } });
    const body = fixture.replace("conv_slip", "conv_chest").replace('"resident_id": "sato"', '"resident_id": "takahashi"');
    await elevenlabs(signedElevenLabs(body));
    expect((await store.getCall("conv_chest"))!.risk).toBe("red");
    expect(pushes().map((p) => p.to).sort()).toEqual(["U_family", "U_helper"]);
  });
});

describe("missed-call ladder", () => {
  const failure = (conversationId: string) =>
    elevenlabs(signedElevenLabs(JSON.stringify({ type: "call_initiation_failure", data: { conversation_id: conversationId } })));

  it("retries, asks the second contact, then alerts when nobody confirms", async () => {
    vi.useFakeTimers();
    await store.savePending("conv_a1", { resident_id: "suzuki", attempt: 1 });
    await failure("conv_a1");
    expect(await store.getLadder("suzuki")).toEqual({ stage: "retry" });

    await vi.advanceTimersByTimeAsync(20_000);
    // The timer reads the ladder file before it calls.
    await vi.waitFor(() => expect(placeCall).toHaveBeenCalledWith(expect.objectContaining({ id: "suzuki" }), 2));

    await store.savePending("conv_a2", { resident_id: "suzuki", attempt: 2 });
    await failure("conv_a2");
    expect(pushes()[0].messages[0].template.actions.map((a) => a.data)).toEqual(["ok:suzuki", "ng:suzuki"]);

    await vi.advanceTimersByTimeAsync(20_000);
    vi.useRealTimers();
    // The timer's file writes finish a moment after the clock is advanced.
    await vi.waitFor(async () =>
      expect((await store.listCalls("suzuki"))[0]).toMatchObject({ kind: "missed", risk: "red" }),
    );
    expect(await store.getLadder("suzuki")).toBeNull();
  });

  it("skips the retry when the resident was reached in the meantime", async () => {
    vi.useFakeTimers();
    await store.savePending("conv_d1", { resident_id: "takahashi", attempt: 1 });
    await failure("conv_d1");
    await store.clearLadder("takahashi");
    await vi.advanceTimersByTimeAsync(20_000);
    vi.useRealTimers();
    await new Promise((resolve) => setTimeout(resolve, 100)); // let the timer's file read finish
    expect(placeCall).not.toHaveBeenCalled();
  });

  it("starts the ladder when a call cannot be placed", async () => {
    placeCall.mockRejectedValueOnce(new Error("ElevenLabs down"));
    await store.saveResident({ ...(await store.getResident("takahashi"))!, phone: "+819000000000" });
    const res = await trigger(new Request("http://test", {
      method: "POST", body: JSON.stringify({ resident_id: "takahashi" }), headers: { "x-app-secret": "test-app-secret" },
    }));
    expect(res.status).toBe(502);
    expect(await store.getLadder("takahashi")).toEqual({ stage: "retry" });
    await store.clearLadder("takahashi");
  });

  it("logs green when the second contact confirms the resident is OK, ignoring strangers", async () => {
    await store.savePending("conv_b2", { resident_id: "sato", attempt: 2 });
    await failure("conv_b2");
    await tap("ok:sato", "U_stranger");
    expect(await store.getLadder("sato")).toEqual({ stage: "second_contact" });
    await tap("ok:sato");
    expect((await store.listCalls("sato"))[0]).toMatchObject({ kind: "confirmed_ok", risk: "green" });
  });

  it("alerts right away when the second contact can't confirm", async () => {
    await store.savePending("conv_c2", { resident_id: "sato", attempt: 2 });
    await failure("conv_c2");
    lineCalls.length = 0;
    await tap("ng:sato");
    expect((await store.listCalls("sato"))[0]).toMatchObject({ kind: "missed", risk: "red" });
    expect(pushes().map((p) => p.to).sort()).toEqual(["U_family", "U_helper"]);
  });

  it("treats a call where nobody spoke as missed", async () => {
    const silent = JSON.stringify({
      type: "post_call_transcription",
      data: { conversation_id: "conv_silent", conversation_initiation_client_data: { dynamic_variables: { resident_id: "takahashi" } },
        transcript: [{ role: "agent", message: "もしもし、高橋さんですか。" }] },
    });
    await elevenlabs(signedElevenLabs(silent));
    expect(await store.getLadder("takahashi")).toEqual({ stage: "retry" });
    expect(extract).not.toHaveBeenCalled();
  });
});

describe("phone number", () => {
  const form = (fields: Record<string, string>) => {
    const data = new FormData();
    for (const [k, v] of Object.entries(fields)) data.set(k, v);
    return data;
  };

  it("saves an international number and rejects anything else", async () => {
    vi.doMock("next/cache", () => ({ revalidatePath: () => {} }));
    const { savePhone } = await import("@/app/actions");
    await savePhone(form({ resident_id: "takahashi", phone: "+81 90-1234-5678" }));
    expect((await store.getResident("takahashi"))!.phone).toBe("+819012345678");
    await savePhone(form({ resident_id: "takahashi", phone: "090-1234-5678" }));
    expect((await store.getResident("takahashi"))!.phone).toBe("+819012345678");
  });

  it("refuses to trigger a call for a resident with no number", async () => {
    const res = await trigger(new Request("http://test", {
      method: "POST", body: JSON.stringify({ resident_id: "suzuki" }), headers: { "x-app-secret": "test-app-secret" },
    }));
    expect(res.status).toBe(400);
    expect(placeCall).not.toHaveBeenCalled();
  });
});
