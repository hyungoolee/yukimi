import { volunteerKey } from "./dashboard";
import type { Contact, Resident, Role } from "./types";

// Who would be told if something went wrong with a resident, and whether each of them can be reached.
// Read-only: this describes what the alert code would do today; it sends nothing.

export const ROLES: Role[] = ["helper", "second_contact", "snow_volunteer"];

/** none: nobody on file. unregistered: a name, but no way to message them. registered: on LINE. */
export type Reach = "none" | "unregistered" | "registered";
export const reach = (c: Contact): Reach => (c.line_id ? "registered" : c.name ? "unregistered" : "none");

export type Gap =
  | "red_reaches_nobody" // neither the helper nor the family contact can be reached
  // Some alerts go to the helper alone: self-harm, and a call the app could not judge (needsReview).
  | "helper_unreachable"
  | "family_unreachable" // the missed-call check has nobody to ask; the ladder waits, then alerts
  | "snow_unreachable"; // a snow-clearing request would reach nobody

const CRITICAL: Gap[] = ["red_reaches_nobody", "helper_unreachable"];

/**
 * What registration alone says. Whether the app can send on LINE at all (LINE_READY) is one separate,
 * app-wide fact, shown once, so that a missing LINE setup doesn't hide who still needs to register.
 */
export function coverage(resident: Resident) {
  const can = (role: Role) => reach(resident[role]) === "registered";
  // Red alerts go to the helper and the family contact.
  const redAlertReaches = [can("helper"), can("second_contact")].filter(Boolean).length;

  const gaps: Gap[] = [];
  if (redAlertReaches === 0) gaps.push("red_reaches_nobody");
  else if (!can("helper")) gaps.push("helper_unreachable");
  else if (!can("second_contact")) gaps.push("family_unreachable");
  if (!can("snow_volunteer")) gaps.push("snow_unreachable");

  const level = gaps.some((g) => CRITICAL.includes(g)) ? "critical" : gaps.length ? "warning" : "ok";
  return { redAlertReaches, gaps, level } as const;
}

/** How many residents have an alert that would reach nobody. */
export const criticalCount = (residents: Resident[]) =>
  residents.filter((r) => coverage(r).level === "critical").length;

export type Person = {
  key: string;
  name: string;
  reach: Reach;
  roles: Role[];
  residents: Resident[];
  /** One place this person is on file, so a test message can find them without their LINE ID leaving the server. */
  at: { residentId: string; role: Role };
};

/** Each person once, with everyone they serve. The same person is copied into several residents' files. */
export function people(residents: Resident[]): Person[] {
  const found = new Map<string, Person>();
  for (const resident of residents) {
    for (const role of ROLES) {
      const contact = resident[role];
      if (reach(contact) === "none") continue;
      const key = volunteerKey(contact);
      const person = found.get(key) ?? {
        key, name: contact.name, reach: reach(contact), roles: [], residents: [], at: { residentId: resident.id, role },
      };
      if (!person.roles.includes(role)) person.roles.push(role);
      if (!person.residents.includes(resident)) person.residents.push(resident);
      found.set(key, person);
    }
  }
  return [...found.values()];
}
