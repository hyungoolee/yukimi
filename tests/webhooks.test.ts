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
  english: { summary: "Snowed in; slipped on ice yesterday and her hip hurts.", mood: "Calm", health: "Hip pain", winter: "Door blocked by snow", needs: ["Snow clearing"] },
};
const extract = vi.fn(async () => extraction);
vi.mock("@/lib/extract", () => ({ extract }));
// The second model call, for memory. By default it proposes nothing.
const curate = vi.fn<typeof import("@/lib/curate").curate>(async () => ({ resolved: [], new_follow_ups: [] }));
vi.mock("@/lib/curate", () => ({ curate }));
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
const settled = (route: (request: Request) => Promise<Response>) => async (request: Request) => {
  const res = await route(request);
  await Promise.all(background.splice(0));
  return res;
};
const elevenlabs = settled(elevenlabsRoute);
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
const { POST: line } = await import("@/app/api/webhooks/line/route");
const { POST: emergencyRoute } = await import("@/app/api/tools/emergency/route");
const emergency = settled(emergencyRoute);
const store = await import("@/lib/store");
const { runDue } = await import("@/lib/tick");
/** Runs scheduled work as if this many seconds had passed. */
const after = (seconds: number) => runDue(Date.now() + seconds * 1000);

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

beforeEach(async () => {
  // Each test starts with no scheduled work, so nothing left by an earlier test can fire in this one.
  for (const task of await store.listTasks()) await store.deleteTask(task.id);
  lineCalls.length = 0;
  extract.mockClear();
  curate.mockClear();
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

    await say("U_helper", "民生委員　１２３４"); // full-width space and digits, as a Japanese keyboard types them
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
    expect(call!.actions).toMatchObject([
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
    expect(await store.getLadder("takahashi")).toMatchObject({ stage: "retry" });
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
    expect((await res.json()).say_exactly).toContain("いちいちきゅう番");
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

describe("in-call emergency with a bad resident ID", () => {
  const request = (body: object) =>
    new Request("http://test", { method: "POST", body: JSON.stringify(body), headers: { "x-app-secret": "test-app-secret" } });

  it("still returns the wording and tells every helper when the resident is unknown", async () => {
    const res = await emergency(request({ resident_id: "だれか", kind: "self_harm", detail: "もう生きていたくない" }));
    expect((await res.json()).say_exactly).toContain("よりそいホットライン");
    expect(pushes().map((p) => p.to)).toEqual(["U_helper"]);
    expect(pushes()[0].messages[0].text).toContain("利用者を特定できませんでした");
  });

  it("alerts nobody and records nothing for a console test call", async () => {
    const res = await emergency(request({ resident_id: "test", kind: "emergency", detail: "テスト" }));
    expect((await res.json()).say_exactly).toContain("いちいちきゅう番");
    expect(pushes()).toEqual([]);
    await elevenlabs(signedElevenLabs(fixture.replace("conv_slip", "conv_console").replace('"resident_id": "sato"', '"resident_id": "test"')));
    expect(await store.getCall("conv_console")).toBeNull();
    expect(await store.getCall("conv_console-error")).toBeNull();
    expect(extract).not.toHaveBeenCalled();
  });

  it("finds the resident by name when the ID is their name", async () => {
    await emergency(request({ resident_id: "高橋さん", kind: "emergency", detail: "倒れた" }));
    expect((await store.listCalls("takahashi"))[0]).toMatchObject({ kind: "emergency", risk: "red" });
  });
});

describe("missed-call ladder", () => {
  const failure = (conversationId: string) =>
    elevenlabs(signedElevenLabs(JSON.stringify({ type: "call_initiation_failure", data: { conversation_id: conversationId } })));

  it("retries, asks the second contact, then alerts when nobody confirms", async () => {
    await store.saveResident({ ...(await store.getResident("suzuki"))!, phone: "+819000000001" });
    await store.savePending("conv_a1", { resident_id: "suzuki", attempt: 1 });
    await failure("conv_a1");
    expect(await store.getLadder("suzuki")).toMatchObject({ stage: "retry" });

    await after(0);
    expect(placeCall).not.toHaveBeenCalled(); // not before its time
    await after(21);
    expect(placeCall).toHaveBeenCalledWith(expect.objectContaining({ id: "suzuki" }), 2);

    await store.savePending("conv_a2", { resident_id: "suzuki", attempt: 2 });
    await failure("conv_a2");
    expect(pushes()[0].messages[0].template.actions.map((a) => a.data)).toEqual(["ok:suzuki", "ng:suzuki"]);

    await after(21);
    expect((await store.listCalls("suzuki"))[0]).toMatchObject({ kind: "missed", risk: "red" });
    expect(await store.getLadder("suzuki")).toBeNull();
    await store.saveResident({ ...(await store.getResident("suzuki"))!, phone: "" });
  });

  it("skips the retry when the resident was reached in the meantime", async () => {
    await store.savePending("conv_d1", { resident_id: "takahashi", attempt: 1 });
    await failure("conv_d1");
    await store.clearLadder("takahashi");
    await after(21);
    expect(placeCall).not.toHaveBeenCalled();
  });

  it("starts the ladder when a call cannot be placed", async () => {
    placeCall.mockRejectedValueOnce(new Error("ElevenLabs down"));
    await store.saveResident({ ...(await store.getResident("takahashi"))!, phone: "+819000000000" });
    const res = await trigger(new Request("http://test", {
      method: "POST", body: JSON.stringify({ resident_id: "takahashi" }), headers: { "x-app-secret": "test-app-secret" },
    }));
    expect(res.status).toBe(502);
    expect(await store.getLadder("takahashi")).toMatchObject({ stage: "retry" });
    await store.clearLadder("takahashi");
  });

  it("logs green when the second contact confirms the resident is OK, ignoring strangers", async () => {
    await store.savePending("conv_b2", { resident_id: "sato", attempt: 2 });
    await failure("conv_b2");
    await tap("ok:sato", "U_stranger");
    expect(await store.getLadder("sato")).toMatchObject({ stage: "second_contact" });
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

  it("does not restart a ladder that is already waiting on the second contact", async () => {
    await store.savePending("conv_e2", { resident_id: "suzuki", attempt: 2 });
    await failure("conv_e2");
    expect(await store.getLadder("suzuki")).toMatchObject({ stage: "second_contact" });
    await store.savePending("conv_e3", { resident_id: "suzuki", attempt: 1 }); // someone presses "call now"
    await failure("conv_e3");
    expect(await store.getLadder("suzuki")).toMatchObject({ stage: "second_contact" });
    await store.clearLadder("suzuki");
  });

  it("restarts over a stale ladder file left by a server restart", async () => {
    await store.saveLadder("suzuki", { stage: "second_contact", at: Date.now() - 2 * 60 * 60 * 1000 });
    await store.savePending("conv_g1", { resident_id: "suzuki", attempt: 1 });
    await failure("conv_g1");
    expect(await store.getLadder("suzuki")).toMatchObject({ stage: "retry" });
    await store.clearLadder("suzuki");
  });

  it("reads the attempt from the call's variables, and ignores other event types", async () => {
    await store.savePending("conv_f2", { resident_id: "suzuki", attempt: 2 });
    await elevenlabs(signedElevenLabs(JSON.stringify({ type: "post_call_audio", data: { conversation_id: "conv_f2" } })));
    expect(await store.getPending("conv_f2")).toEqual({ resident_id: "suzuki", attempt: 2 });
    await store.clearPending("conv_f2");

    await elevenlabs(signedElevenLabs(JSON.stringify({
      type: "call_initiation_failure",
      data: { conversation_id: "conv_f9", conversation_initiation_client_data: { dynamic_variables: { resident_id: "suzuki", attempt: "2" } } },
    })));
    expect(await store.getLadder("suzuki")).toMatchObject({ stage: "second_contact" });
    await store.clearLadder("suzuki");
  });

  it("treats a call where nobody spoke as missed", async () => {
    const silent = JSON.stringify({
      type: "post_call_transcription",
      data: { conversation_id: "conv_silent", conversation_initiation_client_data: { dynamic_variables: { resident_id: "takahashi" } },
        transcript: [{ role: "agent", message: "もしもし、高橋さんですか。" }] },
    });
    await elevenlabs(signedElevenLabs(silent));
    expect(await store.getLadder("takahashi")).toMatchObject({ stage: "retry" });
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
    expect(await savePhone(undefined, form({ resident_id: "takahashi", phone: "+81 90-1234-5678" }))).toEqual({ status: "saved", typed: "+819012345678" });
    expect((await store.getResident("takahashi"))!.phone).toBe("+819012345678");
    await savePhone(undefined, form({ resident_id: "takahashi", phone: "+81 090 1234 5678" }));
    expect((await store.getResident("takahashi"))!.phone).toBe("+819012345678");
    await savePhone(undefined, form({ resident_id: "takahashi", phone: "080-1111-2222" }));
    expect((await store.getResident("takahashi"))!.phone).toBe("+818011112222");
    expect(await savePhone(undefined, form({ resident_id: "takahashi", phone: "not a number" }))).toEqual({ status: "invalid", typed: "not a number" });
    await savePhone(undefined, form({ resident_id: "takahashi", phone: "010-1234-5678" })); // a Korean mobile in local format
    expect((await store.getResident("takahashi"))!.phone).toBe("+818011112222");
    await savePhone(undefined, form({ resident_id: "takahashi", phone: "+82 10-1234-5678" }));
    expect((await store.getResident("takahashi"))!.phone).toBe("+821012345678");
    await savePhone(undefined, form({ resident_id: "takahashi", phone: "080-1111-2222" }));
    expect((await store.getResident("takahashi"))!.phone).toBe("+818011112222");
    expect(await savePhone(undefined, form({ resident_id: "../calls/conv_slip", phone: "+819012345678" }))).toMatchObject({ status: "invalid" });
    expect((await store.listResidents()).map((r) => r.id).sort()).toEqual(["sato", "suzuki", "takahashi"]);
  });

  it("refuses to trigger a call for a resident with no number", async () => {
    const res = await trigger(new Request("http://test", {
      method: "POST", body: JSON.stringify({ resident_id: "suzuki" }), headers: { "x-app-secret": "test-app-secret" },
    }));
    expect(res.status).toBe(400);
    expect(placeCall).not.toHaveBeenCalled();
  });
});

describe("locations", () => {
  const form = (fields: Record<string, string>) => {
    const data = new FormData();
    for (const [k, v] of Object.entries(fields)) data.set(k, v);
    return data;
  };

  it("places a home pin, and refuses a point outside Japan or an empty form", async () => {
    vi.doMock("next/cache", () => ({ revalidatePath: () => {} }));
    const { saveLocation } = await import("@/app/actions");
    await saveLocation(form({ resident_id: "sato", who: "home", lat: "43.25", lng: "141.8" }));
    expect((await store.getResident("sato"))!.location).toEqual({ lat: 43.25, lng: 141.8 });
    await saveLocation(form({ resident_id: "sato", who: "home", lat: "48.85", lng: "2.35" }));
    await saveLocation(form({ resident_id: "sato", who: "home", lat: "", lng: "" }));
    expect((await store.getResident("sato"))!.location).toEqual({ lat: 43.25, lng: 141.8 });
  });

  it("moves a shared volunteer's pin for every resident they serve", async () => {
    const { saveLocation } = await import("@/app/actions");
    await saveLocation(form({ resident_id: "sato", who: "snow_volunteer", lat: "43.3", lng: "141.9" }));
    for (const r of await store.listResidents()) {
      expect(r.snow_volunteer.location).toEqual({ lat: 43.3, lng: 141.9 });
      expect(r.snow_volunteer.line_id).toBe("U_volunteer");
    }
  });
});

describe("calls without a phone line", () => {
  it("hands the browser a token and the resident's variables", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ token: "tok_test" }))));
    process.env.ELEVENLABS_AGENT_ID = "agent_test";
    process.env.ELEVENLABS_API_KEY = "key_test";
    const { startBrowserCall } = await import("@/app/actions");
    const { token, variables } = await startBrowserCall("sato");
    expect(token).toBe("tok_test");
    expect(variables).toMatchObject({ resident_id: "sato", attempt: "1", name: "佐藤", introducer: "娘のゆきさん", channel: "browser" });
    expect(variables.weather).toContain("-12℃");
    expect(variables.winter_check).toMatch(/^必要/);
  });

  it("does not start the phone ladder for a silent or voicemail-like browser call", async () => {
    await store.clearLadder("takahashi");
    const browser = { dynamic_variables: { resident_id: "takahashi", attempt: "1", channel: "browser" } };
    await elevenlabs(signedElevenLabs(JSON.stringify({
      type: "post_call_transcription",
      data: { conversation_id: "conv_web_silent", conversation_initiation_client_data: browser,
        transcript: [{ role: "agent", message: "もしもし、高橋さんですか。" }] },
    })));
    extract.mockResolvedValueOnce({ ...extraction, answered_by_person: false });
    await elevenlabs(signedElevenLabs(JSON.stringify({
      type: "post_call_transcription",
      data: { conversation_id: "conv_web_other", conversation_initiation_client_data: browser,
        transcript: [{ role: "agent", message: "もしもし。" }, { role: "user", message: "いま留守です。" }] },
    })));
    expect(await store.getLadder("takahashi")).toBeNull();
    expect(await store.getCall("conv_web_other")).toBeNull();
  });

  it("skips the retry call and asks the second contact when the resident has no phone number", async () => {
    await store.clearLadder("suzuki");
    await store.savePending("conv_h1", { resident_id: "suzuki", attempt: 1 });
    await elevenlabs(signedElevenLabs(JSON.stringify({ type: "call_initiation_failure", data: { conversation_id: "conv_h1" } })));
    await after(21);
    expect(await store.getLadder("suzuki")).toMatchObject({ stage: "second_contact" });
    expect(placeCall).not.toHaveBeenCalled();
    await store.clearLadder("suzuki");
  });

  it("starts the missed-call ladder from the demo no-answer button", async () => {
    const { simulateNoAnswer } = await import("@/app/actions");
    const data = new FormData();
    data.set("resident_id", "takahashi");
    await store.clearLadder("takahashi");
    await simulateNoAnswer(data);
    expect(await store.getLadder("takahashi")).toMatchObject({ stage: "retry" });
    await store.clearLadder("takahashi");
  });
});

