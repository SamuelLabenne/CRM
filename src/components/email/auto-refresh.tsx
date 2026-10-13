"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Re-fetches the current server component tree every few seconds (e.g. while a broadcast is sending). */
export function AutoRefresh({ intervalMs = 4000, active = true }: { intervalMs?: number; active?: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(t);
  }, [router, intervalMs, active]);
  return null;
}
