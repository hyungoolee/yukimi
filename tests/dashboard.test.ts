import { describe, expect, it } from "vitest";
import { distanceKm, mapData, rankedRows, snowRequest } from "@/lib/dashboard";
import type { CallRecord, Resident } from "@/lib/types";

const volunteer = { name: "山本", line_id: "U_v", location: { lat: 43.1975, lng: 141.779 } };
const resident = (id: string, extra: Partial<Resident> = {}): Resident => ({
  id, name: id, phone: "", call_time: "09:00", introducer: "", amedas_station: "15356", facts: [], recent_calls: [],
  second_contact: { name: "family" }, helper: { name: "helper" }, snow_volunteer: volunteer,
  location: { lat: 43.2, lng: 141.77 }, ...extra,
});
let clock = 0;
const call = (resident_id: string, risk: CallRecord["risk"], extra: Partial<CallRecord> = {}): CallRecord => ({
  id: `c${++clock}`, resident_id, at: new Date(2026, 10, 26, 9, clock).toISOString(), kind: "call", risk, reasons: [], actions: [], ...extra,
});
const newestFirst = (calls: CallRecord[]) => [...calls].sort((a, b) => b.at.localeCompare(a.at));
const people = [resident("a"), resident("b"), resident("c"), resident("d")];

describe("rankedRows", () => {
  it("orders unhandled red, yellow, green, then not yet called", () => {
    const calls = newestFirst([call("c", "green"), call("a", "yellow"), call("b", "red")]);
    expect(rankedRows(people, calls).map((r) => r.resident.id)).toEqual(["b", "a", "c", "d"]);
  });

  it("keeps an unhandled red on show when a later call is green", () => {
    const red = call("a", "red");
    const calls = newestFirst([red, call("a", "green")]);
    expect(rankedRows([resident("a")], calls)[0].call).toBe(red);
  });

  it("shows the newest call once the alert is handled, and sinks a handled alert below green", () => {
    const handledRed = call("a", "red", { handled: true });
    const green = call("a", "green");
    expect(rankedRows([resident("a")], newestFirst([handledRed, green]))[0].call).toBe(green);
    const calls = newestFirst([call("a", "red", { handled: true }), call("b", "green")]);
    expect(rankedRows(people.slice(0, 2), calls).map((r) => r.resident.id)).toEqual(["b", "a"]);
  });
});

describe("snowRequest", () => {
  const snow = (sent: boolean) => [{ type: "snow_request" as const, to: ["snow_volunteer" as const], sent }];

  it("reports not sent, sent and accepted, with the straight-line distance", () => {
    const a = resident("a");
    expect(snowRequest(a, [call("a", "yellow", { actions: snow(false) })])?.status).toBe("not_sent");
    expect(snowRequest(a, [call("a", "yellow", { actions: snow(true) })])?.status).toBe("sent");
    const accepted = snowRequest(a, [call("a", "yellow", { actions: snow(true), snow_accepted: true })]);
    expect(accepted).toMatchObject({ status: "accepted", volunteer: "山本" });
    expect(accepted!.km).toBeCloseTo(distanceKm(a.location!, volunteer.location), 6);
  });

  it("is absent with no request, or once the call is handled", () => {
    expect(snowRequest(resident("a"), [call("a", "red")])).toBeUndefined();
    expect(snowRequest(resident("a"), [call("a", "yellow", { actions: snow(true), handled: true })])).toBeUndefined();
  });
});

describe("mapData", () => {
  it("gives one pin per placed resident, counts the unplaced, and carries no names on pins", () => {
    const rows = rankedRows([resident("a"), resident("b", { location: undefined })], [call("a", "red")]);
    const data = mapData(rows, []);
    expect(data.pins).toEqual([{ id: "a", risk: "red", handled: false, location: { lat: 43.2, lng: 141.77 } }]);
    expect(data.unplaced).toBe(1);
  });

  it("draws a volunteer shared by several residents once", () => {
    expect(mapData(rankedRows(people, []), []).volunteers).toEqual([{ name: "山本", location: volunteer.location }]);
  });
});

describe("distanceKm", () => {
  it("matches a known distance: Sapporo to Iwamizawa is about 37 km", () => {
    expect(distanceKm({ lat: 43.0621, lng: 141.3544 }, { lat: 43.1962, lng: 141.7759 })).toBeCloseTo(37.3, 0);
  });
});
