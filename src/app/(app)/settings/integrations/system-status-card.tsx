"use client";

import { Activity, CircleAlert, Play, RotateCw } from "lucide-react";
import { StatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { SettingsCard } from "@/components/settings/settings-card";
import { useRunAction } from "@/components/settings/use-run-action";
import { retryFailedJobsAction, runJobsNowAction } from "./actions";

export type StatusView = {
  health: "healthy" | "stale" | "never";
  heartbeat: string | null;
  pending: number;
  running: number;
  overdue: number;
  failed: number;
  failedJobs: { id: string; type: string; error: string | null; attempts: number; when: string }[];
};

function Stat({ label, value, tone }: { label: string; value: number; tone?: "red" | "amber" }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={tone === "red" && value > 0 ? "text-2xl font-semibold text-destructive" : tone === "amber" && value > 0 ? "text-2xl font-semibold text-amber-600 dark:text-amber-400" : "text-2xl font-semibold"}>{value}</div>
    </div>
  );
}

export function SystemStatusCard({ status }: { status: StatusView }) {
  const runNow = useRunAction();
  const retry = useRunAction();
  const tone = status.health === "healthy" ? "green" : status.health === "stale" ? "amber" : "neutral";
  return (
    <SettingsCard
      title="System status"
      description="Emails, reminders, automations and webhooks are sent by a background job runner that wakes up every minute."
      action={
        <Button variant="outline" disabled={runNow.pending} onClick={() => runNow.run(runJobsNowAction, { success: "" , onSuccess: () => undefined })}>
          {runNow.pending ? <Spinner /> : <Play />} Run jobs now
        </Button>
      }
    >
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Activity className="size-4 text-muted-foreground" />
        <span className="font-medium">Job runner</span>
        <StatusBadge tone={tone}>{status.health === "healthy" ? "Healthy" : status.health === "stale" ? "No recent run" : "Not run yet"}</StatusBadge>
        <span className="text-muted-foreground">{status.heartbeat ? `Last run ${status.heartbeat}` : "Waiting for the first run"}</span>
      </div>
      {status.health === "stale" && (
        <p className="text-sm text-muted-foreground">
          Nothing has run for a while. In production make sure your scheduler calls <code className="font-mono text-xs">/api/cron</code> every minute (with the CRON_SECRET) – or open Relay and the app will process jobs for you.
        </p>
      )}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Pending" value={status.pending} />
        <Stat label="Running" value={status.running} />
        <Stat label="Overdue (>5 min)" value={status.overdue} tone="amber" />
        <Stat label="Failed" value={status.failed} tone="red" />
      </div>
      {status.failedJobs.length > 0 && (
        <div className="grid gap-2">
          <div className="flex items-center justify-between gap-2">
            <h3 className="flex items-center gap-1.5 text-sm font-medium">
              <CircleAlert className="size-4 text-destructive" /> Latest failed jobs
            </h3>
            <Button variant="ghost" size="sm" disabled={retry.pending} onClick={() => retry.run(retryFailedJobsAction, { success: "" })}>
              {retry.pending ? <Spinner /> : <RotateCw />} Retry all
            </Button>
          </div>
          <ul className="divide-y rounded-lg border">
            {status.failedJobs.map((j) => (
              <li key={j.id} className="grid gap-0.5 p-3 text-sm">
                <div className="flex flex-wrap items-center gap-x-3">
                  <code className="font-mono text-xs font-medium">{j.type}</code>
                  <span className="text-xs text-muted-foreground">
                    {j.attempts} attempt{j.attempts === 1 ? "" : "s"} · queued {j.when}
                  </span>
                </div>
                <p className="line-clamp-3 break-words text-xs text-destructive">{j.error ?? "No error message"}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </SettingsCard>
  );
}
