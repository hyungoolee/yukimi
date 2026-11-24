"use client";

import { useRef, useState } from "react";

/**
 * Text that reads as text, and turns into a field when clicked. Enter or clicking away saves, Esc cancels;
 * in a multi-line field, Cmd/Ctrl+Enter saves.
 */
export function InlineText({
  action,
  fields,
  value,
  empty,
  label,
  maxLength,
  multiline,
}: {
  action: (formData: FormData) => Promise<void>;
  fields: Record<string, string>;
  value: string;
  empty: React.ReactNode; // shown when there is no text yet
  label: string;
  maxLength: number;
  multiline?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const finished = useRef(false); // one save or cancel per edit: Enter and the blur that follows must not both save

  const finish = (save: boolean) => {
    if (finished.current) return;
    finished.current = true;
    if (save) form.current?.requestSubmit();
    else setEditing(false);
  };

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => {
          finished.current = false;
          setEditing(true);
        }}
        title={label}
        className="-mx-1 min-w-0 cursor-text rounded px-1 text-left whitespace-pre-wrap hover:bg-zinc-100"
      >
        {value || empty}
      </button>
    );
  }

  const field = {
    name: "text",
    autoFocus: true,
    defaultValue: value,
    maxLength,
    "aria-label": label,
    onBlur: () => finish(true),
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === "Escape") finish(false);
      if (e.key === "Enter" && (!multiline || e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        finish(true);
      }
    },
    className: "-mx-1 w-full rounded border border-zinc-300 px-1 outline-none focus:border-zinc-500",
  };
  return (
    <form
      ref={form}
      className="min-w-0 flex-1"
      action={async (formData) => {
        if (String(formData.get("text")).trim() !== value) await action(formData);
        setEditing(false);
      }}
    >
      {Object.entries(fields).map(([name, v]) => (
        <input key={name} type="hidden" name={name} value={v} />
      ))}
      {multiline ? <textarea rows={2} {...field} /> : <input {...field} />}
    </form>
  );
}
