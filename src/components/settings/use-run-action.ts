"use client";

import { useCallback, useState, useTransition } from "react";
import { toast } from "sonner";
import type { ActionResult } from "@/lib/action";

type FieldErrors = Record<string, string[] | undefined>;

/**
 * Run a server action inside a transition with toast feedback.
 *
 *   const { run, pending, fieldErrors } = useRunAction();
 *   run(() => saveThing(input), { success: "Saved" });
 */
export function useRunAction() {
  const [pending, start] = useTransition();
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  const run = useCallback(
    <T,>(
      fn: () => Promise<ActionResult<T>>,
      opts: { success?: string; onSuccess?: (data: T | undefined) => void; onError?: (error: string) => void } = {},
    ) => {
      start(async () => {
        setFieldErrors({});
        try {
          const res = await fn();
          if (res.ok) {
            const message = res.message ?? opts.success;
            if (message !== "") toast.success(message ?? "Saved");
            opts.onSuccess?.(res.data);
          } else {
            setFieldErrors(res.fieldErrors ?? {});
            toast.error(res.error);
            opts.onError?.(res.error);
          }
        } catch {
          toast.error("Something went wrong. Please try again.");
        }
      });
    },
    [],
  );

  return { run, pending, fieldErrors, setFieldErrors };
}
