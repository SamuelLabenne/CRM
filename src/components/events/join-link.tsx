"use client";

import { useEffect, useState } from "react";
import { ExternalLink, Video } from "lucide-react";
import { brandBtn } from "./brand";

const WINDOW_MS = 30 * 60_000;

/** Online join link, revealed from 30 minutes before the start until the event ends. */
export function JoinLink({ url, startIso, endIso, nowMs }: { url: string; startIso: string; endIso: string; nowMs: number }) {
  const [now, setNow] = useState(nowMs);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 20_000);
    return () => clearInterval(t);
  }, []);
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  if (now >= end) return null;
  if (now < start - WINDOW_MS) {
    return (
      <div className="flex items-start gap-2.5 rounded-lg bg-muted/60 p-3 text-sm text-muted-foreground">
        <Video className="mt-0.5 size-4 shrink-0" />
        <span>The join link will appear here 30 minutes before the start.</span>
      </div>
    );
  }
  return (
    <a href={url} target="_blank" rel="noreferrer" className={brandBtn}>
      <Video className="size-4" /> Join now <ExternalLink className="size-3.5 opacity-80" />
    </a>
  );
}
