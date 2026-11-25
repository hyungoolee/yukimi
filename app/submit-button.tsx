"use client";

import { useFormStatus } from "react-dom";

const OUTLINE = "rounded border border-zinc-300 px-3 py-1 text-sm hover:bg-zinc-50 disabled:opacity-40";
/** The one thing to do next, such as closing an open alert. */
const PRIMARY = "rounded border border-zinc-900 bg-zinc-900 px-3 py-1 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-40";

/**
 * A form's submit button that is disabled while the form is sending, so one click places one call.
 * `primary`: solid, for the action that matters most where it appears.
 * `confirm`: asked first, for an action that is easy to click by mistake and costly if it was one.
 */
export function SubmitButton({
  children,
  pending: pendingLabel,
  disabled,
  primary,
  confirm,
}: {
  children: React.ReactNode;
  pending: string;
  disabled?: boolean;
  primary?: boolean;
  confirm?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      disabled={disabled || pending}
      onClick={confirm ? (e) => window.confirm(confirm) || e.preventDefault() : undefined}
      className={primary ? PRIMARY : OUTLINE}
    >
      {pending ? pendingLabel : children}
    </button>
  );
}
