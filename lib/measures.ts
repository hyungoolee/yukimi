// The daily measures: what each check-in records about the resident, in one table.
// The extraction prompt and schema, the trend rules, the 7-day grid and its labels are all built
// from this list. To add a measure, add an entry here, a persona for it in evals/personas.json,
// and run `pnpm eval`.
//
// These are starting choices, to revise with a 民生委員. Everyone gets the same thresholds:
// there is no personal baseline yet.

/** "unknown" means it did not come up. It never counts as either answer. */
export type Tri = "yes" | "no" | "unknown";

type Measure = {
  field: string;
  /** The answer that is the worrying one. */
  concern: "yes" | "no";
  label: { ja: string; en: string };
  /** The line the extraction model is given for this field. */
  ask: string;
  /** A pattern across days: `days` worrying answers running, all within `within` days. */
  trend?: { id: string; days: number; within: number; risk: "yellow" | "red"; reason: string; reasonEn: string };
};

export const MEASURES = [
  {
    field: "ate",
    concern: "no",
    label: { ja: "食事", en: "Meals" },
    ask: `ate (since yesterday's call): "no" when they have not eaten today, or say they are not eating or have been skipping meals. "yes" when they say they have eaten. When the only thing they say is that they have not had breakfast yet this morning, answer "unknown".`,
    trend: { id: "not_eating", days: 3, within: 5, risk: "red", reason: "3日続けて食事をとれていない", reasonEn: "Not eating for 3 days running" },
  },
  {
    field: "slept_well",
    concern: "no",
    label: { ja: "睡眠", en: "Sleep" },
    ask: `slept_well (last night): "no" when they say they slept badly or could not sleep; "yes" when they say they slept well.`,
    trend: { id: "poor_sleep", days: 3, within: 5, risk: "yellow", reason: "3日続けて眠れていない", reasonEn: "Sleeping badly for 3 nights running" },
  },
  {
    field: "went_out",
    concern: "no",
    label: { ja: "外出", en: "Went out" },
    ask: `went_out (since yesterday's call): "yes" when they say they have been outside the house; "no" when they say they have not.`,
  },
  {
    field: "pain_or_injury",
    concern: "yes",
    label: { ja: "痛み・けが", en: "Pain or injury" },
    ask: `pain_or_injury (now): "yes" when they report physical pain or an injury now. "no" when they say nothing hurts and they are not injured.`,
  },
  {
    field: "low_mood",
    concern: "yes",
    label: { ja: "気分", en: "Mood" },
    ask: `low_mood: "yes" when they say they are lonely, hopeless, or that there is no point. "no" when they say they feel well or cheerful.`,
    trend: { id: "low_mood", days: 3, within: 5, risk: "yellow", reason: "気分の落ち込みが3日続いている", reasonEn: "Low mood for 3 days running" },
  },
] as const satisfies readonly Measure[];

export type MeasureField = (typeof MEASURES)[number]["field"];

/** What the resident said about each measure on one call or one day. */
export type Observations = Record<MeasureField, Tri>;

/** Whether a value is the worrying one for its measure. */
export const isConcern = (field: MeasureField, value: Tri) => value === MEASURES.find((m) => m.field === field)!.concern;
