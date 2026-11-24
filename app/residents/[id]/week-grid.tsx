import type { Lang, Strings } from "@/lib/i18n";
import { isConcern, MEASURES } from "@/lib/measures";
import type { lastWeek } from "@/lib/trends";

/** Seven days of what the resident reported, one row per measure. */
export function WeekGrid({ week, t, lang }: { week: ReturnType<typeof lastWeek>; t: Strings; lang: Lang }) {
  return (
    <>
      <table className="mt-2 text-sm">
        <thead>
          <tr className="text-zinc-500">
            <th />
            {week.map((day) => (
              <th key={day.date} className="w-12 px-1 text-center font-normal">
                {Number(day.date.slice(5, 7))}/{Number(day.date.slice(8))}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {MEASURES.map(({ field, label }) => (
            <tr key={field} className="border-t border-zinc-200">
              <th className="py-1 pr-3 text-left font-normal text-zinc-500">{label[lang]}</th>
              {week.map((day) => {
                const value = day.observations?.[field] ?? "unknown";
                const concern = isConcern(field, value);
                return (
                  <td key={day.date} className={`text-center ${concern ? "font-semibold text-red-600" : "text-zinc-400"}`}>
                    {value === "unknown" ? "–" : concern ? "!" : "○"}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-1 text-xs text-zinc-500">{t.weekKey}</p>
    </>
  );
}
