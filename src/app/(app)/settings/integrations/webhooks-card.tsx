"use client";

import { useState } from "react";
import { Eye, EyeOff, FlaskConical, Pencil, Plus, RefreshCw, Trash2, Webhook } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { EmptyState } from "@/components/app/empty-state";
import { StatusBadge } from "@/components/app/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { CopyButton } from "@/components/settings/copy-button";
import { FieldErrors } from "@/components/settings/field-error";
import { SettingsCard } from "@/components/settings/settings-card";
import { useRunAction } from "@/components/settings/use-run-action";
import {
  createWebhookAction,
  deleteWebhookAction,
  revealWebhookSecretAction,
  rotateWebhookSecretAction,
  testWebhookAction,
  toggleWebhookAction,
  updateWebhookAction,
} from "./actions";

export type WebhookRow = {
  id: string;
  url: string;
  events: string[];
  isActive: boolean;
  lastDelivery: string | null;
  lastStatus: number | null;
};

const EVENT_DESCRIPTIONS: Record<string, string> = {
  "contact.created": "A new contact is created",
  "contact.updated": "A contact is edited",
  "registration.created": "Someone registers for an event",
  "registration.cancelled": "A registration is cancelled",
  "attendance.recorded": "Attendance is marked (attended / no-show)",
  "meeting.booked": "A meeting is booked",
  "meeting.cancelled": "A meeting is cancelled",
  "meeting.outcome": "A meeting outcome is logged",
  "lead.potential": "A visitor enters their email but doesn’t finish",
  "email.unsubscribed": "A contact unsubscribes",
};

function StatusPill({ status }: { status: number | null }) {
  if (status === null) return <StatusBadge tone="neutral">No deliveries yet</StatusBadge>;
  if (status === 0) return <StatusBadge tone="red">Couldn’t connect</StatusBadge>;
  if (status >= 200 && status < 300) return <StatusBadge tone="green">{status} OK</StatusBadge>;
  return <StatusBadge tone="red">HTTP {status}</StatusBadge>;
}

export function WebhooksCard({ hooks, eventNames }: { hooks: WebhookRow[]; eventNames: string[] }) {
  const [editing, setEditing] = useState<WebhookRow | "new" | null>(null);
  return (
    <>
      <SettingsCard
        title="Webhooks"
        description="Relay sends a signed JSON POST to your URL when things happen. Failed deliveries are retried automatically."
        action={
          <Button onClick={() => setEditing("new")}>
            <Plus /> Add webhook
          </Button>
        }
        contentClassName="gap-3"
      >
        {hooks.length === 0 ? (
          <EmptyState
            icon={Webhook}
            title="No webhooks yet"
            description="Use webhooks to push new contacts, registrations and meetings into Zapier, Make, Slack or your own systems."
            action={
              <Button onClick={() => setEditing("new")}>
                <Plus /> Add a webhook
              </Button>
            }
            className="border-0 bg-transparent"
          />
        ) : (
          hooks.map((h) => <WebhookItem key={h.id} hook={h} onEdit={() => setEditing(h)} />)
        )}
        <details className="rounded-lg border bg-muted/30 p-3 text-sm">
          <summary className="cursor-pointer font-medium">How to verify a webhook</summary>
          <div className="mt-2 grid gap-2 text-muted-foreground">
            <p>
              Each request has <code className="font-mono text-xs">x-relay-timestamp</code> and <code className="font-mono text-xs">x-relay-signature</code> headers. Compute an HMAC-SHA256 of{" "}
              <code className="font-mono text-xs">{"`${timestamp}.${rawBody}`"}</code> with your signing secret, base64url encoded, and compare it to the signature.
            </p>
            <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs text-foreground">{`import { createHmac } from "node:crypto";

const expected = createHmac("sha256", process.env.RELAY_WEBHOOK_SECRET)
  .update(\`\${req.headers["x-relay-timestamp"]}.\${rawBody}\`)
  .digest("base64url");
const valid = expected === req.headers["x-relay-signature"];`}</pre>
          </div>
        </details>
      </SettingsCard>
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="sm:max-w-lg">
          {editing && <WebhookForm key={editing === "new" ? "new" : editing.id} hook={editing === "new" ? null : editing} eventNames={eventNames} onClose={() => setEditing(null)} />}
        </DialogContent>
      </Dialog>
    </>
  );
}

