"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // fallback for insecure contexts
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const okCopy = document.execCommand("copy");
    document.body.removeChild(ta);
    return okCopy;
  }
}

/** Copies `text` (or `path` resolved against the current origin) and shows a toast. */
export function CopyButton({
  text,
  path,
  label = "Copy",
  successMessage = "Copied to clipboard",
  size = "sm",
  variant = "outline",
  iconOnly,
}: {
  text?: string;
  path?: string;
  label?: string;
  successMessage?: string;
  size?: React.ComponentProps<typeof Button>["size"];
  variant?: React.ComponentProps<typeof Button>["variant"];
  iconOnly?: boolean;
}) {
  const [done, setDone] = useState(false);
  return (
    <Button
      type="button"
      size={iconOnly ? "icon-sm" : size}
      variant={variant}
      aria-label={iconOnly ? label : undefined}
      title={iconOnly ? label : undefined}
      onClick={async () => {
        const value = text ?? `${window.location.origin}${path ?? ""}`;
        if (await copyText(value)) {
          toast.success(successMessage);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } else toast.error("Could not copy – select the text and copy it manually.");
      }}
    >
      {done ? <Check /> : <Copy />}
      {!iconOnly && label}
    </Button>
  );
}
