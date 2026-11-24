import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MEASURES } from "@/lib/measures";
import type { Extraction, Observations } from "@/lib/types";

// The model call is replaced; everything else (routes, rules, store, LINE requests) is real.
const extraction: Extraction = {
  answered_by_person: true,
  summary: "雪で玄関が開かず、きのう氷ですべって転び腰が痛い。暖房・食料・薬は足りている。",
  notes: { mood: "落ち着いている", health: "腰の痛み。ゆっくり歩ける", winter: "玄関が雪で開かない。暖房は動いている", needs: ["除雪"] },
  signals: {
    emergency: false, self_harm: false, fall_recent: true, pain: true, cant_move: false, snowed_in: true,
    heater_problem: false, not_eating: false, confused: false, money_request: false, low_mood: false,
  },
  english: { summary: "Snowed in; slipped on ice yesterday and her hip hurts.", mood: "Calm", health: "Hip pain", winter: "Door blocked by snow", needs: ["Snow clearing"] },
};
const extract = vi.fn(async () => extraction);
vi.mock("@/lib/extract", () => ({ extract }));
// The second model call, for memory. By default it proposes nothing.
const curate = vi.fn<typeof import("@/lib/curate").curate>(async () => ({ fact_changes: noFacts, resolved: [], new_follow_ups: [] }));
const noFacts: import("@/lib/curate").Curation["fact_changes"] = { add: [], update: [], retire: [] };
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
/** A browser call's variables; fails the test with the reason if the call could not start. */
function variablesOf<V>(started: { variables: V } | { error: string }) {
  if ("error" in started) throw new Error(started.error);
  return started.variables;
}
/** Ends every help request a resident has open, so the next call starts afresh. */
async function closeRequests(residentId: string) {
  for (const c of await store.listCalls(residentId)) {
    await store.updateCall(c.id, (call) => ({ actions: call.actions.map((a) => (a.type === "request" ? { ...a, done: true } : a)) }));
  }
}
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
  it("registers each person with their own code, once", async () => {
    const code = async (id: string) => (await store.renewCode(id))!.code!;
    const helperCode = await code("p_tanaka");
    await say("U_stranger", "家族 1234"); // the old shared code
    await say("U_stranger", helperCode === "00000000" ? "11111111" : "00000000");
    expect((await store.getPerson("p_tanaka"))!.line_id).toBeUndefined();

    // Full-width digits, as a Japanese keyboard types them.
    await say("U_helper", helperCode.replace(/\d/g, (d) => String.fromCharCode(d.charCodeAt(0) + 0xfee0)));
    await say("U_stranger", helperCode); // a used code registers nobody else
    await say("U_volunteer", await code("p_yamamoto"));
    // In these tests one LINE account plays every resident's family contact.
    for (const id of ["p_yuki", "p_takada", "p_masaru"]) await say("U_family", await code(id));

    expect(await store.getPerson("p_tanaka")).toMatchObject({ line_id: "U_helper" });
    expect((await store.getPerson("p_tanaka"))!.code).toBeUndefined();
    const sato = await store.getResident("sato");
    expect([sato!.helper.line_id, sato!.second_contact.line_id, sato!.snow_volunteer.line_id])
      .toEqual(["U_helper", "U_family", "U_volunteer"]);
    expect((await store.getResident("takahashi"))!.second_contact).toMatchObject({ id: "p_masaru", line_id: "U_family" });
    expect(lineCalls.at(-1)!.body.messages[0].text).toBe("登録しました（まさるさん）");
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
      { type: "request", kind: "snow", to: ["snow_volunteer"], sent: true },
    ]);

    const sent = pushes();
    expect(sent.map((p) => p.to).sort()).toEqual(["U_family", "U_helper", "U_volunteer"]);
    expect(sent.find((p) => p.to === "U_helper")!.messages[0].text).toContain("【要確認】佐藤さん — 転倒・痛みあり");
    expect(sent.find((p) => p.to === "U_volunteer")!.messages[0].template.actions[0].data).toMatch(/^accept:conv_slip:snow:\d{4}-\d\d-\d\d:[ap]m$/);

    const sato = await store.getResident("sato");
    expect(sato!.recent_calls[0].summary).toBe(extraction.summary);
    expect(sato!.facts.map((f) => f.text)).toEqual(["孫の健太が大学受験中", "庭でバラを育てている", "ひざが少し悪い"]);
  });

  const snowOf = async (id: string) => (await store.getCall(id))!.actions.find((a) => a.type === "request" && a.kind === "snow")!;
  const lastReply = () => lineCalls.filter((c) => c.url.endsWith("/reply")).at(-1)?.body.messages[0].text;

  it("records the volunteer's time slot, from the volunteer and nobody else, and the first answer stands", async () => {
    const { slotChoices } = await import("@/lib/requests");
    const [first, second] = slotChoices();
    const button = (kind: string, slot = first) => `accept:conv_slip:${kind}:${slot.date}:${slot.part}`;
    await tap(button("snow"), "U_stranger");
    await tap(button("supplies"), "U_volunteer"); // not theirs to take
    await tap("accept:conv_slip:snow:2020-01-01:am", "U_volunteer"); // a half-day that is over
    expect(lastReply()).toBe("その時間は過ぎています。ほかの時間を押してください。");
    expect((await snowOf("conv_slip")).accepted_by).toBeUndefined();

    await tap(button("snow"), "U_volunteer");
    expect(await snowOf("conv_slip")).toMatchObject({ accepted_by: "山本", slot: first });
    expect(lastReply()).toContain("佐藤さん宅、");

    await tap(button("snow", second), "U_volunteer");
    expect((await snowOf("conv_slip")).slot).toEqual(first);
    expect(lastReply()).toBe("すでに引き受け済みです。ありがとうございます。");
  });

  it("still takes the button from before there were time slots", async () => {
    await closeRequests("sato");
    await tap("snow_accept:conv_slip", "U_volunteer"); // nothing open any more
    expect(lastReply()).toBe("この件はもう済んでいます。ありがとうございます。");
    const body = fixture.replace("conv_slip", "conv_old_button");
    await elevenlabs(signedElevenLabs(body));
    await tap("snow_accept:conv_old_button", "U_volunteer");
    const request = await snowOf("conv_old_button");
    expect(request.accepted_by).toBe("山本");
    expect(request.slot).toBeUndefined();
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
    expect(await store.getPending("conv_f2")).toMatchObject({ resident_id: "suzuki", attempt: 2 });
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
    const started = await startBrowserCall("sato");
    if ("error" in started) throw new Error(started.error);
    const { token, variables } = started;
    expect(token).toBe("tok_test");
    expect(variables).toMatchObject({ resident_id: "sato", attempt: "1", name: "佐藤", introducer: "娘のゆきさん", channel: "browser" });
    expect(variables.weather).toContain("-12℃");
    expect(variables.winter_check).toMatch(/^必要/);
  });

  it("tells the page why a browser call could not start, since a thrown error loses its message in production", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 401 })));
    const { startBrowserCall } = await import("@/app/actions");
    expect(await startBrowserCall("sato")).toEqual({ error: "ElevenLabs token request failed (401)" });
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
    await store.saveResident({ ...suzuki, location: undefined });
    await store.updatePerson("p_yamamoto", (p) => ({ ...p, location: undefined }));
    await store.saveResident({ ...(await store.getResident("takahashi"))!, location: { lat: 43.3, lng: 141.9 } });
    expect((await store.listCalls()).length).toBeGreaterThan(0);
    await store.updateResident("sato", (r) => ({
      ...r, care_notes: "夫の話はしない", facts: [...r.facts, { id: "x", text: "通話で覚えた事実", since: "2026-11-25", source: "call" }],
    }));

    await resetDemo();

    expect(await store.listCalls()).toEqual([]);
    expect(await store.getLadder("sato")).toBeNull();
    const sato = (await store.getResident("sato"))!;
    expect(sato.facts.map((f) => f.text)).toEqual(["孫の健太が大学受験中", "庭でバラを育てている", "ひざが少し悪い"]);
    expect([sato.care_notes, sato.retired_facts, sato.memory_log]).toEqual(["", [], []]);
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
      store.updateCall("conv_race", () => ({ handled: false })),
    ]);
    expect(await store.getCall("conv_race")).toMatchObject({
      acknowledged_by: "民生委員 田中", alert_rounds: 1, handled: false,
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
      store.updateResident("sato", (r) => ({ ...r, care_notes: "同時に書かれた注意" })),
      store.updateResident("sato", (r) => ({ ...r, location: { lat: 43.2, lng: 141.77 } })),
    ]);
    const after = (await store.getResident("sato"))!;
    expect(after.phone).toBe("+819011110000");
    expect(after.care_notes).toBe("同時に書かれた注意");
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
  // Nothing came up except sleep, the one question every call must get an answer to.
  const blank: Observations = { ...(Object.fromEntries(MEASURES.map((m) => [m.field, "unknown"])) as Observations), slept_well: "yes" };
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
    curate.mockResolvedValueOnce({ fact_changes: noFacts, resolved: [], new_follow_ups: [{ text: "腰の痛みはその後どうか", days: 3 }] });
    await call("conv_fu1", "takahashi");
    const saved = (await store.getResident("takahashi"))!.follow_ups!;
    expect(saved.map((f) => f.text)).toEqual(["腰の痛みはその後どうか"]);
    expect(curate).toHaveBeenCalledWith(expect.objectContaining({ id: "takahashi" }), [], expect.any(Array), expect.any(String));

    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ token: "tok_test" }))));
    const { startBrowserCall, deleteFollowUp } = await import("@/app/actions");
    const followUps = async (id: string) => variablesOf(await startBrowserCall(id)).follow_ups;
    expect(await followUps("takahashi")).toBe("・腰の痛みはその後どうか");
    expect(await followUps("suzuki")).toBe("なし");

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
    curate.mockResolvedValueOnce({ fact_changes: noFacts, resolved: ["hip"], new_follow_ups: [] });
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

  it("flags a call that ended before a required question, counting the winter ones only when this call's agent was told to ask", async () => {
    const quiet = Object.fromEntries(Object.keys(extraction.signals).map((k) => [k, false])) as Extraction["signals"];
    const unknown = Object.fromEntries(MEASURES.map((m) => [m.field, "unknown"])) as Observations;
    // Answered about sleep and the heating, then hung up. (They also ate: this resident has days of not eating from the tests above.)
    const cutShort = { ...extraction, signals: quiet, observations: { ...unknown, ate: "yes" as const, slept_well: "yes" as const, heating_ok: "yes" as const } };
    const post = (id: string, winter_check: string) =>
      elevenlabs(signedElevenLabs(JSON.stringify({
        type: "post_call_transcription",
        data: { conversation_id: id, conversation_initiation_client_data: { dynamic_variables: { resident_id: "takahashi", winter_check } },
          transcript: [{ role: "user", message: "はい、もう切りますね。" }] },
      })));

    extract.mockResolvedValueOnce(cutShort);
    await post("conv_cut1", "不要。天気の話は軽くふれる程度でよい。");
    expect(await store.getCall("conv_cut1")).toMatchObject({ risk: "green", reasons: [] });
    expect(pushes()).toEqual([]);

    extract.mockResolvedValueOnce(cutShort);
    await post("conv_cut2", "必要。暖房が動いているか、玄関から出られるか、食料と薬が足りているかを必ず確認する。");
    expect(await store.getCall("conv_cut2")).toMatchObject({ risk: "yellow", reasons: ["通話が終わる前に確認できなかった：玄関・雪／食料・薬"] });
    expect(pushes().map((p) => p.to)).toEqual(["U_helper"]);

    // Later the same day, hello and gone: sleep was already answered this morning, so nothing is missing.
    extract.mockResolvedValueOnce({ ...cutShort, observations: unknown });
    await post("conv_cut3", "不要。天気の話は軽くふれる程度でよい。");
    expect(await store.getCall("conv_cut3")).toMatchObject({ risk: "green", reasons: [] });

    // The webhook's variables don't say: what was saved when the call was placed is used.
    await store.savePending("conv_cut5", { resident_id: "suzuki", attempt: 1, winter_checks: true });
    extract.mockResolvedValueOnce(cutShort);
    await elevenlabs(signedElevenLabs(JSON.stringify({
      type: "post_call_transcription",
      data: { conversation_id: "conv_cut5", conversation_initiation_client_data: { dynamic_variables: { resident_id: "suzuki" } },
        transcript: [{ role: "user", message: "はい。" }] },
    })));
    expect(await store.getCall("conv_cut5")).toMatchObject({ reasons: ["通話が終わる前に確認できなかった：玄関・雪／食料・薬"] });
  });

  it("does not curate a call whose extraction worked but whose rules could not run", async () => {
    // The saved weather file goes missing, so the rules can't run even though extraction did.
    const { rename } = await import("node:fs/promises");
    const file = `${process.env.DATA_DIR}/weather.json`;
    await rename(file, `${file}.away`);
    await call("conv_fu7", "takahashi").finally(() => rename(`${file}.away`, file));
    expect(extract).toHaveBeenCalled();
    expect(await store.getCall("conv_fu7")).toMatchObject({ risk: "yellow", reasons: ["自動判定に失敗。通話メモを確認してください"] });
    expect(curate).not.toHaveBeenCalled();
  });

  // A curation whose model call is still running while something else happens.
  const deferred = () => {
    let finish!: (c: import("@/lib/curate").Curation) => void;
    curate.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
    return (text: string) => finish({ fact_changes: noFacts, resolved: [], new_follow_ups: [{ text, days: 3 }] });
  };

  it("drops a slow curation when the demo was reset in the meantime", async () => {
    const finish = deferred();
    const pending = call("conv_fu8", "takahashi");
    await vi.waitFor(() => expect(curate).toHaveBeenCalled());
    const { resetDemo } = await import("@/app/actions");
    await resetDemo();
    finish("腰の痛みはその後どうか");
    await pending;
    expect((await store.getResident("takahashi"))!.follow_ups).toEqual([]);
  });

  it("drops a slow curation from an older call once a newer call has been processed", async () => {
    const finishOlder = deferred();
    const older = call("conv_fu9", "takahashi");
    await vi.waitFor(() => expect(curate).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 5)); // the newer call's record gets a later time
    curate.mockResolvedValueOnce({ fact_changes: noFacts, resolved: [], new_follow_ups: [{ text: "新しい通話からの確認", days: 3 }] });
    await call("conv_fu10", "takahashi");
    finishOlder("古い通話からの確認");
    await older;
    expect((await store.getResident("takahashi"))!.follow_ups!.map((f) => f.text)).toEqual(["新しい通話からの確認"]);
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

describe("the helper's memory edits", () => {
  const form = (fields: Record<string, string>) => {
    const data = new FormData();
    for (const [k, v] of Object.entries(fields)) data.set(k, v);
    return data;
  };

  it("adds, rewords, retires, restores and deletes a fact, and saves care notes", async () => {
    const actions = await import("@/app/actions");
    const facts = async () => (await store.getResident("suzuki"))!;
    const lines = (await facts()).facts.map((f) => f.text);
    const save = (extra: string[], care_notes = "") =>
      actions.saveMemory(undefined, form({ resident_id: "suzuki", facts: [...lines, ...extra].join("\n"), care_notes }));

    expect((await save(["毎週木曜に書道教室に通う"])).error).toBeUndefined();
    const added = (await facts()).facts.at(-1)!;
    expect(added).toMatchObject({ text: "毎週木曜に書道教室に通う", source: "helper", locked: true });

    await save(["毎週金曜に書道教室に通う"]); // a reworded line: the old one retired, the new one added
    const reworded = (await facts()).facts.at(-1)!;
    expect(reworded.text).toBe("毎週金曜に書道教室に通う");
    expect((await facts()).retired_facts!.map((f) => f.id)).toContain(added.id);

    await save([], "奥さんの話はこちらからしない");
    expect((await facts()).facts.map((f) => f.id)).not.toContain(reworded.id);
    await actions.restoreFactAction(form({ resident_id: "suzuki", fact_id: reworded.id }));
    expect((await facts()).facts.map((f) => f.id)).toContain(reworded.id);

    await save([], "奥さんの話はこちらからしない");
    await actions.deleteFactAction(form({ resident_id: "suzuki", fact_id: added.id }));
    await actions.deleteFactAction(form({ resident_id: "suzuki", fact_id: reworded.id }));
    expect(JSON.stringify(await facts())).not.toContain("書道教室"); // neither wording survives, in the log either

    // A refused list saves nothing, and hands back what was typed.
    const tooLong = "あ".repeat(81);
    expect(await save([tooLong], "別の注意")).toEqual({ error: "too_long", facts: [...lines, tooLong].join("\n"), notes: "別の注意" });
    expect((await facts()).care_notes).toBe("奥さんの話はこちらからしない");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ token: "tok_test" }))));
    expect(variablesOf(await actions.startBrowserCall("suzuki"))).toMatchObject({
      care_notes: "奥さんの話はこちらからしない", facts: "元漁師、猫のタマと暮らしている、週に一度デイサービスに通う",
      briefing: "なし",
    });
  });

  it("does nothing for a resident that doesn't exist or a path-style id", async () => {
    const actions = await import("@/app/actions");
    await actions.saveMemory(undefined, form({ resident_id: "nobody", facts: "x", care_notes: "" }));
    const call = JSON.stringify(await store.getCall("conv_slip"));
    await actions.saveMemory(undefined, form({ resident_id: "../calls/conv_slip", facts: "x", care_notes: "" }));
    expect(JSON.stringify(await store.getCall("conv_slip"))).toBe(call); // the call record was not rewritten as a resident
    expect((await store.listResidents()).map((r) => r.id).sort()).toEqual(["sato", "suzuki", "takahashi"]);
  });
});

