import { createHash } from "node:crypto";
import type { Fact, Resident } from "./types";

/**
 * Brings a resident file of any age to today's shape. Facts used to be plain strings: those become
 * locked intake facts, with an ID derived from the text so it is the same on every read until saved.
 */
export function normalizeResident(raw: Resident): Resident {
  const facts = (raw.facts as (Fact | string)[]).map((f): Fact =>
    typeof f === "string"
      ? { id: createHash("sha1").update(f).digest("hex").slice(0, 8), text: f, since: "", source: "intake", locked: true }
      : f,
  );
  return { ...raw, facts };
}
