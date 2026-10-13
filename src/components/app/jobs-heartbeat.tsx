"use client";

import { useEffect } from "react";

/** Pings the job runner once a minute while the app is open (backup for the external cron). */
export function JobsHeartbeat() {
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible") void fetch("/api/jobs/tick", { method: "POST" }).catch(() => {});
    };
    const first = setTimeout(tick, 5_000);
    const id = setInterval(tick, 60_000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, []);
  return null;
}
