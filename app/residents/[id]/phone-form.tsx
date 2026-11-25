"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { savePhone, type PhoneResult } from "../../actions";

type Labels = { phone: string; save: string; saved: string; saving: string; invalid: string; hint: string; enterToSave: string; unset: string };

/**
 * The number the check-in call goes to. It reads as text and turns into a field when clicked.
 * Only Enter or Save saves, unlike the notes, which save on click-away: a half-typed number can still pass
 * as a number, and saving it would send tomorrow's call to a stranger. Clicking away closes the field only
 * if nothing was typed, so an edit is never lost either. (The iPhone number pad has no Return key.)
 */
export function PhoneForm({ residentId, phone, labels }: { residentId: string; phone: string; labels: Labels }) {
  const [editing, setEditing] = useState(false);
  const [result, action, pending] = useActionState(savePhone, undefined);
  // The result shown is only the one from this edit, not one left over from an earlier edit.
  const [seen, setSeen] = useState<PhoneResult>();
  const fresh = result !== seen ? result?.status : undefined;
  const open = editing && fresh !== "saved"; // closes with the saved number, so the old one never flashes

  // Closing removes the field: put focus on the number, so the keyboard doesn't land back at the top.
  const button = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  useEffect(() => {
    if (wasOpen.current && !open && document.activeElement === document.body) button.current?.focus();
    wasOpen.current = open;
  }, [open]);

  const message = pending
    ? labels.saving
    : open
      ? fresh === "invalid" ? labels.invalid : `${labels.hint} · ${labels.enterToSave}`
      : fresh === "saved" && labels.saved;

  return (
    <form action={action} className="mt-2 flex flex-wrap items-center gap-2 text-sm">
      <input type="hidden" name="resident_id" value={residentId} />
      <label id="phone-label" htmlFor="phone" className="w-32 text-zinc-500">{labels.phone}</label>
      {open ? (
        <>
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
            onBlur={(e) => e.currentTarget.value === e.currentTarget.defaultValue && setEditing(false)}
            onKeyDown={(e) => e.key === "Escape" && setEditing(false)}
            className="w-48 rounded border border-zinc-300 px-2 py-1 aria-invalid:border-red-500"
          />
          <button disabled={pending} className="rounded border border-zinc-300 px-3 py-1 hover:bg-zinc-50 disabled:opacity-40">
            {labels.save}
          </button>
        </>
      ) : (
        <button
          ref={button}
          type="button"
          id="phone"
          aria-labelledby="phone-label phone"
          onClick={() => {
            setSeen(result);
            setEditing(true);
          }}
          className="w-48 cursor-text rounded border border-transparent px-2 py-1 text-left hover:border-zinc-300 hover:bg-zinc-50"
        >
          {phone || <span className="text-amber-700">{labels.unset}</span>}
        </button>
      )}
      <span id="phone-result" role="status" className={fresh === "invalid" && open ? "text-red-600" : "text-zinc-500"}>
        {message}
      </span>
    </form>
  );
}
