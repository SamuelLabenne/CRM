"use client";

import { useEffect } from "react";

/** Tells the embedding page how tall this iframe content is (the embed snippet listens for `relay:resize`). */
export function EmbedResizer({ id }: { id: string }) {
  useEffect(() => {
    if (window.parent === window) return;
    const post = () => {
      const height = Math.ceil(document.documentElement.getBoundingClientRect().height);
      window.parent.postMessage({ type: "relay:resize", id, height }, "*");
    };
    post();
    const ro = new ResizeObserver(post);
    ro.observe(document.documentElement);
    ro.observe(document.body);
    return () => ro.disconnect();
  }, [id]);
  return null;
}
