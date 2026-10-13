"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Renders email HTML in a script-less sandboxed iframe that grows to fit its content.
 * `allow-same-origin` is only used so the parent can measure the document; without
 * `allow-scripts` nothing inside the frame can execute.
 */
export function EmailFrame({
  html,
  title = "Email preview",
  width,
  minHeight = 320,
  className,
}: {
  html: string;
  title?: string;
  /** Fixed pixel width (mobile preview). Default: fill the container. */
  width?: number;
  minHeight?: number;
  className?: string;
}) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(minHeight);
  const observer = useRef<ResizeObserver | null>(null);

  const measure = useCallback(() => {
    const doc = ref.current?.contentDocument;
    if (!doc?.documentElement) return;
    setHeight(Math.max(minHeight, doc.documentElement.scrollHeight));
  }, [minHeight]);

  const onLoad = useCallback(() => {
    measure();
    observer.current?.disconnect();
    const doc = ref.current?.contentDocument;
    if (doc?.body && typeof ResizeObserver !== "undefined") {
      observer.current = new ResizeObserver(measure);
      observer.current.observe(doc.body);
    }
  }, [measure]);

  useEffect(() => () => observer.current?.disconnect(), []);

  return (
    <iframe
      ref={ref}
      title={title}
      srcDoc={html}
      sandbox="allow-same-origin"
      onLoad={onLoad}
      scrolling="no"
      className={cn("block max-w-full border-0 bg-white", className)}
      style={{ width: width ?? "100%", height }}
    />
  );
}
