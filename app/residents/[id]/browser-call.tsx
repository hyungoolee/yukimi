"use client";

import { Conversation } from "@elevenlabs/client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { startBrowserCall, translateCaption } from "../../actions";

type Labels = { start: string; connecting: string; end: string; micError: string; agent: string; you: string };
type Caption = { key: string; fromAgent: boolean; text: string; english?: string };

/**
 * Takes the check-in call in this tab, using its microphone and speaker as the resident's phone.
 * While the call runs it shows what each side said as captions, with English underneath when
 * `translate` is on.
 */
export function BrowserCall({ residentId, translate, labels }: { residentId: string; translate: boolean; labels: Labels }) {
  const router = useRouter();
  const call = useRef<Conversation | null>(null);
  const [state, setState] = useState<"idle" | "connecting" | "live">("idle");
  const [error, setError] = useState("");
  const [captions, setCaptions] = useState<Caption[]>([]);

  // A line can arrive more than once as it is corrected; the latest text for a key wins.
  function caption(key: string, fromAgent: boolean, text: string) {
    setCaptions((all) => [...all.filter((c) => c.key !== key), { key, fromAgent, text }]);
    if (!translate) return;
    void translateCaption(text).then((english) =>
      setCaptions((all) => all.map((c) => (c.key === key && c.text === text ? { ...c, english } : c))),
    );
  }

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
    setCaptions([]);
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
        onMessage: ({ message, source, event_id }) => caption(`${source}-${event_id}`, source === "ai", message),
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
      {captions.length > 0 && (
        <ol className="order-last w-full space-y-2 rounded-lg border border-zinc-200 p-3" aria-live="polite">
          {captions.slice(-6).map((c) => (
            <li key={c.key}>
              <span className="text-zinc-500">{c.fromAgent ? labels.agent : labels.you}：</span>
              <span className={c.fromAgent ? "text-base" : "text-base text-zinc-600"}>{c.text}</span>
              {c.english && <div className="text-zinc-600">{c.english}</div>}
            </li>
          ))}
        </ol>
      )}
    </>
  );
}
