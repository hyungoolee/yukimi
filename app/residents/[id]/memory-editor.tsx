import type { Lang, Strings } from "@/lib/i18n";
import type { Resident } from "@/lib/types";
import { addFactAction, deleteFactAction, editFactAction, restoreFactAction, retireFactAction, saveCareNotes } from "../../actions";
import { japanTime } from "../../ui";
import { InlineText } from "./inline-text";

const button = "rounded border border-zinc-300 px-2 py-0.5 hover:bg-zinc-50";

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
          <li key={fact.id} className="group flex items-start gap-2">
            <InlineText
              action={editFactAction}
              fields={{ resident_id: resident.id, fact_id: fact.id }}
              value={fact.text}
              empty=""
              label={t.editFact}
              maxLength={80}
            />
            {/* Facts the model learned on a call are the ones to check, so their label stands out, with the day. */}
            <span className={`shrink-0 pt-0.5 text-xs ${fact.source === "call" && !fact.locked ? "text-amber-700" : "text-zinc-400"}`}>
              {t.factSource[fact.source]}
              {fact.source === "call" && ` · ${fact.since.slice(5).replace("-", "/").replace(/^0/, "")}`}
              {fact.locked && fact.source === "call" ? `・${t.locked}` : ""}
            </span>
            <form action={retireFactAction} className="shrink-0">
              {id}
              <input type="hidden" name="fact_id" value={fact.id} />
              <button className="text-xs text-zinc-500 opacity-0 group-hover:opacity-100 hover:underline focus:opacity-100">
                {t.retire}
              </button>
            </form>
          </li>
        ))}
        <li className="flex">
          <InlineText
            action={addFactAction}
            fields={{ resident_id: resident.id }}
            value=""
            empty={<span className="text-zinc-500">+ {t.addFact}</span>}
            label={t.factPlaceholder}
            maxLength={80}
          />
        </li>
      </ul>

      <p className="mt-4 text-zinc-500">{t.careNotes}</p>
      <div className="mt-1 flex">
        <InlineText
          action={saveCareNotes}
          fields={{ resident_id: resident.id }}
          value={resident.care_notes ?? ""}
          empty={<span className="text-zinc-500">{t.careNotesHint}</span>}
          label={t.careNotes}
          maxLength={300}
          multiline
        />
      </div>

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
