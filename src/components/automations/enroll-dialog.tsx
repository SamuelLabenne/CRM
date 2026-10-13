"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Filter, Info, UserPlus, Users, X } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ContactPicker, type PickedContact } from "@/components/app/contact-picker";
import { countViewContactsAction, enrollContactsAction } from "@/app/(app)/automations/actions";
import { formatDate } from "@/lib/format";
import type { AutomationStatus } from "@/lib/types";
import { Field, ValueSelect } from "./fields";

/**
 * Manually enroll contacts (picked one by one, or everyone in a smart view). Works for any ACTIVE
 * automation; choose an event when the steps need one (wait until event, attendance conditions).
 */
export function EnrollDialog({
  automationId,
  status,
  views,
  events,
  timezone,
  needsEvent,
}: {
  automationId: string;
  status: AutomationStatus;
  views: { id: string; name: string }[];
  events: { id: string; title: string; startsAt: string }[];
  timezone: string;
  /** True when a step needs an event but the trigger doesn't provide one. */
  needsEvent: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"contacts" | "view">("contacts");
  const [picked, setPicked] = useState<PickedContact[]>([]);
  const [viewId, setViewId] = useState<string | null>(null);
  const [viewCount, setViewCount] = useState<number | null>(null);
  const [eventId, setEventId] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!viewId) return;
    let cancelled = false;
    countViewContactsAction(viewId).then((r) => {
      if (!cancelled) setViewCount(r.ok ? (r.data?.count ?? 0) : null);
    });
    return () => {
      cancelled = true;
    };
  }, [viewId]);

  const reset = () => {
    setPicked([]);
    setViewId(null);
    setViewCount(null);
    setEventId(null);
    setMode("contacts");
  };

  const canSubmit = status === "active" && (mode === "contacts" ? picked.length > 0 : Boolean(viewId) && viewCount !== 0) && (!needsEvent || eventId);

  const submit = () =>
    start(async () => {
      const res = await enrollContactsAction({
        automationId,
        contactIds: mode === "contacts" ? picked.map((p) => p.id) : undefined,
        viewId: mode === "view" ? viewId : undefined,
        eventId,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(res.message ?? "Contacts enrolled");
      setOpen(false);
      reset();
      router.refresh();
    });

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline">
          <UserPlus /> Enroll contacts
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Enroll contacts</DialogTitle>
          <DialogDescription>
            Start this automation for specific contacts or a whole smart view. The same re-entry rules as for the trigger apply.
          </DialogDescription>
        </DialogHeader>

        {status !== "active" && (
          <Alert>
            <Info />
            <AlertDescription>Activate the automation first – contacts can only be enrolled while it is active.</AlertDescription>
          </Alert>
        )}

        <Tabs value={mode} onValueChange={(v) => setMode(v as "contacts" | "view")} className="gap-3">
          <TabsList className="w-full">
            <TabsTrigger value="contacts" className="flex-1">
              <Users /> Pick contacts
            </TabsTrigger>
            <TabsTrigger value="view" className="flex-1">
              <Filter /> Smart view
            </TabsTrigger>
          </TabsList>
          <TabsContent value="contacts" className="grid gap-2">
            <ContactPicker
              value={null}
              onChange={(c) => c && setPicked((p) => (p.some((x) => x.id === c.id) ? p : [...p, c]))}
              excludeIds={picked.map((p) => p.id)}
              placeholder="Search and add contacts…"
            />
            {picked.length > 0 ? (
              <ul className="grid max-h-48 gap-1 overflow-y-auto rounded-lg border p-1.5">
                {picked.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-2 rounded-md px-2 py-1 text-sm hover:bg-muted">
                    <span className="min-w-0 truncate">
                      {c.name}
                      {c.email && <span className="ml-2 text-xs text-muted-foreground">{c.email}</span>}
                    </span>
                    <Button type="button" variant="ghost" size="icon-xs" aria-label={`Remove ${c.name}`} onClick={() => setPicked((p) => p.filter((x) => x.id !== c.id))}>
                      <X />
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted-foreground">Search for a contact and pick them to add them to the list. Repeat for more.</p>
            )}
          </TabsContent>
          <TabsContent value="view" className="grid gap-2">
            {views.length ? (
              <>
                <ValueSelect
                  value={viewId}
                  onChange={(v) => {
                    setViewId(v);
                    setViewCount(null);
                  }}
                  options={views.map((v) => ({ value: v.id, label: v.name }))}
                  placeholder="Choose a smart view"
                />
                {viewId && (
                  <p className="text-sm text-muted-foreground">
                    {viewCount == null ? "Counting contacts…" : `${viewCount} contact${viewCount === 1 ? "" : "s"} will be enrolled.`}
                  </p>
                )}
              </>
            ) : (
              <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
                No smart views yet. Save a filter on the Contacts page to create one.
              </p>
            )}
          </TabsContent>
        </Tabs>

        <Field
          label={needsEvent ? "Event (required for this automation)" : "Event (optional)"}
          hint="Gives the steps an event to work with: merge tags, “wait until event” and attendance conditions."
        >
          <ValueSelect
            value={eventId}
            onChange={setEventId}
            options={events.map((e) => ({ value: e.id, label: `${e.title} · ${formatDate(e.startsAt, timezone, "d MMM yyyy")}` }))}
            anyLabel={needsEvent ? undefined : "No event"}
            placeholder="Choose an event"
          />
        </Field>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!canSubmit || pending}>
            {pending && <Spinner />} Enroll
            {mode === "contacts" && picked.length > 0 ? ` ${picked.length} contact${picked.length === 1 ? "" : "s"}` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