describe("dashboard language", () => {
  it("translates the fixed reasons and keeps what the resident said", async () => {
    const { reasonText, strings } = await import("@/lib/i18n");
    expect(reasonText("en", "転倒・痛みあり")).toBe("Fell and is in pain");
    expect(reasonText("en", "緊急の訴え（119番を案内）：胸が苦しい")).toBe("Emergency (told to call 119)：胸が苦しい");
    expect(reasonText("en", "電話に応答なし。ゆきさんが無事を確認")).toBe("No answer; the second contact confirmed they are fine");
    expect(reasonText("ja", "転倒・痛みあり")).toBe("転倒・痛みあり");
    expect(reasonText("en", "3日続けて食事をとれていない")).toBe("Not eating for 3 days running");
    expect(reasonText("en", "気分の落ち込みが3日続いている（継続中）")).toBe("Low mood for 3 days running (ongoing)");
    expect(reasonText("en", "知らない理由")).toBe("知らない理由");
    const sato = (await store.getResident("sato"))!;
    expect(strings.en.name(sato)).toBe("Sato-san");
    expect(strings.ja.name(sato)).toBe("佐藤さん");
  });

  it("has an English reason for every reason the rules can give", async () => {
    const { reasonText } = await import("@/lib/i18n");
    const { applyRules } = await import("@/lib/rules");
    const all = { emergency: true, self_harm: true, fall_recent: true, pain: true, cant_move: true, snowed_in: true,
      heater_problem: true, not_eating: true, confused: true, money_request: true, low_mood: true };
    const weather = { station: "x", date: "2026-11-26", snowfall_24h_cm: 0, snow_depth_cm: 0, low_c: -5 };
    const reasons = [
      ...applyRules(all, weather).reasons,
      ...applyRules({ ...all, pain: false, cant_move: false, emergency: false }, { ...weather, low_c: 3 }).reasons,
      ...applyRules({ ...all, heater_problem: false }, weather).reasons,
    ];
    for (const reason of new Set(reasons)) expect(reasonText("en", reason), reason).not.toBe(reason);
  });
});

