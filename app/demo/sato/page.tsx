import { notFound } from "next/navigation";
import { DEMO_MODE } from "@/lib/env";
import { SatoCall } from "./sato-call";

/** Demo only: the AI Sato-san, run in a tab of its own so her audio can be routed to Yukimi's call (demo/shot-list.md). */
export default function SatoPage() {
  if (!DEMO_MODE) notFound();
  return (
    <main className="mx-auto max-w-2xl space-y-4 p-6">
      <h1 className="text-xl font-semibold">AI Sato-san (demo actor)</h1>
      <p className="text-sm text-zinc-600">
        Start her first: she waits for Yukimi to speak. Then start ブラウザで通話 on Sato&apos;s page in the other window.
      </p>
      <SatoCall />
    </main>
  );
}
