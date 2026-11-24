"use client";

import { useActionState, useState } from "react";
import { saveMemory, type MemoryResult } from "../../actions";
import { SubmitButton } from "../../submit-button";

type Labels = {
  careNotes: string;
  none: string;
  edit: string;
  save: string;
  saving: string;
  cancel: string;
  factsHint: string;
  careNotesHint: string;
  tooLong: string;
  tooMany: string;
};

const button = "rounded border border-zinc-300 px-3 py-1 hover:bg-zinc-50";
const box = "mt-1 w-full rounded border border-zinc-300 px-2 py-1";

/** The facts and care notes as text to read, and one Edit that turns them into two boxes. */
export function MemoryText({
  residentId,
  facts,
  careNotes,
  labels,
}: {
  residentId: string;
  facts: { id: string; text: string; source: string }[];
  careNotes: string;
  labels: Labels;
}) {
  const [editing, setEditing] = useState(false);
  const [result, action] = useActionState(async (previous: MemoryResult | undefined, formData: FormData) => {
    const saved = await saveMemory(previous, formData);
    if (!saved.error) setEditing(false);
    return saved;
  }, undefined);

  if (!editing) {
    return (
      <div className="mt-2">
        <div className="flex items-start gap-3">
          {facts.length > 0 ? (
            <ul className="flex-1 space-y-1">
              {facts.map((fact) => (
                <li key={fact.id}>
                  {fact.text} <span className="text-xs text-zinc-400">{fact.source}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="flex-1 text-zinc-500">{labels.none}</p>
          )}
          <button type="button" onClick={() => setEditing(true)} className={button}>
            {labels.edit}
          </button>
        </div>
        <p className="mt-3 text-zinc-500">{labels.careNotes}</p>
        <p className="mt-1 whitespace-pre-wrap">{careNotes || <span className="text-zinc-500">{labels.none}</span>}</p>
      </div>
    );
  }

  const error = result?.error;
  return (
    <form action={action} className="mt-2">
      <input type="hidden" name="resident_id" value={residentId} />
      <textarea
        name="facts"
        aria-label={labels.factsHint}
        rows={Math.max(4, facts.length + 2)}
        defaultValue={error ? result.facts : facts.map((f) => f.text).join("\n")}
        aria-invalid={!!error}
        aria-describedby="facts-hint"
        className={`${box} aria-invalid:border-red-500`}
      />
      <p id="facts-hint" role="status" className={error ? "text-red-600" : "text-zinc-500"}>
        {error === "too_long" ? labels.tooLong : error === "too_many" ? labels.tooMany : labels.factsHint}
      </p>
      <label htmlFor="care_notes" className="mt-3 block text-zinc-500">
        {labels.careNotes}
      </label>
      <textarea
        id="care_notes"
        name="care_notes"
        rows={2}
        maxLength={300}
        defaultValue={error ? result.notes : careNotes}
        placeholder={labels.careNotesHint}
        className={box}
      />
      <div className="mt-2 flex gap-2">
        <SubmitButton pending={labels.saving}>{labels.save}</SubmitButton>
        <button type="button" onClick={() => setEditing(false)} className={button}>
          {labels.cancel}
        </button>
      </div>
    </form>
  );
}
