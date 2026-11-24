"use client";

import { useFormStatus } from "react-dom";

/** A form's submit button that is disabled while the form is sending, so one click places one call. */
export function SubmitButton({
  children,
  pending: pendingLabel,
  disabled,
  className = "rounded border border-zinc-300 px-3 py-1 text-sm hover:bg-zinc-50 disabled:opacity-40",
}: {
  children: React.ReactNode;
  pending: string;
  disabled?: boolean;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button disabled={disabled || pending} className={className}>
      {pending ? pendingLabel : children}
    </button>
  );
}