describe("demo reset", () => {
  it("clears calls and ladders and restores memory, keeping phone numbers and LINE registrations", async () => {
    const { resetDemo } = await import("@/app/actions");
    await store.saveResident({ ...(await store.getResident("sato"))!, phone: "+819011112222" });
    await store.saveLadder("sato", { stage: "retry", at: Date.now() });
    // A disk set up before the map existed has no pins; one resident has been placed by hand.
    const suzuki = (await store.getResident("suzuki"))!;
    await store.saveResident({ ...suzuki, location: undefined, snow_volunteer: { ...suzuki.snow_volunteer, location: undefined } });
    await store.saveResident({ ...(await store.getResident("takahashi"))!, location: { lat: 43.3, lng: 141.9 } });
    expect((await store.listCalls()).length).toBeGreaterThan(0);
    expect((await store.getResident("sato"))!.facts).toContain("健太の模試はよくできた");

    await resetDemo();

    expect(await store.listCalls()).toEqual([]);
    expect(await store.getLadder("sato")).toBeNull();
    const sato = (await store.getResident("sato"))!;
    expect(sato.facts).not.toContain("健太の模試はよくできた");
    expect(sato.recent_calls[0].date).toBe("2026-11-25");
    expect(sato.phone).toBe("+819011112222");
    expect(sato.helper.line_id).toBe("U_helper");
    // The unplaced demo resident gets the seed's made-up pins; a pin placed by hand is kept.
    const placed = (await store.getResident("suzuki"))!;
    expect(placed.location).toEqual({ lat: 43.189, lng: 141.792 });
    expect(placed.snow_volunteer.location).toEqual({ lat: 43.1975, lng: 141.779 });
    expect((await store.getResident("takahashi"))!.location).toEqual({ lat: 43.3, lng: 141.9 });
  });
});

