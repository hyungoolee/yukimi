import type { Strings } from "@/lib/i18n";
import { SubmitButton } from "../submit-button";
import { createFamily } from "./actions";

/** Adds a family contact tied to this resident, then opens their page for the LINE code. */
export function AddFamily({ residentId, t }: { residentId: string; t: Strings }) {
  return (
    <form action={createFamily} className="mt-2 flex flex-wrap items-center gap-2 text-sm">
      <input type="hidden" name="resident_id" value={residentId} />
      <input name="name" required maxLength={60} placeholder={t.personName} aria-label={t.personName} className="w-40 rounded border border-zinc-300 px-2 py-1" />
      <SubmitButton pending={t.saving}>{t.addFamily}</SubmitButton>
    </form>
  );
}
