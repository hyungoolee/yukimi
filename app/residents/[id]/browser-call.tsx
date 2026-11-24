"use client";

import { Conversation } from "@elevenlabs/client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { startBrowserCall } from "../../actions";

type Labels = { start: string; connecting: string; end: string; micError: string };

/** Takes the check-in call in this tab, using its microphone and speaker as the resident's phone. */
export function BrowserCall({ residentId, labels }: { residentId: string; labels: Labels }) {
  const router = useRouter();
  const call = useRef<Conversation | null>(null);
  const [state, setState] = useState<"idle" | "connecting" | "live">("idle");
  const [error, setError] = useState("");

  // Leaving the page hangs up, so the microphone never stays live with no button to end it.
  const gone = useRef(false);
  useEffect(() => {
    gone.current = false;
    return () => {
      gone.current = true;
      void call.current?.endSession();
    };
  }, []);

  async function start() {
    setError("");
    setState("connecting");
    try {
      // Ask for the microphone up front for a clear error; the SDK opens its own stream.
      const probe = await navigator.mediaDevices.getUserMedia({ audio: true }).catch(() => {
        throw new Error(labels.micError);
      });
      probe.getTracks().forEach((track) => track.stop());

      const { token, variables } = await startBrowserCall(residentId);
      call.current = await Conversation.startSession({
        conversationToken: token,
        dynamicVariables: variables,
        onDisconnect: () => {
          call.current = null;
          setState("idle");
          router.refresh(); // the call's notes arrive a few seconds after it ends
        },
        onError: (message) => setError(message),
      });
      // The page was left while connecting: hang up now, since the cleanup above had nothing to end yet.
      if (gone.current) return void call.current.endSession();
      setState("live"); // only once there is a session the end button can close
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setState("idle");
    }
  }

  return (
    <>
      {state === "live" ? (
        <button onClick={() => call.current?.endSession()} className="rounded bg-red-600 px-3 py-1 text-white">
          {labels.end}
        </button>
      ) : (
        <button
          onClick={start}
          disabled={state === "connecting"}
          className="rounded border border-zinc-300 px-3 py-1 hover:bg-zinc-50 disabled:opacity-40"
        >
          {state === "connecting" ? labels.connecting : labels.start}
        </button>
      )}
      {error && <span className="text-red-600">{error}</span>}
    </>
  );
}