describe("red alerts must be acknowledged", () => {
  const about = (name: string) => pushes().filter((p) => p.messages[0].text?.includes(name));

  it("sends the alert again until someone taps the button, and records who did", async () => {
    await store.clearLadder("takahashi");
    const body = fixture.replace("conv_slip", "conv_ack").replace('"resident_id": "sato"', '"resident_id": "takahashi"');
    await elevenlabs(signedElevenLabs(body));
    const first = about("高橋").find((p) => p.to === "U_helper")!;
    expect(first.messages[1].template.actions[0].data).toBe("ack:conv_ack");

    lineCalls.length = 0;
    await after(31);
    expect(about("高橋").map((p) => p.to).sort()).toEqual(["U_family", "U_helper"]);
    expect(about("高橋")[0].messages[0].text).toContain("再通知1回目");
    expect((await store.getCall("conv_ack"))!.alert_rounds).toBe(1);

    await tap("ack:conv_ack", "U_stranger");
    expect((await store.getCall("conv_ack"))!.acknowledged_by).toBeUndefined();
    await tap("ack:conv_ack", "U_helper");
    expect((await store.getCall("conv_ack"))!.acknowledged_by).toBe("民生委員 田中");

    lineCalls.length = 0;
    await after(62);
    expect(about("高橋")).toEqual([]);
  });

  it("stops after three re-sends, and stops at once when the call is marked handled", async () => {
    const body = fixture.replace("conv_slip", "conv_quiet").replace('"resident_id": "sato"', '"resident_id": "takahashi"');
    await elevenlabs(signedElevenLabs(body));
    for (const seconds of [31, 62, 93, 124, 155]) await after(seconds);
    expect((await store.getCall("conv_quiet"))!.alert_rounds).toBe(3);

    const again = fixture.replace("conv_slip", "conv_done").replace('"resident_id": "sato"', '"resident_id": "takahashi"');
    await elevenlabs(signedElevenLabs(again));
    await store.saveCall({ ...(await store.getCall("conv_done"))!, handled: true });
    lineCalls.length = 0;
    await after(200);
    expect(about("高橋")).toEqual([]);
  });

  it("re-sends the in-call emergency alert and the missed-call alert too", async () => {
    await emergency(new Request("http://test", {
      method: "POST", headers: { "x-app-secret": "test-app-secret" },
      body: JSON.stringify({ resident_id: "takahashi", kind: "emergency", detail: "胸が苦しい" }),
    }));
    expect(about("高橋")[0].messages[1].template.actions[0].data).toMatch(/^ack:emergency-/);
    await store.savePending("conv_m2", { resident_id: "takahashi", attempt: 2 });
    await elevenlabs(signedElevenLabs(JSON.stringify({ type: "call_initiation_failure", data: { conversation_id: "conv_m2" } })));
    await tap("ng:takahashi");
    lineCalls.length = 0;
    await after(31);
    const resent = about("高橋").map((p) => p.messages[0].text);
    expect(resent.some((t) => t.includes("再通知1回目") && t.includes("緊急の訴え"))).toBe(true);
    expect(resent.some((t) => t.includes("再通知1回目") && t.includes("電話に2回応答なし"))).toBe(true);
  });

  it("keeps re-sending even if the call record was never saved", async () => {
    await store.schedule({
      kind: "alert_recheck", resident_id: "takahashi", call_id: "conv_never_saved", round: 1,
      to: ["helper"], reasons: ["転倒・痛みあり"], due: Date.now() - 1,
    });
    await after(0);
    expect(about("高橋").map((p) => p.to)).toEqual(["U_helper"]);
    expect((await store.listTasks()).some((t) => t.call_id === "conv_never_saved" && t.round === 2)).toBe(true);
  });

  it("keeps an acknowledgement that arrives while other changes are being saved", async () => {
    const body = fixture.replace("conv_slip", "conv_race").replace('"resident_id": "sato"', '"resident_id": "takahashi"');
    await elevenlabs(signedElevenLabs(body));
    await Promise.all([
      store.updateCall("conv_race", () => ({ alert_rounds: 1 })),
      tap("ack:conv_race", "U_helper"),
      store.updateCall("conv_race", () => ({ snow_accepted: true })),
    ]);
    expect(await store.getCall("conv_race")).toMatchObject({
      acknowledged_by: "民生委員 田中", alert_rounds: 1, snow_accepted: true,
    });
  });

  it("ignores a step left over from an earlier ladder", async () => {
    await store.saveLadder("takahashi", { stage: "second_contact", at: Date.now() });
    await store.schedule({ kind: "ladder_confirm", resident_id: "takahashi", ladder_at: 12345, due: Date.now() - 1 });
    const before = (await store.listCalls("takahashi")).length;
    await after(0);
    expect((await store.listCalls("takahashi")).length).toBe(before);
    expect(await store.getLadder("takahashi")).toMatchObject({ stage: "second_contact" });
    await store.clearLadder("takahashi");
  });

  it("does not ask for acknowledgement on a yellow alert", async () => {
    extract.mockRejectedValueOnce(new Error("model unavailable"));
    const body = fixture.replace("conv_slip", "conv_yellow").replace('"resident_id": "sato"', '"resident_id": "takahashi"');
    await elevenlabs(signedElevenLabs(body));
    expect(about("高橋")[0].messages).toHaveLength(1);
  });
});

