"use client";

import { useEffect, useRef, useState, useTransition } from "react";

/**
 * A form of menus that saves the one that changed the moment it changes, and says so.
 * The action gets that menu and the hidden fields, and returns whether it saved.
 * The page keys each menu on its saved value so a change made elsewhere (adding a family contact) shows,
 * which remounts the menu just changed: focus goes back to it, so arrow keys can keep moving through a list.
 */
export function SaveOnChange({
  action,
  labels,
  className,
  footer,
  children,
}: {
  action: (formData: FormData) => Promise<boolean>;
  labels: { saving: string; saved: string; failed: string };
  className?: string;
  /** Where the status goes after the menus, and anything shown beside it. */
  footer?: { className: string; extra?: React.ReactNode };
  children: React.ReactNode;
}) {
  const form = useRef<HTMLFormElement>(null);
  const changed = useRef<string | null>(null);
  const [status, setStatus] = useState<"saved" | "failed">();
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (pending || !changed.current) return;
    if (document.activeElement === document.body) (form.current?.elements.namedItem(changed.current) as HTMLElement | null)?.focus();
    changed.current = null;
  }, [pending]);

  return (
    <form
      ref={form}
      className={className}
      onSubmit={(e) => e.preventDefault()}
      onChange={(e) => {
        const target = e.currentTarget;
        const menu = e.target as EventTarget as HTMLSelectElement;
        changed.current = menu.name;
        // Only the menu that changed: another may have been changed elsewhere since this page loaded.
        const formData = new FormData(target);
        for (const other of target.querySelectorAll("select")) if (other !== menu) formData.delete(other.name);
        startTransition(async () => {
          const saved = await action(formData);
          setStatus(saved ? "saved" : "failed");
          if (!saved) target.reset(); // back to what is stored
        });
      }}
    >
      {children}
      <div className={footer?.className}>
        {footer?.extra}
        <span role="status" className={!pending && status === "failed" ? "text-red-700" : "text-zinc-500"}>
          {pending ? labels.saving : status && labels[status]}
        </span>
      </div>
    </form>
  );
}
