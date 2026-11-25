import { snowLine } from "./coverage";
import { helpers, openRequests, type OpenRequest } from "./requests";
import type { CallRecord, Contact, LatLng, Resident, Risk } from "./types";

// What the helper list and the coordinator's map both show. One rule, so they can't disagree.

const RANK = { red: 0, yellow: 1, green: 2 };

/** `requests`: the resident's open help requests, whichever call raised them. */
export type Row = { resident: Resident; call?: CallRecord; requests?: OpenRequest[] };

/** One row per resident, most urgent first. `calls` must be newest first. */
export function rankedRows(residents: Resident[], calls: CallRecord[]): Row[] {
  // Handled alerts go last, below residents not yet called: nobody needs to act on them.
  const rank = (call?: CallRecord) => (!call ? 3 : call.handled ? 4 : RANK[call.risk]);
  const order = (row: Row) => (row.resident.active === false ? 5 : rank(row.call)); // no longer in the service: at the bottom
  return residents
    .map((resident) => {
      const own = calls.filter((c) => c.resident_id === resident.id);
      // A later green call must not hide an alert nobody has handled yet.
      return { resident, call: own.find((c) => c.risk !== "green" && !c.handled) ?? own[0], requests: openRequests(resident, own) };
    })
    .sort((a, b) => order(a) - order(b));
}

/** Straight-line distance. Roads, and winter closures, are not considered. */
export function distanceKm(a: LatLng, b: LatLng) {
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const h =
    Math.sin(rad(b.lat - a.lat) / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

export type SnowRequest = {
  residentId: string;
  status: "not_sent" | "sent" | "accepted";
  /** Who took it, or else who the request has got to in the line. Empty once the line has run out. */
  volunteer: string;
  business: boolean;
  /** Everyone in line has had their turn and nobody took it. */
  exhausted: boolean;
  /** The coordinators have been told that nobody has taken it. */
  escalated: boolean;
  from?: LatLng;
  to?: LatLng;
  km?: number;
};

/** The resident's open snow-clearing request, if any, with where the volunteer comes from: what the map draws. */
export function snowRequest(resident: Resident, calls: CallRecord[]): SnowRequest | undefined {
  const request = openRequests(resident, calls).find((r) => r.kind === "snow");
  if (!request) return undefined;
  const from = resident.location;
  // Whoever took it, or else whoever the request has got to in the line.
  const line = helpers(resident, "snow");
  const who = request.status === "accepted" ? line.find((c) => c.name === request.who) : line[request.asked];
  // No line is drawn once everyone has been tried: nobody is on their way or being waited on.
  const to = who?.location;
  return {
    residentId: resident.id,
    status: request.status,
    volunteer: request.who,
    business: request.business,
    exhausted: request.exhausted,
    escalated: request.escalated,
    from,
    to,
    km: from && to ? distanceKm(from, to) : undefined,
  };
}

/** Tells volunteers apart, for one pin each. */
export const volunteerKey = (v: Contact) => v.id || v.line_id || v.name;

export type MapData = {
  /** No names here: a pin shows a colour, and the name appears only when it is opened. */
  pins: { id: string; risk: Risk | null; handled: boolean; location: LatLng }[];
  /** Residents with no location yet, so they are not silently missing from the map. */
  unplaced: number;
  /** key: volunteerKey, to select the pin. id: their person record, when they have one. */
  volunteers: { key: string; id?: string; name: string; business: boolean; location: LatLng }[];
  requests: SnowRequest[];
};

export function mapData(rows: Row[], calls: CallRecord[]): MapData {
  const volunteers = new Map<string, MapData["volunteers"][number]>();
  for (const { resident } of rows) {
    for (const v of snowLine(resident)) {
      // The same volunteer sits in several residents' profiles: one pin each.
      if (v.location) volunteers.set(volunteerKey(v), { key: volunteerKey(v), id: v.id, name: v.name, business: v.kind === "business", location: v.location });
    }
  }
  return {
    pins: rows.flatMap(({ resident, call }) =>
      resident.location
        ? [{ id: resident.id, risk: call?.risk ?? null, handled: !!call?.handled, location: resident.location }]
        : [],
    ),
    unplaced: rows.filter(({ resident }) => !resident.location).length,
    volunteers: [...volunteers.values()],
    requests: rows.flatMap(({ resident }) => snowRequest(resident, calls) ?? []),
  };
}
