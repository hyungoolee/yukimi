// Shared formats from the Build plan. Change only with the whole team.

export type Contact = { name: string; phone?: string; line_id?: string };

export type Resident = {
  id: string;
  name: string;
  phone: string;
  call_time: string; // "HH:MM", Japan time
  introducer: string;
  second_contact: Contact;
  helper: Contact;
  snow_volunteer: Contact;
  amedas_station: string;
  facts: string[];
  recent_calls: { date: string; summary: string }[];
};
