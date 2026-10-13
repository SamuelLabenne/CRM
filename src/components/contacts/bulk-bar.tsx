"use client";

import { useState, useTransition } from "react";
import { Download, Tag, Trash2, UserCog, CalendarPlus, Columns3, X, Tags } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Spinner } from "@/components/ui/spinner";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { bulkContactsAction, type BulkOpInput, type BulkSelectionInput } from "@/app/(app)/contacts/actions";
import { EventPicker, type PickedEvent } from "@/components/contacts/event-picker";
import type { StageDTO, TagDTO, UserDTO } from "@/lib/contacts/dto";

type Mode = "add_tag" | "remove_tag" | "stage" | "owner" | "event";

/** Bulk action bar shown when rows are selected in the contacts table. */
export function BulkBar({
  count,
  selection,
  exportHref,
  tags,
  stages,
  users,
  timezone,
  onClear,
}: {
  count: number;
  selection: BulkSelectionInput;
  exportHref: string;
  tags: TagDTO[];
  stages: StageDTO[];
  users: UserDTO[];
  timezone: string;
  onClear: () => void;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode | null>(null);
  const [pending, start] = useTransition();
  const [tagName, setTagName] = useState("");
  const [tagId, setTagId] = useState("");
  const [stage, setStage] = useState(stages[0]?.key ?? "");
  const [ownerId, setOwnerId] = useState("");
  const [event, setEvent] = useState<PickedEvent | null>(null);
  const [silent, setSilent] = useState(false);

  const run = (op: BulkOpInput, after?: () => void) =>
    start(async () => {
      const res = await bulkContactsAction(selection, op);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(res.message ?? "Done");
      after?.();
      setMode(null);
      onClear();
      router.refresh();
    });

  const submit = () => {
    switch (mode) {
      case "add_tag":
        if (!tagName.trim()) return toast.error("Enter a tag name");
        return run({ op: "add_tag", tagName }, () => setTagName(""));
      case "remove_tag":
        if (!tagId) return toast.error("Pick a tag");
        return run({ op: "remove_tag", tagId });
      case "stage":
        return run({ op: "stage", stage });
      case "owner":
        return run({ op: "owner", ownerId: ownerId || null });
      case "event":
        if (!event) return toast.error("Pick an event");
        return run({ op: "event", eventId: event.id, silent });
    }
  };

  const title = {
    add_tag: "Add a tag",
    remove_tag: "Remove a tag",
    stage: "Change stage",
    owner: "Assign owner",
    event: "Add to event",
  } as const;

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 border-b bg-accent/50 px-3 py-2 text-sm">
        <span className="mr-1 font-medium">{count.toLocaleString("en-AU")} selected</span>
        <Button size="sm" variant="outline" onClick={() => setMode("add_tag")}>
          <Tag /> Add tag
        </Button>
        <Button size="sm" variant="outline" onClick={() => setMode("remove_tag")}>
          <Tags /> Remove tag
        </Button>
        <Button size="sm" variant="outline" onClick={() => setMode("stage")}>
          <Columns3 /> Stage
        </Button>
        <Button size="sm" variant="outline" onClick={() => setMode("owner")}>
          <UserCog /> Owner
        </Button>
        <Button size="sm" variant="outline" onClick={() => setMode("event")}>
          <CalendarPlus /> Add to event
        </Button>
        <Button size="sm" variant="outline" asChild>
          <a href={exportHref} download>
            <Download /> Export
          </a>
        </Button>
        <ConfirmDialog
          destructive
          title={`Delete ${count.toLocaleString("en-AU")} contact${count === 1 ? "" : "s"}?`}
          description="This permanently deletes the contacts and their journey history. Registrations and tasks linked to them are removed too. This can't be undone."
          confirmLabel="Delete"
          onConfirm={() => run({ op: "delete" })}
          trigger={
            <Button size="sm" variant="destructive">
              <Trash2 /> Delete
            </Button>
          }
        />
        <Button size="sm" variant="ghost" className="ml-auto" onClick={onClear}>
          <X /> Clear
        </Button>
      </div>

      <Dialog open={mode !== null} onOpenChange={(o) => !o && !pending && setMode(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{mode ? title[mode] : ""}</DialogTitle>
            <DialogDescription>
              Applies to {count.toLocaleString("en-AU")} selected contact{count === 1 ? "" : "s"}.
            </DialogDescription>
          </DialogHeader>
          {mode === "add_tag" && (
            <div className="grid gap-2">
              <Label htmlFor="bulk-tag">Tag name</Label>
              <Input id="bulk-tag" list="bulk-tag-list" value={tagName} onChange={(e) => setTagName(e.target.value)} placeholder="e.g. Webinar attendee" autoFocus />
              <datalist id="bulk-tag-list">
                {tags.map((t) => (
                  <option key={t.id} value={t.name} />
                ))}
              </datalist>
              <p className="text-xs text-muted-foreground">Pick an existing tag or type a new one – it will be created.</p>
            </div>
          )}
          {mode === "remove_tag" && (
            <div className="grid gap-2">
              <Label htmlFor="bulk-untag">Tag</Label>
              <NativeSelect id="bulk-untag" className="w-full" value={tagId} onChange={(e) => setTagId(e.target.value)}>
                <NativeSelectOption value="">Select a tag…</NativeSelectOption>
                {tags.map((t) => (
                  <NativeSelectOption key={t.id} value={t.id}>
                    {t.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
          )}
          {mode === "stage" && (
            <div className="grid gap-2">
              <Label htmlFor="bulk-stage">Stage</Label>
              <NativeSelect id="bulk-stage" className="w-full" value={stage} onChange={(e) => setStage(e.target.value)}>
                {stages.map((s) => (
                  <NativeSelectOption key={s.key} value={s.key}>
                    {s.label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
          )}
          {mode === "owner" && (
            <div className="grid gap-2">
              <Label htmlFor="bulk-owner">Owner</Label>
              <NativeSelect id="bulk-owner" className="w-full" value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
                <NativeSelectOption value="">Unassigned</NativeSelectOption>
                {users.map((u) => (
                  <NativeSelectOption key={u.id} value={u.id}>
                    {u.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
          )}
          {mode === "event" && (
            <div className="grid gap-3">
              <EventPicker value={event} onChange={setEvent} timezone={timezone} />
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={!silent} onCheckedChange={(c) => setSilent(c !== true)} />
                Send registration confirmation emails
              </label>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setMode(null)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={pending}>
              {pending && <Spinner />} Apply
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
