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
  /**
   * A question the agent must get an answer to: on every call, or only on a winter-check morning.
   * A call that ends with one still "unknown" is flagged for the helper (lib/rules.ts).
   * Meals are not required: "no breakfast yet" is deliberately recorded as "unknown".
   */
  required?: "always" | "winter";
  /** A pattern across days: `days` worrying answers running, all within `within` days. */
  trend?: {
    id: string;
    days: number;
    within: number;
    risk: "yellow" | "red";
    reason: string;
    reasonEn: string;
    /**
     * What the agent is told before the next call while this pattern lasts. Fixed wording, never generated.
     * It names a topic to take care over, not what the resident said: the agent must not repeat earlier
     * answers back, or a polite "yes" would be recorded as today's answer and keep the pattern going.
     */
    brief: string;
  };
};

export const MEASURES = [
  {
    field: "ate",
    concern: "no",
    label: { ja: "食事", en: "Meals" },
    ask: `ate (since yesterday's call): "no" when they have not eaten today, or say they are not eating or have been skipping meals. "yes" when they say they have eaten. When the only thing they say is that they have not had breakfast yet this morning, answer "unknown".`,
    trend: { id: "not_eating", days: 3, within: 5, risk: "red", reason: "3日続けて食事をとれていない", reasonEn: "Not eating for 3 days running", brief: "食事のことを、いつもよりていねいに聞く。" },
  },
  {
    field: "slept_well",
    concern: "no",
    label: { ja: "睡眠", en: "Sleep" },
    ask: `slept_well (last night): "no" when they say they slept badly or could not sleep; "yes" when they say they slept well.`,
    required: "always",
    trend: { id: "poor_sleep", days: 3, within: 5, risk: "yellow", reason: "3日続けて眠れていない", reasonEn: "Sleeping badly for 3 nights running", brief: "睡眠のことを、いつもよりていねいに聞く。" },
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
    trend: { id: "low_mood", days: 3, within: 5, risk: "yellow", reason: "気分の落ち込みが3日続いている", reasonEn: "Low mood for 3 days running", brief: "気持ちの様子を、急がずゆっくり聞く。" },
  },
  {
    field: "heating_ok",
    concern: "no",
    label: { ja: "暖房", en: "Heating" },
    ask: `heating_ok (now): "yes" when they say their heating is on or working; "no" when it is broken, off, or they are out of fuel.`,
    required: "winter",
  },
  {
    field: "can_get_out",
    concern: "no",
    label: { ja: "玄関・雪", en: "Front door" },
    ask: `can_get_out (now): "yes" when they say they can get out of the front door; "no" when snow or ice keeps them from opening it or leaving.`,
    required: "winter",
  },
  {
    field: "has_supplies",
    concern: "no",
    label: { ja: "食料・薬", en: "Food and medicine" },
    ask: `has_supplies (now): "yes" when they say they have enough food and medicine; "no" when they are short of either. "unknown" when only one of the two came up and it was fine.`,
    required: "winter",
  },
] as const satisfies readonly Measure[];

export type MeasureField = (typeof MEASURES)[number]["field"];

/** What the resident said about each measure on one call or one day. */
export type Observations = Record<MeasureField, Tri>;

/**
 * The required questions a call left unanswered, in table order. `winterChecks` is whether this
 * call's agent was told to run the winter checks. Fields missing on older records count as unanswered.
 */
export const unanswered = (observations: Partial<Observations>, winterChecks: boolean): MeasureField[] =>
  MEASURES.filter(
    (m) => "required" in m && (m.required === "always" || winterChecks) && (observations[m.field] ?? "unknown") === "unknown",
  ).map((m) => m.field);

/** Whether a value is the worrying one for its measure. */
export const isConcern = (field: MeasureField, value: Tri) => value === MEASURES.find((m) => m.field === field)!.concern;
