import type { Lang, Strings } from "@/lib/i18n";
import type { Resident } from "@/lib/types";
import { addFactAction, deleteFactAction, editFactAction, restoreFactAction, retireFactAction, saveCareNotes } from "../../actions";
import { japanTime } from "../../ui";

const button = "rounded border border-zinc-300 px-2 py-0.5 hover:bg-zinc-50";
const input = "min-w-0 flex-1 rounded border border-zinc-300 px-2 py-1";

/** What Yukimi remembers about a resident, for the helper to read and correct. */
export function MemoryEditor({ resident, t, lang }: { resident: Resident; t: Strings; lang: Lang }) {
  const id = <input type="hidden" name="resident_id" value={resident.id} />;
  const retired = resident.retired_facts ?? [];
  const log = [...(resident.memory_log ?? [])].reverse();

  return (
    <section className="mt-6 text-sm">
      <h2 className="text-base font-medium">{t.memory}</h2>
      <ul className="mt-2 space-y-1">
        {resident.facts.map((fact) => (
          <li key={fact.id} className="flex items-center gap-2">
            <form action={editFactAction} className="flex min-w-0 flex-1 items-center gap-2">
              {id}
              <input type="hidden" name="fact_id" value={fact.id} />
              <input name="text" defaultValue={fact.text} maxLength={80} aria-label={fact.text} className={input} />
              <button className={button}>{t.save}</button>
            </form>
            <form action={retireFactAction}>
              {id}
              <input type="hidden" name="fact_id" value={fact.id} />
              <button className={button}>{t.retire}</button>
            </form>
            <span className="w-28 shrink-0 text-xs text-zinc-500">
              {t.factSource[fact.source]}
              {fact.locked && fact.source === "call" ? `・${t.locked}` : ""}
            </span>
          </li>
        ))}
      </ul>
      <form action={addFactAction} className="mt-2 flex items-center gap-2">
        {id}
        <input name="text" maxLength={80} placeholder={t.factPlaceholder} aria-label={t.addFact} className={input} />
        <button className={button}>{t.addFact}</button>
        <span className="w-28 shrink-0" />
      </form>

      <form action={saveCareNotes} className="mt-4">
        {id}
        <label htmlFor="care_notes" className="text-zinc-500">{t.careNotes}</label>
        <div className="mt-1 flex items-start gap-2">
          <textarea
            id="care_notes"
            name="text"
            rows={2}
            maxLength={300}
            defaultValue={resident.care_notes ?? ""}
            placeholder={t.careNotesHint}
            className={input}
          />
          <button className={button}>{t.save}</button>
        </div>
      </form>

      {retired.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-zinc-500">{t.retiredFacts(retired.length)}</summary>
          <ul className="mt-1 space-y-1">
            {retired.map((fact) => (
              <li key={fact.id} className="flex items-center gap-2">
                <span className="flex-1 text-zinc-600">{fact.text}</span>
                <span className="text-xs text-zinc-500">{fact.retired}</span>
                <form action={restoreFactAction}>
                  {id}
                  <input type="hidden" name="fact_id" value={fact.id} />
                  <button className={button}>{t.restore}</button>
                </form>
                <form action={deleteFactAction}>
                  {id}
                  <input type="hidden" name="fact_id" value={fact.id} />
                  <button className={`${button} text-red-700`}>{t.deleteForever}</button>
                </form>
              </li>
            ))}
          </ul>
        </details>
      )}

      {log.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-zinc-500">{t.memoryLog}</summary>
          <ul className="mt-1 space-y-1 text-zinc-600">
            {log.map((entry, i) => (
              <li key={i}>
                <span className="text-zinc-500">{japanTime(entry.at, lang)}　{t.logBy(entry.by)}　</span>
                {t.logOps[entry.op]}
                {entry.before ? `：${entry.before} → ${entry.text ?? ""}` : entry.text ? `：${entry.text}` : ""}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
