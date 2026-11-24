// Shared formats from the Build plan. Change only with the whole team.

export type LatLng = { lat: number; lng: number };
export type Contact = { name: string; phone?: string; line_id?: string; location?: LatLng };
export type Role = "helper" | "second_contact" | "snow_volunteer";

export type Resident = {
  id: string;
  name: string;
  phone: string;
  call_time: string; // "HH:MM", Japan time
  introducer: string;
  second_contact: Contact;
  helper: Contact;
  snow_volunteer: Contact;
  amedas_station: string; // JMA station code
  location?: LatLng; // home, shown on the coordinator's map
  facts: string[];
  recent_calls: { date: string; summary: string }[];
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

export type Extraction = {
  answered_by_person: boolean;
  summary: string;
  notes: { mood: string; health: string; winter: string; needs: string[] };
  signals: Signals;
  new_facts: string[];
};

export type Risk = "green" | "yellow" | "red";
export type Action = { type: "alert" | "snow_request"; to: Role[] };
export type RulesOutput = { risk: Risk; reasons: string[]; actions: Action[] };

export type Turn = { role: string; message: string };

export type CallRecord = {
  id: string;
  resident_id: string;
  at: string; // ISO time
  kind: "call" | "missed" | "emergency" | "confirmed_ok";
  risk: Risk;
  reasons: string[];
  actions: (Action & { sent: boolean })[];
  transcript?: Turn[];
  extraction?: Extraction;
  handled?: boolean;
  snow_accepted?: boolean;
};
