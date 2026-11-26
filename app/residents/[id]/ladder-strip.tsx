"use client";

import { useEffect, useState } from "react";

/**
 * The missed-call steps as a strip: those done, the current one with a countdown to the next, and
 * those to come. `end` marks a finished ladder: red for the alert, green when the contact said she is fine.
 */
export function LadderStrip({ steps, current, end, nextAt, units }: {
  steps: string[];
  current: number;
  end?: "red" | "green";
  nextAt?: number;
  units: { s: string; min: string };
}) {
  // The clock is read only in the browser, so the server's render and the first client render match.
  const [now, setNow] = useState<number>();
  useEffect(() => {
    if (!nextAt) return;
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0); // a number from the start, not a second in
    const timer = setInterval(tick, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [nextAt]);
  // Past due, the step is waiting on something outside (a real call ringing, a busy runner): no number.
  const left = nextAt && now ? Math.ceil((nextAt - now) / 1000) : undefined;
  // Real waits are 30 and 10 minutes: counted in minutes past one, in seconds after.
  const shown = left === undefined ? "" : left <= 0 ? " …" : left > 60 ? ` (${Math.ceil(left / 60)}${units.min})` : ` (${left}${units.s})`;

  return (
    <ol className="mt-2 flex flex-wrap items-center gap-1 text-sm">
      {steps.map((label, i) => {
        const done = i < current || (end && i === current);
        const color = end && i === current ? (end === "red" ? "bg-red-600 text-white" : "bg-green-600 text-white")
          : done ? "bg-zinc-200 text-zinc-700"
          : i === current ? "bg-amber-100 font-medium text-amber-900 ring-1 ring-amber-400"
          : "text-zinc-400";
        return (
          <li key={i} className="flex items-center gap-1">
            {i > 0 && <span className="text-zinc-300">─</span>}
            <span className={`rounded px-2 py-0.5 ${color}`} aria-current={i === current ? "step" : undefined}>
              {done ? "✓ " : i === current ? "● " : "○ "}
              {label}
              {i === current && !end && shown}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