describe("demo script", () => {
  it("has every line in Japanese, romaji and English, and never trips the emergency rule", async () => {
    const { DEMO_SCRIPT } = await import("@/lib/demo-script");
    expect(DEMO_SCRIPT.length).toBeGreaterThan(4);
    for (const line of DEMO_SCRIPT) {
      for (const text of [line.when.ja, line.when.en, line.say, line.romaji, line.meaning]) expect(text).not.toBe("");
      expect(line.say).not.toMatch(/胸|息|立てない|動けない|死/);
    }
  });
});

describe("live captions", () => {
  it("returns the translation, or an empty caption when translating fails", async () => {
    const translateToEnglish = vi.fn(async () => "Is your heater on?");
    vi.doMock("@/lib/translate", () => ({ translateToEnglish }));
    vi.resetModules();
    const { translateCaption } = await import("@/app/actions");
    expect(await translateCaption("暖房はついていますか。")).toBe("Is your heater on?");
    translateToEnglish.mockRejectedValueOnce(new Error("model unavailable"));
    expect(await translateCaption("暖房はついていますか。")).toBe("");
  });
});

describe("one writer at a time", () => {
  it("keeps both of two overlapping changes to the same resident", async () => {
    const before = (await store.getResident("sato"))!;
    await Promise.all([
      store.updateResident("sato", (r) => ({ ...r, phone: "+819011110000" })),
      store.updateResident("sato", (r) => ({ ...r, facts: [...r.facts, "同時に書かれた事実"] })),
      store.updateResident("sato", (r) => ({ ...r, location: { lat: 43.2, lng: 141.77 } })),
    ]);
    const after = (await store.getResident("sato"))!;
    expect(after.phone).toBe("+819011110000");
    expect(after.facts).toContain("同時に書かれた事実");
    expect(after.location).toEqual({ lat: 43.2, lng: 141.77 });
    await store.saveResident(before);
  });

  it("carries on after a change that throws, and returns null for an unknown resident", async () => {
    await expect(store.updateResident("sato", () => { throw new Error("bad change"); })).rejects.toThrow("bad change");
    expect(await store.updateResident("sato", (r) => r)).toMatchObject({ id: "sato" });
    expect(await store.updateResident("nobody", (r) => r)).toBeNull();
  });
});

