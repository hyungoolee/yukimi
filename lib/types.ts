import type { Observations } from "./measures";
import type { RequestKind } from "./requests";
// Shared formats from the Build plan. Change only with the whole team.

export type LatLng = { lat: number; lng: number };
/** Someone who is told about a resident: a helper, a family contact or a snow helper. One file each. */
export type Person = {
  id: string;
  name: string;
  phone?: string;
  line_id?: string;
  location?: LatLng;
  /** Told when a help request reaches nobody or goes unanswered (lib/actions.ts). */
  coordinator?: boolean;
  /** Their LINE registration code, until they use it. */
  code?: string;
};
/** A person as they appear in a resident's role. No id and an empty name: the post is vacant. */
export type Contact = Omit<Person, "id" | "code"> & { id?: string };
export type Role = "helper" | "second_contact" | "snow_volunteer";

/**
 * A lasting detail about the resident. Intake facts (given by family or the 社協 at sign-up) and
 * anything the helper has written or edited are locked: the model can't change or retire them.
 */
export type Fact = { id: string; text: string; since: string; source: "intake" | "call" | "helper"; locked?: boolean };
export type RetiredFact = Fact & { retired: string; reason: string };

/** One entry in the record of what changed in a resident's memory, and who changed it. */
export type MemoryChange = {
  at: string; // ISO time
  by: string; // "helper", or "call:<call id>"
  op: "add" | "update" | "retire" | "restore" | "delete" | "refuse" | "care_notes";
  fact?: string; // the fact's id, so deleting a fact for good can clear every trace of its text here
  text?: string;
  before?: string;
};

/** Something worth asking about on a later call, until `expires` (Japan dates). */
export type FollowUp = { id: string; text: string; created: string; expires: string };

export type Resident = {
  id: string;
  name: string;
  phone: string;
  call_time: string; // "HH:MM", Japan time
  /** false: no longer in the service (moved into care, died, left). Not called; missed-call steps stop. */
  active?: boolean;
  /** The Japan date the daily call was last scheduled, so it is placed once a day. See lib/daily.ts. */
  scheduled_on?: string;
  /** Waiting for a free line for that day's call. */
  call_queued?: boolean;
  introducer: string;
  second_contact: Contact;
  helper: Contact;
  snow_volunteer: Contact;
  amedas_station: string; // JMA station code
  location?: LatLng; // home, shown on the coordinator's map
  facts: Fact[]; // older files hold plain strings; lib/resident.ts converts them on read
  retired_facts?: RetiredFact[]; // kept, hidden from the agent, restorable
  care_notes?: string; // written by the helper: what to avoid or handle gently
  memory_log?: MemoryChange[]; // newest last
  /** Hashes of facts the helper retired or deleted. The model can't write these back; the text isn't kept. */
  blocked_facts?: string[];
  recent_calls: { date: string; summary: string }[];
  /** Absent on files from before follow-ups existed. Read through lib/memory.ts. */
  follow_ups?: FollowUp[];
};

export type Weather = {
  station: string;
  date: string;
  snowfall_24h_cm: number;
  snow_depth_cm: number;
  low_c: number;
};

export type Signals = {
  emergency: boolean;
  self_harm: boolean;
  fall_recent: boolean;
  pain: boolean;
  cant_move: boolean;
  snowed_in: boolean;
  heater_problem: boolean;
  not_eating: boolean;
  confused: boolean;
  money_request: boolean;
  low_mood: boolean;
};

export type { Observations, Tri } from "./measures";
export type { RequestKind } from "./requests";

export type Extraction = {
  answered_by_person: boolean;
  summary: string;
  notes: { mood: string; health: string; winter: string; needs: string[] };
  signals: Signals;
  /** Absent on records from before observations were recorded. */
  observations?: Observations;
  /** Only on records from before facts were curated by lib/curate.ts. */
  new_facts?: string[];
  /** The same summary and notes in English, for the dashboard's English view. Absent on older records. */
  english?: { summary: string; mood: string; health: string; winter: string; needs: string[] };
};

export type Risk = "green" | "yellow" | "red";
export type AlertReasons = Partial<Record<Role, string[]>>;
export type Action =
  | { type: "alert"; to: Role[]; reasonsByRole?: AlertReasons }
  | {
      type: "request";
      kind: RequestKind;
      to: Role[];
      /** The call that first asked. A reminder on a later call keeps it, so every message's buttons answer the same request. */
      request_id?: string;
      /** What the resident said they need, from the call notes: shown to the person asked. */
      needs?: string[];
    };
/** Half a day someone has said they will come. `date` is a Japan date. */
export type Slot = { date: string; part: "am" | "pm" };
/** How a help request stands. Kept on the action it was raised by (lib/requests.ts). */
export type RequestState = {
  accepted_by?: string;
  slot?: Slot;
  done?: boolean;
  /** When the coordinators were told that nobody had taken it. */
  escalated_at?: string;
};
/** One message to one person, as it was sent: kept so the dashboard shows history, not a reconstruction. */
export type Delivery = {
  role: Role;
  text: string;
  button?: string; // label of the reply button sent with it, if any
  reasons?: string[]; // an alert's reasons for this recipient
  sent: boolean;
  registered: boolean; // false: this person has no LINE ID on file, so nothing was attempted
};

export type RulesOutput = { risk: Risk; reasons: string[]; actions: Action[] };

export type Turn = { role: string; message: string };

export type CallRecord = {
  id: string;
  resident_id: string;
  at: string; // ISO time
  kind: "call" | "missed" | "emergency" | "confirmed_ok";
  risk: Risk;
  reasons: string[];
  actions: (Action & { sent: boolean; deliveries?: Delivery[] } & RequestState)[];
  transcript?: Turn[];
  extraction?: Extraction;
  handled?: boolean;
  acknowledged_by?: string; // who tapped "確認しました" on a red alert
  alert_rounds?: number; // how many times an unacknowledged red alert was sent again
};
