"use client";

import { useActionState, useState } from "react";
import { savePhone, type PhoneResult } from "../../actions";

type Labels = { phone: string; saving: string; saved: string; invalid: string; hint: string; enterToSave: string; unset: string };

/**
 * The number the check-in call goes to. It reads as text and turns into a field when clicked.
 * Only Enter saves. Clicking away or Esc cancels, unlike the notes: a half-typed number can still pass
 * as a number, and saving it would send tomorrow's call to a stranger.
 */
export function PhoneForm({ residentId, phone, labels }: { residentId: string; phone: string; labels: Labels }) {
  const [editing, setEditing] = useState(false);
  const [result, action, pending] = useActionState(async (previous: PhoneResult | undefined, formData: FormData) => {
    const next = await savePhone(previous, formData);
    if (next.status === "saved") setEditing(false);
    return next;
  }, undefined);
  // The result shown is only the one from this edit, not one left over from an edit that was cancelled.
  const [seen, setSeen] = useState<PhoneResult>();
  const fresh = result !== seen ? result?.status : undefined;

  const message = pending
    ? labels.saving
    : editing
      ? fresh === "invalid" ? labels.invalid : `${labels.hint} · ${labels.enterToSave}`
      : fresh === "saved" && labels.saved;

  return (
    <form action={action} className="mt-2 flex flex-wrap items-center gap-2 text-sm">
      <input type="hidden" name="resident_id" value={residentId} />
      <label htmlFor="phone" className="w-32 text-zinc-500">{labels.phone}</label>
      {editing ? (
        <input
          id="phone"
          name="phone"
          type="tel"
          autoFocus
          readOnly={pending}
          defaultValue={fresh === "invalid" ? result!.typed : phone}
          placeholder="+819012345678"
          aria-invalid={fresh === "invalid"}
          aria-describedby="phone-result"
          onBlur={() => setEditing(false)}
          onKeyDown={(e) => e.key === "Escape" && setEditing(false)}
          className="w-48 rounded border border-zinc-300 px-2 py-1 aria-invalid:border-red-500"
        />
      ) : (
        <button
          type="button"
          id="phone"
          onClick={() => {
            setSeen(result);
            setEditing(true);
          }}
          className="w-48 cursor-text rounded border border-transparent px-2 py-1 text-left hover:border-zinc-300 hover:bg-zinc-50"
        >
          {phone || <span className="text-amber-700">{labels.unset}</span>}
        </button>
      )}
      <span id="phone-result" role="status" className={fresh === "invalid" && editing ? "text-red-600" : "text-zinc-500"}>
        {message}
      </span>
    </form>
  );
}
