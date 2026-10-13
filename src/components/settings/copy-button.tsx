"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

/** Copies `value` to the clipboard with a confirmation tick + toast. */
export function CopyButton({
  value,
  label = "Copy",
  iconOnly,
  variant = "outline",
  size = "sm",
  className,
}: {
  value: string | (() => string | Promise<string>);
  label?: string;
  iconOnly?: boolean;
  variant?: React.ComponentProps<typeof Button>["variant"];
  size?: React.ComponentProps<typeof Button>["size"];
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  async function copy() {
    try {
      const text = typeof value === "function" ? await value() : value;
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success("Copied to clipboard");
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Couldn't copy. Select the text and copy it manually.");
    }
  }

  return (
    <Button type="button" variant={variant} size={iconOnly ? (size === "sm" ? "icon-sm" : "icon") : size} onClick={copy} className={className} aria-label={iconOnly ? label : undefined}>
      {copied ? <Check /> : <Copy />}
      {!iconOnly && (copied ? "Copied" : label)}
    </Button>
  );
}
