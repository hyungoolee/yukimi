"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** In the root layout: re-reads every page's data every few seconds, so new calls and memory appear without a reload. */
export function Refresh() {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(timer);
  }, [router]);
  return null;
}