describe("today's brief on a call", () => {
  // Nothing came up except sleep, the one question every call must get an answer to.
  const blank: Observations = { ...(Object.fromEntries(MEASURES.map((m) => [m.field, "unknown"])) as Observations), slept_well: "yes" };

  it("reaches the agent when a pattern is running, and never stops a call from being placed", async () => {
    for (const daysAgo of [1, 2, 3]) {
      await store.saveCall({
        id: `conv_brief${daysAgo}`, resident_id: "sato", at: new Date(Date.now() - daysAgo * 86_400_000).toISOString(), kind: "call",
        risk: "yellow", reasons: [], actions: [], handled: true, extraction: { ...extraction, observations: { ...blank, ate: "no" } },
      });
    }
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ token: "tok_test" }))));
    const { startBrowserCall } = await import("@/app/actions");
    expect(variablesOf(await startBrowserCall("sato")).briefing).toBe("・食事のことを、いつもよりていねいに聞く。");

    const broken = vi.spyOn(store, "listCalls").mockRejectedValueOnce(new Error("disk error"));
    expect(variablesOf(await startBrowserCall("sato")).briefing).toBe("なし");
    broken.mockRestore();
  });
});

describe("help requests", () => {
  const quiet = Object.fromEntries(Object.keys(extraction.signals).map((k) => [k, false])) as Extraction["signals"];
  const fine = { ate: "yes", slept_well: "yes", went_out: "no", pain_or_injury: "no", low_mood: "no", heating_ok: "yes" } as const;
  const heard = (id: string, snowedIn: boolean, short: boolean) => {
    extract.mockResolvedValueOnce({
      ...extraction,
      signals: { ...quiet, snowed_in: snowedIn },
      observations: { ...fine, can_get_out: snowedIn ? "no" : "yes", has_supplies: short ? "no" : "yes" },
    });
    return elevenlabs(signedElevenLabs(JSON.stringify({
      type: "post_call_transcription",
      data: { conversation_id: id, conversation_initiation_client_data: { dynamic_variables: { resident_id: "suzuki" } },
        transcript: [{ role: "user", message: "はい。" }] },
    })));
  };
  const requestsOf = async (id: string) => (await store.getCall(id))!.actions.filter((a) => a.type === "request");
  // LINE requests are recorded as usual; the token request for a browser call gets a token.
  beforeEach(() => vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.body) lineCalls.push({ url, body: JSON.parse(String(init.body)) });
    return new Response(JSON.stringify({ token: "tok_test" }));
  })));
  const helpStatus = async () => {
    const { startBrowserCall } = await import("@/app/actions");
    return variablesOf(await startBrowserCall("suzuki")).help_status;
  };

  it("asks once, tells the resident who is coming, and closes when she says it is done", async () => {
    const { slotChoices, slotLabel } = await import("@/lib/requests");
    await closeRequests("suzuki");
    const [first] = slotChoices();

    await heard("conv_h1", true, true);
    expect(await store.getCall("conv_h1")).toMatchObject({ risk: "yellow", reasons: ["雪で玄関から出られない", "食料・薬・灯油が足りない"] });
    // The snow helper and the family are each asked, with three half-days to choose from.
    expect(pushes().map((p) => p.to).sort()).toEqual(["U_family", "U_volunteer"]);
    expect(pushes()[0].messages[0].template.actions).toHaveLength(3);
    expect(await helpStatus()).toContain("引き受ける人がまだ決まっていない");

    await tap(`accept:conv_h1:supplies:${first.date}:${first.part}`, "U_volunteer"); // the family's to take, not theirs
    await tap(`accept:conv_h1:snow:${first.date}:${first.part}`, "U_volunteer");
    await tap(`accept:conv_h1:supplies:${first.date}:${first.part}`, "U_family");
    expect(await requestsOf("conv_h1")).toMatchObject([
      { kind: "snow", accepted_by: "山本", slot: first },
      { kind: "supplies", accepted_by: "隣の高田さん", slot: first },
    ]);
    expect(await helpStatus()).toContain(`山本さんが${slotLabel(first)}に雪かきに来る予定。そう伝える。`);

    // Nobody has come yet and she says so again: no second message for the same job.
    lineCalls.length = 0;
    await heard("conv_h2", true, true);
    expect(pushes()).toEqual([]);
    expect(await requestsOf("conv_h2")).toEqual([]);
    const { rankedRows } = await import("@/lib/dashboard");
    const [row] = rankedRows([(await store.getResident("suzuki"))!], await store.listCalls("suzuki"));
    expect(row.requests).toMatchObject([{ kind: "snow", status: "accepted" }, { kind: "supplies", status: "accepted" }]);

    await heard("conv_h3", false, false);
    expect((await requestsOf("conv_h1")).map((a) => a.done)).toEqual([true, true]);
    expect(await helpStatus()).toBe("なし");
  });

  it("asks again when nobody took it, and the old message's button answers the new request", async () => {
    await closeRequests("suzuki");
    await heard("conv_h4", true, false);
    lineCalls.length = 0;
    await heard("conv_h5", true, false);
    expect(pushes().map((p) => p.to)).toEqual(["U_volunteer"]);
    expect((await requestsOf("conv_h5"))[0].request_id).toBe("conv_h4"); // a reminder of the same request
    await tap("snow_accept:conv_h4", "U_volunteer");
    expect((await requestsOf("conv_h5"))[0].accepted_by).toBe("山本");
    expect((await requestsOf("conv_h4"))[0].accepted_by).toBeUndefined();
  });

  it("keeps an accepted visit, and sends nothing again, when the same call is reported twice", async () => {
    await closeRequests("suzuki");
    const { slotChoices } = await import("@/lib/requests");
    const [first] = slotChoices();
    await heard("conv_h7", false, true);
    await tap(`accept:conv_h7:supplies:${first.date}:${first.part}`, "U_family");
    lineCalls.length = 0;
    await heard("conv_h7", false, true);
    expect(pushes()).toEqual([]);
    expect((await requestsOf("conv_h7"))[0]).toMatchObject({ accepted_by: "隣の高田さん", slot: first, sent: true });
    extract.mockReset().mockImplementation(async () => extraction); // the repeat never reached the model
  });

  it("has the request on record before its buttons can be tapped", async () => {
    await closeRequests("suzuki");
    let onRecord: boolean | undefined;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (String(url).endsWith("/push")) onRecord = !!(await store.getCall("conv_h8"));
      return new Response("{}");
    }));
    await heard("conv_h8", true, false);
    expect(onRecord).toBe(true);
    expect((await requestsOf("conv_h8"))[0]).toMatchObject({ sent: true, request_id: "conv_h8" });
  });

  it("does not let a button from a settled request take a new one", async () => {
    await closeRequests("suzuki");
    const { slotChoices } = await import("@/lib/requests");
    const [first] = slotChoices();
    await heard("conv_h9", false, true);
    await heard("conv_h10", false, false); // she has enough again: settled
    await heard("conv_h11", false, true); // a new shortage, a new request
    await tap(`accept:conv_h9:supplies:${first.date}:${first.part}`, "U_family");
    expect((await requestsOf("conv_h11"))[0].accepted_by).toBeUndefined();
    await tap(`accept:conv_h11:supplies:${first.date}:${first.part}`, "U_family");
    expect((await requestsOf("conv_h11"))[0].accepted_by).toBe("隣の高田さん");
  });

  it("tells the family what she said she needs", async () => {
    await closeRequests("suzuki");
    lineCalls.length = 0;
    await heard("conv_h12", false, true);
    expect(pushes()[0].messages[0].text).toBe("通話メモより：除雪");
    expect((await requestsOf("conv_h12"))[0].deliveries![0].text).toContain("何が必要かをご本人に確かめて");
  });

  it("takes the demo button's place for a tap, in demo mode", async () => {
    await closeRequests("suzuki");
    await heard("conv_h6", true, false);
    const { acceptDemo } = await import("@/app/actions");
    const form = new FormData();
    form.set("call_id", "conv_h6");
    form.set("kind", "snow");
    await acceptDemo(form);
    expect((await requestsOf("conv_h6"))[0]).toMatchObject({ accepted_by: "山本", slot: { part: expect.any(String) } });
  });

  it("reads a record from before requests had kinds", async () => {
    const { writeFileSync } = await import("node:fs");
    const old = { id: "conv_old", resident_id: "suzuki", at: "2026-11-20T00:00:00.000Z", kind: "call", risk: "yellow", reasons: [],
      actions: [{ type: "snow_request", to: ["snow_volunteer"], sent: true }], snow_accepted: true };
    writeFileSync(`${process.env.DATA_DIR}/calls/conv_old.json`, JSON.stringify(old));
    const call = (await store.getCall("conv_old"))!;
    expect(call.actions).toEqual([{ type: "request", kind: "snow", to: ["snow_volunteer"], sent: true, accepted_by: "" }]);
    expect("snow_accepted" in call).toBe(false);
    expect((await store.listCalls("suzuki")).find((c) => c.id === "conv_old")!.actions[0].type).toBe("request");
  });
});
