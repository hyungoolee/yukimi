"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** In the root layout: re-reads every page's data every few seconds, so new calls and memory appear without a reload. */
/**
 * Set by the browser call while it runs. A refresh that fails (a redeploy, a restart) makes Next
 * reload the whole page, which would cut the call.
 */
export const liveCall = { on: false };

export function Refresh() {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => liveCall.on || router.refresh(), 5000);
    return () => clearInterval(timer);
  }, [router]);
  return null;
}
