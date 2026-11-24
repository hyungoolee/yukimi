"use client";

import { useActionState } from "react";
import { SubmitButton } from "../submit-button";
import { sendTestMessage } from "./actions";

type Labels = { send: string; sending: string; sent: string; failed: string };

/** A button that sends one test LINE message and says whether LINE accepted it. */
export function TestMessage({ personId, labels }: { personId: string; labels: Labels }) {
  const [result, action] = useActionState(sendTestMessage, undefined);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="person_id" value={personId} />
      <SubmitButton pending={labels.sending}>{labels.send}</SubmitButton>
      <span role="status" className={result?.status === "failed" ? "text-red-600" : "text-zinc-500"}>
        {result?.status === "sent" ? labels.sent : result?.status === "failed" ? labels.failed : ""}
      </span>
    </form>
  );
}
