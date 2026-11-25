import { canAsk } from "./requests";
import type { Contact, Person, Resident, Role } from "./types";

// Who would be told if something went wrong with a resident, and whether each of them can be reached.
// Read-only: this describes what the alert code would do today; it sends nothing.

export const ROLES: Role[] = ["helper", "second_contact", "snow_volunteer"];

/** How many people can be put in line for snow clearing after the first (the 連絡体制 page shows this many menus). */
export const SNOW_NEXT_SLOTS = 2;
/** Everyone who could be asked to clear snow, in order. */
export const snowLine = (resident: Resident): Contact[] => [resident.snow_volunteer, ...(resident.snow_next ?? [])];
/** Whether this person holds any post for the resident, a place further down the snow line included. */
export const serves = (resident: Resident, personId: string) =>
  ROLES.some((role) => resident[role].id === personId) || (resident.snow_next ?? []).some((c) => c.id === personId);

/** none: nobody on file. unregistered: a name, but no way to message them. registered: on LINE. */
export type Reach = "none" | "unregistered" | "registered";
export const reach = (c: Contact): Reach => (c.line_id ? "registered" : c.name ? "unregistered" : "none");

export type Gap =
  | "red_reaches_nobody" // neither the helper nor the family contact can be reached
  // Some alerts go to the helper alone: self-harm, and a call the app could not judge (needsReview).
  | "helper_unreachable"
  | "family_unreachable" // the missed-call check has nobody to ask; the ladder waits, then alerts
  | "snow_unreachable" // a snow-clearing request would reach nobody
  | "paid_unconfirmed"; // someone in the snow line was marked as a business after the line was saved: not asked until it is saved again

const CRITICAL: Gap[] = ["red_reaches_nobody", "helper_unreachable"];

/**
 * What registration alone says. Whether the app can send on LINE at all (LINE_READY) is one separate,
 * app-wide fact. People can register before it is set (the webhook needs only the secret), so pages
 * keep showing each resident's gaps without it, and drop only totals that assume sending works.
 */
export function coverage(resident: Resident) {
  const can = (role: Role) => reach(resident[role]) === "registered";
  // Red alerts go to the helper and the family contact.
  const redAlertReaches = [can("helper"), can("second_contact")].filter(Boolean).length;

  const gaps: Gap[] = [];
  if (redAlertReaches === 0) gaps.push("red_reaches_nobody");
  else if (!can("helper")) gaps.push("helper_unreachable");
  else if (!can("second_contact")) gaps.push("family_unreachable");
  // Anyone in the line for snow clearing will do.
  if (!snowLine(resident).some((c) => reach(c) === "registered" && canAsk(resident, c))) gaps.push("snow_unreachable");
  if (snowLine(resident).some((c) => c.name && !canAsk(resident, c))) gaps.push("paid_unconfirmed");

  const level = gaps.some((g) => CRITICAL.includes(g)) ? "critical" : gaps.length ? "warning" : "ok";
  return { redAlertReaches, gaps, level } as const;
}

/** How many residents have an alert that would reach nobody. */
export const criticalCount = (residents: Resident[]) =>
  residents.filter((r) => r.active !== false && coverage(r).level === "critical").length;

/**
 * Who can be picked for a role: a resident's own family for their family contact, and no one's family
 * for the other roles, so alerts about one resident never go to another resident's family by a slip.
 * Whoever holds the role now stays a choice (people saved before family_of existed).
 */
export const eligible = (person: Person, role: Role, resident: Resident) =>
  person.id === resident[role].id || (role === "second_contact" ? person.family_of === resident.id : !person.family_of);

/** Each person with the roles they hold and everyone they serve. */
export function served(person: Person, residents: Resident[]) {
  const roles = ROLES.filter((role) =>
    residents.some((r) => r[role].id === person.id || (role === "snow_volunteer" && (r.snow_next ?? []).some((c) => c.id === person.id))),
  );
  return { roles, residents: residents.filter((r) => serves(r, person.id)) };
}