describe("trends across days", () => {
  const blank = { ate: "unknown", slept_well: "unknown", went_out: "unknown", pain_or_injury: "unknown", low_mood: "unknown" } as const;
  const notEaten = { ...extraction, observations: { ...blank, ate: "no" as const }, signals: { ...extraction.signals, fall_recent: false, pain: false, snowed_in: false, not_eating: true } };
  const earlier = (id: string, daysAgo: number, residentId = "suzuki") =>
    store.saveCall({
      id, resident_id: residentId, at: new Date(Date.now() - daysAgo * 86_400_000).toISOString(), kind: "call",
      risk: "yellow", reasons: ["食事をとれていない"], actions: [], handled: true, extraction: notEaten,
    });
  const callToday = (id: string, residentId = "suzuki") =>
    elevenlabs(signedElevenLabs(fixture.replace("conv_slip", id).replace('"resident_id": "sato"', `"resident_id": "${residentId}"`)));

  it("alerts helper and family on the third day of not eating, once", async () => {
    await earlier("conv_t1", 1);
    extract.mockResolvedValueOnce(notEaten);
    await callToday("conv_t2");
    expect(await store.getCall("conv_t2")).toMatchObject({ risk: "yellow", reasons: ["食事をとれていない"] });
    expect(pushes()).toEqual([]);

    await earlier("conv_t0", 2);
    extract.mockResolvedValueOnce(notEaten).mockResolvedValueOnce(notEaten);
    await Promise.all([callToday("conv_t3"), callToday("conv_t3b")]);
    const calls = await Promise.all([store.getCall("conv_t3"), store.getCall("conv_t3b")]);
    expect(calls.map((call) => call?.risk)).toEqual(["red", "red"]);
    expect(calls.flatMap((call) => call?.reasons ?? [])).toContain("3日続けて食事をとれていない（継続中）");
    expect(pushes().map((p) => p.to).sort()).toEqual(["U_family", "U_helper"]);
    expect((await store.listTasks()).filter((task) => task.kind === "alert_recheck")).toHaveLength(1);

    // A later call can inherit today's observation even when meals did not come up.
    lineCalls.length = 0;
    extract.mockResolvedValueOnce({ ...notEaten, observations: blank, signals: { ...notEaten.signals, not_eating: false } });
    await callToday("conv_t3c");
    expect(await store.getCall("conv_t3c")).toMatchObject({
      risk: "red", reasons: ["3日続けて食事をとれていない（継続中）"],
    });
    expect(pushes()).toEqual([]);
  });

  it("keeps a helper-only reason out of the family's initial alert and resend", async () => {
    await earlier("conv_private1", 1, "sato");
    await earlier("conv_private2", 2, "sato");
    extract.mockResolvedValueOnce({ ...notEaten, signals: { ...notEaten.signals, self_harm: true } });
    await callToday("conv_private3", "sato");

    const helper = () => pushes().find((p) => p.to === "U_helper")?.messages[0].text;
    const family = () => pushes().find((p) => p.to === "U_family")?.messages[0].text;
    expect(helper()).toContain("死にたい気持ちの訴え");
    expect(family()).toContain("3日続けて食事をとれていない");
    expect(family()).not.toContain("死にたい気持ちの訴え");

    lineCalls.length = 0;
    await after(31);
    expect(helper()).toContain("死にたい気持ちの訴え");
    expect(family()).toContain("3日続けて食事をとれていない");
    expect(family()).not.toContain("死にたい気持ちの訴え");
  });

  it("still records and alerts the acute finding when trend history fails", async () => {
    using history = vi.spyOn(store, "listCalls").mockRejectedValueOnce(new Error("history unavailable"));
    extract.mockResolvedValueOnce({ ...extraction, observations: { ...blank, pain_or_injury: "yes" } });
    await callToday("conv_after_bad", "takahashi");
    expect(history).toHaveBeenCalledWith("takahashi");
    expect(await store.getCall("conv_after_bad")).toMatchObject({ risk: "red", reasons: ["転倒・痛みあり", "雪で玄関から出られない"] });
    expect(pushes().map((p) => p.to)).toContain("U_helper");
  });

  it("allows another call to fire a trend if the first call couldn't schedule its alert", async () => {
    await earlier("conv_retry_trend1", 1, "takahashi");
    await earlier("conv_retry_trend2", 2, "takahashi");
    using schedule = vi.spyOn(store, "schedule").mockRejectedValueOnce(new Error("task storage unavailable"));
    extract.mockResolvedValueOnce(notEaten).mockResolvedValueOnce(notEaten);
    await callToday("conv_retry_trend_fail", "takahashi");
    expect(schedule).toHaveBeenCalledTimes(1);
    expect(pushes().map((p) => p.to)).not.toContain("U_family");

    lineCalls.length = 0;
    await callToday("conv_retry_trend_ok", "takahashi");
    expect(pushes().map((p) => p.to).sort()).toEqual(["U_family", "U_helper"]);
  });
});

