import type { CallRecord, Contact, LatLng, Resident, Risk } from "./types";

// What the helper list and the coordinator's map both show. One rule, so they can't disagree.

const RANK = { red: 0, yellow: 1, green: 2 };

export type Row = { resident: Resident; call?: CallRecord };

/** One row per resident, most urgent first. `calls` must be newest first. */
export function rankedRows(residents: Resident[], calls: CallRecord[]): Row[] {
  const rank = (call?: CallRecord) => (call ? RANK[call.risk] + (call.handled ? 3 : 0) : 3);
  return residents
    .map((resident) => {
      const own = calls.filter((c) => c.resident_id === resident.id);
      // A later green call must not hide an alert nobody has handled yet.
      return { resident, call: own.find((c) => c.risk !== "green" && !c.handled) ?? own[0] };
    })
    .sort((a, b) => rank(a.call) - rank(b.call));
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
  volunteer: string;
  from?: LatLng;
  to?: LatLng;
  km?: number;
};

/** The resident's open snow-clearing request, if any: the newest one nobody has marked handled. */
export function snowRequest(resident: Resident, calls: CallRecord[]): SnowRequest | undefined {
  const call = calls.find(
    (c) => c.resident_id === resident.id && !c.handled && c.actions.some((a) => a.type === "snow_request"),
  );
  if (!call) return undefined;
  const sent = call.actions.some((a) => a.type === "snow_request" && a.sent);
  const from = resident.location;
  const to = resident.snow_volunteer.location;
  return {
    residentId: resident.id,
    status: call.snow_accepted ? "accepted" : sent ? "sent" : "not_sent",
    volunteer: resident.snow_volunteer.name,
    from,
    to,
    km: from && to ? distanceKm(from, to) : undefined,
  };
}

/** Tells volunteers apart: by LINE ID once registered, by name until then. Used for pins and for saving. */
export const volunteerKey = (v: Contact) => v.line_id || v.name;

export type MapData = {
  /** No names here: a pin shows a colour, and the name appears only when it is opened. */
  pins: { id: string; risk: Risk | null; handled: boolean; location: LatLng }[];
  /** Residents with no location yet, so they are not silently missing from the map. */
  unplaced: number;
  volunteers: { name: string; location: LatLng }[];
  requests: SnowRequest[];
};

export function mapData(rows: Row[], calls: CallRecord[]): MapData {
  const volunteers = new Map<string, { name: string; location: LatLng }>();
  for (const { resident } of rows) {
    const v = resident.snow_volunteer;
    // The same volunteer sits in several residents' profiles: one pin each.
    if (v.location) volunteers.set(volunteerKey(v), { name: v.name, location: v.location });
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