function WebhookItem({ hook, onEdit }: { hook: WebhookRow; onEdit: () => void }) {
  const toggle = useRunAction();
  const test = useRunAction();
  const [secret, setSecret] = useState<string | null>(null);
  const [revealing, setRevealing] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  async function reveal() {
    if (secret) return setSecret(null);
    setRevealing(true);
    const res = await revealWebhookSecretAction(hook.id);
    setRevealing(false);
    if (res.ok && res.data) setSecret(res.data.secret);
    else if (!res.ok) toast.error(res.error);
  }

  return (
    <div className="grid gap-3 rounded-lg border bg-card p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="break-all font-mono text-sm">{hook.url}</div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {hook.events.length === 0 ? (
              <Badge variant="secondary">All events</Badge>
            ) : (
              hook.events.map((e) => (
                <Badge key={e} variant="secondary" className="font-mono text-[11px]">
                  {e}
                </Badge>
              ))
            )}
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <Switch
            checked={hook.isActive}
            disabled={toggle.pending}
            onCheckedChange={(v) => toggle.run(() => toggleWebhookAction({ id: hook.id, isActive: v }))}
            aria-label={hook.isActive ? "Pause webhook" : "Enable webhook"}
          />
          {hook.isActive ? "Active" : "Paused"}
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>Last delivery:</span>
        <StatusPill status={hook.lastStatus} />
        {hook.lastDelivery && <span>{hook.lastDelivery}</span>}
        {testResult && <span className="text-foreground">· {testResult}</span>}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex h-8 min-w-0 flex-1 items-center rounded-lg border border-input bg-muted/40 px-2.5 font-mono text-xs basis-56">
          <span className="truncate">{secret ?? "whsec_••••••••••••••••••••"}</span>
        </div>
        <Button variant="outline" size="sm" onClick={reveal} disabled={revealing}>
          {revealing ? <Spinner /> : secret ? <EyeOff /> : <Eye />} {secret ? "Hide" : "Reveal"}
        </Button>
        <CopyButton
          label="Copy secret"
          value={async () => {
            const res = await revealWebhookSecretAction(hook.id);
            if (!res.ok || !res.data) throw new Error(res.ok ? "No secret" : res.error);
            return res.data.secret;
          }}
        />
      </div>

      <div className="flex flex-wrap items-center gap-1 border-t pt-3">
        <Button
          variant="outline"
          size="sm"
          disabled={test.pending}
          onClick={() =>
            test.run(() => testWebhookAction(hook.id), {
              success: "",
              onSuccess: (r) => {
                if (!r) return;
                const text = r.ok ? `Test delivered (HTTP ${r.status}, ${r.durationMs} ms)` : `Test failed: ${r.error ?? "unknown error"}`;
                setTestResult(text);
                if (r.ok) toast.success(text);
                else toast.error(text);
              },
            })
          }
        >
          {test.pending ? <Spinner /> : <FlaskConical />} Send test
        </Button>
        <Button variant="ghost" size="sm" onClick={onEdit}>
          <Pencil /> Edit
        </Button>
        <ConfirmDialog
          title="Rotate signing secret?"
          description="A new secret is generated and the old one stops being used immediately. Update your endpoint with the new secret."
          confirmLabel="Rotate secret"
          onConfirm={async () => {
            const res = await rotateWebhookSecretAction(hook.id);
            if (res.ok && res.data) {
              setSecret(res.data.secret);
              toast.success(res.message);
            } else if (!res.ok) toast.error(res.error);
          }}
          trigger={
            <Button variant="ghost" size="sm">
              <RefreshCw /> Rotate secret
            </Button>
          }
        />
        <ConfirmDialog
          title="Delete this webhook?"
          description="Relay will stop sending events to this URL. Queued deliveries are dropped."
          confirmLabel="Delete webhook"
          destructive
          onConfirm={async () => {
            const res = await deleteWebhookAction(hook.id);
            if (res.ok) toast.success(res.message);
            else toast.error(res.error);
          }}
          trigger={
            <Button variant="ghost" size="sm" className="ml-auto text-destructive hover:text-destructive">
              <Trash2 /> Delete
            </Button>
          }
        />
      </div>
    </div>
  );
}

function WebhookForm({ hook, eventNames, onClose }: { hook: WebhookRow | null; eventNames: string[]; onClose: () => void }) {
  const [url, setUrl] = useState(hook?.url ?? "");
  const [events, setEvents] = useState<string[]>(hook?.events ?? []);
  const [isActive, setIsActive] = useState(hook?.isActive ?? true);
  const { run, pending, fieldErrors } = useRunAction();
  const all = events.length === 0;
  const toggleEvent = (e: string, on: boolean) => setEvents((list) => (on ? [...new Set([...list, e])] : list.filter((x) => x !== e)));

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        const input = { url, events: events as never, isActive };
        run(() => (hook ? updateWebhookAction({ id: hook.id, ...input }) : createWebhookAction(input)), { onSuccess: onClose });
      }}
    >
      <DialogHeader>
        <DialogTitle>{hook ? "Edit webhook" : "Add webhook"}</DialogTitle>
        <DialogDescription>{hook ? "Change where and when events are delivered." : "A signing secret is generated for you and can be revealed after saving."}</DialogDescription>
      </DialogHeader>
      <div className="grid gap-2">
        <Label htmlFor="wh-url">Endpoint URL</Label>
        <Input id="wh-url" type="url" inputMode="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/hooks/relay" required autoFocus aria-invalid={!!fieldErrors.url} />
        <FieldErrors errors={fieldErrors.url} />
      </div>
      <div className="grid gap-2">
        <Label>Events</Label>
        <label className="flex items-center gap-2 rounded-lg border p-2.5 text-sm">
          <Checkbox checked={all} onCheckedChange={(v) => v && setEvents([])} aria-label="All events" />
          <span className="font-medium">All events</span>
          <span className="text-muted-foreground">(including future ones)</span>
        </label>
        <div className="grid max-h-64 gap-1 overflow-y-auto rounded-lg border p-1.5">
          {eventNames.map((e) => (
            <label key={e} className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm hover:bg-muted/60">
              <Checkbox checked={events.includes(e)} onCheckedChange={(v) => toggleEvent(e, v === true)} aria-label={e} />
              <span className="min-w-0">
                <span className="block font-mono text-xs">{e}</span>
                <span className="block text-xs text-muted-foreground">{EVENT_DESCRIPTIONS[e] ?? ""}</span>
              </span>
            </label>
          ))}
        </div>
        <FieldErrors errors={fieldErrors.events} />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <Switch checked={isActive} onCheckedChange={setIsActive} /> Active
      </label>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending || !url.trim()}>
          {pending && <Spinner />} {hook ? "Save webhook" : "Create webhook"}
        </Button>
      </DialogFooter>
    </form>
  );
}