describe("follow-ups after a call", () => {
  const call = (id: string, residentId: string) =>
    elevenlabs(signedElevenLabs(fixture.replace("conv_slip", id).replace('"resident_id": "sato"', `"resident_id": "${residentId}"`)));

  it("saves what the model proposes, hands it to the next call, and lets the helper remove it", async () => {
    curate.mockResolvedValueOnce({ resolved: [], new_follow_ups: [{ text: "腰の痛みはその後どうか", days: 3 }] });
    await call("conv_fu1", "takahashi");
    const saved = (await store.getResident("takahashi"))!.follow_ups!;
    expect(saved.map((f) => f.text)).toEqual(["腰の痛みはその後どうか"]);
    expect(curate).toHaveBeenCalledWith(expect.objectContaining({ id: "takahashi" }), [], expect.any(Array), expect.any(String));

    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ token: "tok_test" }))));
    const { startBrowserCall, deleteFollowUp } = await import("@/app/actions");
    expect((await startBrowserCall("takahashi")).variables.follow_ups).toBe("・腰の痛みはその後どうか");
    expect((await startBrowserCall("suzuki")).variables.follow_ups).toBe("なし");

    const data = new FormData();
    data.set("resident_id", "takahashi");
    data.set("follow_up_id", saved[0].id);
    await deleteFollowUp(data);
    expect((await store.getResident("takahashi"))!.follow_ups).toEqual([]);
  });

  it("shows the model the open follow-ups, and closes the ones it says are settled", async () => {
    await store.updateResident("takahashi", (r) => ({
      ...r, follow_ups: [{ id: "hip", text: "腰の痛みはその後どうか", created: "2026-11-01", expires: "2099-01-01" }],
    }));
    curate.mockResolvedValueOnce({ resolved: ["hip"], new_follow_ups: [] });
    await call("conv_fu2", "takahashi");
    expect(curate.mock.calls[0][1]).toEqual([expect.objectContaining({ id: "hip" })]);
    expect((await store.getResident("takahashi"))!.follow_ups).toEqual([]);
  });

  it("when curation fails: the call, its alerts and its summary are all still there, with no extra alert", async () => {
    curate.mockRejectedValueOnce(new Error("model unavailable"));
    const before = (await store.getResident("suzuki"))!.follow_ups;
    await call("conv_fu3", "suzuki");
    expect(curate).toHaveBeenCalledTimes(1);
    expect(await store.getCall("conv_fu3")).toMatchObject({ risk: "red", reasons: ["転倒・痛みあり", "雪で玄関から出られない"] });
    expect(await store.getCall("conv_fu3-error")).toBeNull();
    expect(pushes().map((p) => p.to).sort()).toEqual(["U_family", "U_helper", "U_volunteer"]);
    const after = (await store.getResident("suzuki"))!;
    expect(after.recent_calls[0].summary).toBe(extraction.summary);
    expect(after.follow_ups).toEqual(before);
  });

  it("does not curate a voicemail, a silent call, or a call that could not be judged", async () => {
    extract.mockResolvedValueOnce({ ...extraction, answered_by_person: false });
    await call("conv_fu4", "takahashi");
    await store.clearLadder("takahashi");

    await elevenlabs(signedElevenLabs(JSON.stringify({
      type: "post_call_transcription",
      data: { conversation_id: "conv_fu5", conversation_initiation_client_data: { dynamic_variables: { resident_id: "takahashi" } },
        transcript: [{ role: "agent", message: "もしもし、高橋さんですか。" }] },
    })));
    await store.clearLadder("takahashi");

    extract.mockRejectedValueOnce(new Error("model unavailable"));
    await call("conv_fu6", "takahashi");
    expect(await store.getCall("conv_fu6")).toMatchObject({ risk: "yellow" });
    expect(curate).not.toHaveBeenCalled();
  });

  it("clears follow-ups on a demo reset", async () => {
    await store.updateResident("sato", (r) => ({
      ...r, follow_ups: [{ id: "x", text: "腰", created: "2026-11-01", expires: "2099-01-01" }],
    }));
    const { resetDemo } = await import("@/app/actions");
    await resetDemo();
    expect((await store.getResident("sato"))!.follow_ups).toEqual([]);
  });
});
