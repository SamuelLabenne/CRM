"use client";

import { useEffect } from "react";

/** Tells the embedding page how tall the booking widget is (used by the inline embed snippet). */
export function EmbedResizer() {
  useEffect(() => {
    if (window.parent === window) return;
    const send = () => window.parent.postMessage({ type: "relay:booking-height", height: document.documentElement.scrollHeight }, "*");
    send();
    const ro = new ResizeObserver(send);
    ro.observe(document.body);
    return () => ro.disconnect();
  }, []);
  return null;
}
