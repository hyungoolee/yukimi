"use client";

import { Conversation } from "@elevenlabs/client";
import { useEffect, useRef, useState } from "react";
import { startSatoCall } from "../../actions";
import { stripAudioTags } from "@/lib/audio-tags";

/** The first device whose name contains `hint`, else the system default. */
const pick = (devices: MediaDeviceInfo[], hint: string) => devices.find((d) => d.label.includes(hint))?.deviceId ?? "";

/**
 * Runs the Sato-san agent on chosen audio devices: she hears BlackHole 16ch (Yukimi's output) and speaks
 * into BlackHole 2ch (Yukimi's microphone), or a Multi-Output Device that includes it.
 */
export function SatoCall() {
  const call = useRef<Conversation | null>(null);
  const [inputs, setInputs] = useState<MediaDeviceInfo[]>([]);
  const [outputs, setOutputs] = useState<MediaDeviceInfo[]>([]);
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [live, setLive] = useState(false);
  const [error, setError] = useState("");
  const [lines, setLines] = useState<{ key: string; text: string; fromSato: boolean }[]>([]);

  useEffect(() => {
    // Device names are hidden until the page may use the microphone.
    void navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((probe) => probe.getTracks().forEach((t) => t.stop()))
      .then(() => navigator.mediaDevices.enumerateDevices())
      .then((devices) => {
        const ins = devices.filter((d) => d.kind === "audioinput");
        const outs = devices.filter((d) => d.kind === "audiooutput");
        setInputs(ins);
        setOutputs(outs);
        setInput(pick(ins, "BlackHole 16ch"));
        setOutput(pick(outs, "BlackHole 2ch"));
      })
      .catch((e) => setError(String(e)));
    return () => void call.current?.endSession();
  }, []);

  async function start() {
    setError("");
    setLines([]);
    const { token, error } = await startSatoCall();
    if (!token) return setError(error ?? "No token");
    try {
      call.current = await Conversation.startSession({
        conversationToken: token,
        inputDeviceId: input || undefined,
        outputDeviceId: output || undefined,
        // Matches no resident, so the app's post-call webhook records nothing if it hears of this conversation.
        dynamicVariables: { resident_id: "test" },
        onDisconnect: () => {
          call.current = null;
          setLive(false);
        },
        onError: (message) => setError(message),
        onMessage: ({ message, source, event_id }) => {
          const text = stripAudioTags(message);
          if (text) setLines((all) => [...all.filter((l) => l.key !== `${source}-${event_id}`), { key: `${source}-${event_id}`, text, fromSato: source === "ai" }]);
        },
      });
      setLive(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const select = (label: string, value: string, set: (v: string) => void, devices: MediaDeviceInfo[]) => (
    <label className="block text-sm">
      {label}
      <select value={value} onChange={(e) => set(e.target.value)} disabled={live} className="ml-2 rounded border border-zinc-300 px-2 py-1">
        <option value="">System default</option>
        {devices.map((d) => (
          <option key={d.deviceId} value={d.deviceId}>{d.label}</option>
        ))}
      </select>
    </label>
  );

  return (
    <div className="space-y-3">
      {select("She hears (microphone):", input, setInput, inputs)}
      {select("She speaks into (output):", output, setOutput, outputs)}
      {live ? (
        <button onClick={() => call.current?.endSession()} className="rounded bg-red-600 px-3 py-1 text-white">End</button>
      ) : (
        <button onClick={start} className="rounded border border-zinc-300 px-3 py-1 hover:bg-zinc-50">Start Sato-san</button>
      )}
      {error && <p className="text-red-600">{error}</p>}
      <ol className="space-y-1 text-sm">
        {lines.slice(-8).map((l) => (
          <li key={l.key}>
            <span className="text-zinc-500">{l.fromSato ? "Sato" : "Yukimi"}：</span>
            {l.text}
          </li>
        ))}
      </ol>
    </div>
  );
}
