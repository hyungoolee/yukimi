"use client";

import { useActionState } from "react";
import { savePhone } from "../../actions";
import { SubmitButton } from "../../submit-button";

type Labels = { phone: string; save: string; saving: string; saved: string; invalid: string; hint: string };

/** The number the check-in call goes to, with a clear answer on save: stored, or not a number we can call. */
export function PhoneForm({ residentId, phone, labels }: { residentId: string; phone: string; labels: Labels }) {
  const [result, action] = useActionState(savePhone, undefined);
  const status = result?.status;
  return (
    <form action={action} className="mt-2 flex flex-wrap items-center gap-2 text-sm">
      <input type="hidden" name="resident_id" value={residentId} />
      <label htmlFor="phone" className="w-28 text-zinc-500">{labels.phone}</label>
      <input
        id="phone"
        name="phone"
        type="tel"
        defaultValue={result?.typed ?? phone}
        placeholder="+819012345678"
        aria-invalid={status === "invalid"}
        aria-describedby="phone-result"
        className="w-48 rounded border border-zinc-300 px-2 py-1 aria-invalid:border-red-500"
      />
      <SubmitButton pending={labels.saving}>{labels.save}</SubmitButton>
      <span id="phone-result" role="status" className={status === "invalid" ? "text-red-600" : "text-zinc-500"}>
        {status === "invalid" ? labels.invalid : status === "saved" ? labels.saved : labels.hint}
      </span>
    </form>
  );
}
