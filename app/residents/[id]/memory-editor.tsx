import type { Lang, Strings } from "@/lib/i18n";
import type { Resident } from "@/lib/types";
import { deleteFactAction, restoreFactAction } from "../../actions";
import { japanTime } from "../../ui";
import { MemoryText } from "./memory-text";

const button = "rounded border border-zinc-300 px-2 py-0.5 hover:bg-zinc-50";

/** What Yukimi remembers about a resident, for the helper to read and correct. */
export function MemoryEditor({ resident, t, lang }: { resident: Resident; t: Strings; lang: Lang }) {
  const id = <input type="hidden" name="resident_id" value={resident.id} />;
  const retired = resident.retired_facts ?? [];
  const log = [...(resident.memory_log ?? [])].reverse();

  return (
    <section className="mt-6 text-sm">
      <h2 className="text-base font-medium">{t.memory}</h2>
      <MemoryText
        residentId={resident.id}
        facts={resident.facts.map((fact) => ({
          id: fact.id,
          text: fact.text,
          source: t.factSource[fact.source] + (fact.locked && fact.source === "call" ? `・${t.locked}` : ""),
        }))}
        careNotes={resident.care_notes ?? ""}
        labels={{
          careNotes: t.careNotes,
          none: t.none,
          edit: t.edit,
          save: t.save,
          saving: t.saving,
          cancel: t.cancel,
          factsHint: t.factsHint,
          careNotesHint: t.careNotesHint,
          tooLong: t.factsTooLong,
          tooMany: t.factsTooMany,
        }}
      />

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
