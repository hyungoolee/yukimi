"use client";

import { Conversation } from "@elevenlabs/client";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { startBrowserCall } from "../../actions";

/** Takes the check-in call in this tab, using its microphone and speaker as the resident's phone. */
export function BrowserCall({ residentId }: { residentId: string }) {
  const router = useRouter();
  const call = useRef<Conversation | null>(null);
  const [state, setState] = useState<"idle" | "connecting" | "live">("idle");
  const [error, setError] = useState("");

  async function start() {
    setError("");
    setState("connecting");
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true }).catch(() => {
        throw new Error("マイクの使用を許可してください");
      });
      const { token, variables } = await startBrowserCall(residentId);
      call.current = await Conversation.startSession({
        conversationToken: token,
        dynamicVariables: variables,
        onConnect: () => setState("live"),
        onDisconnect: () => {
          call.current = null;
          setState("idle");
          router.refresh(); // the call's notes arrive a few seconds after it ends
        },
        onError: (message) => setError(message),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setState("idle");
    }
  }

  return (
    <>
      {state === "live" ? (
        <button onClick={() => call.current?.endSession()} className="rounded bg-red-600 px-3 py-1 text-white">
          通話を終了
        </button>
      ) : (
        <button
          onClick={start}
          disabled={state === "connecting"}
          className="rounded border border-zinc-300 px-3 py-1 hover:bg-zinc-50 disabled:opacity-40"
        >
          {state === "connecting" ? "接続中…" : "ブラウザで通話"}
        </button>
      )}
      {error && <span className="text-red-600">{error}</span>}
    </>
  );
}
