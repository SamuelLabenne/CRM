"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { GitMerge, MoreHorizontal, Pencil, Plus, Search, Tags as TagsIcon, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { EmptyState } from "@/components/app/empty-state";
import { ColorBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ColorField, TAG_PRESETS } from "@/components/settings/color-field";
import { FieldErrors } from "@/components/settings/field-error";
import { SettingsCard } from "@/components/settings/settings-card";
import { useRunAction } from "@/components/settings/use-run-action";
import { pluralize } from "@/lib/format";
import { createTagAction, deleteTagAction, mergeTagsAction, updateTagAction } from "./actions";

export type TagRow = { id: string; name: string; color: string; count: number };
type Dialogs = { kind: "edit"; tag: TagRow } | { kind: "merge"; tag: TagRow } | { kind: "new" } | null;

export function TagsManager({ tags }: { tags: TagRow[] }) {
  const [dialog, setDialog] = useState<Dialogs>(null);
  const [q, setQ] = useState("");
  const shown = useMemo(() => tags.filter((t) => t.name.toLowerCase().includes(q.trim().toLowerCase())), [tags, q]);

  return (
    <>
      <SettingsCard
        title="All tags"
        description={tags.length ? pluralize(tags.length, "tag") : undefined}
        action={
          <Button onClick={() => setDialog({ kind: "new" })}>
            <Plus /> New tag
          </Button>
        }
        contentClassName={tags.length ? "px-0" : undefined}
      >
        {tags.length === 0 ? (
          <EmptyState
            icon={TagsIcon}
            title="No tags yet"
            description="Tags are added to contacts manually, by imports, automations and forms."
            action={
              <Button onClick={() => setDialog({ kind: "new" })}>
                <Plus /> Create a tag
              </Button>
            }
            className="border-0 bg-transparent"
          />
        ) : (
          <>
            {tags.length > 8 && (
              <div className="relative px-4">
                <Search className="pointer-events-none absolute top-2 left-7 size-4 text-muted-foreground" />
                <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search tags…" className="pl-8" aria-label="Search tags" />
              </div>
            )}
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Tag</TableHead>
                  <TableHead>Contacts</TableHead>
                  <TableHead className="w-10 pr-4" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="pl-4">
                      <ColorBadge color={t.color}>{t.name}</ColorBadge>
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {t.count > 0 ? (
                        <Link href={`/contacts?tag=${t.id}`} className="underline-offset-4 hover:underline">
                          {t.count}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">0</span>
                      )}
                    </TableCell>
                    <TableCell className="pr-4 text-right">
                      <TagMenu tag={t} others={tags.length > 1} onEdit={() => setDialog({ kind: "edit", tag: t })} onMerge={() => setDialog({ kind: "merge", tag: t })} />
                    </TableCell>
                  </TableRow>
                ))}
                {shown.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={3} className="py-6 text-center text-muted-foreground">
                      No tags match “{q}”.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </>
        )}
      </SettingsCard>

      <Dialog open={!!dialog} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent>
          {dialog?.kind === "merge" ? (
            <MergeForm key={dialog.tag.id} tag={dialog.tag} tags={tags} onClose={() => setDialog(null)} />
          ) : dialog ? (
            <TagForm key={dialog.kind === "edit" ? dialog.tag.id : "new"} tag={dialog.kind === "edit" ? dialog.tag : null} onClose={() => setDialog(null)} />
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

function TagMenu({ tag, others, onEdit, onMerge }: { tag: TagRow; others: boolean; onEdit: () => void; onMerge: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${tag.name}`}>
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={onEdit}>
          <Pencil /> Rename or recolor
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!others} onSelect={onMerge}>
          <GitMerge /> Merge into another tag…
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <ConfirmDialog
          title={`Delete “${tag.name}”?`}
          description={tag.count > 0 ? `It will be removed from ${pluralize(tag.count, "contact")}. The contacts themselves are not affected.` : "No contacts use this tag."}
          confirmLabel="Delete tag"
          destructive
          onConfirm={async () => {
            const res = await deleteTagAction(tag.id);
            if (res.ok) toast.success(res.message);
            else toast.error(res.error);
            setOpen(false);
          }}
          trigger={
            <DropdownMenuItem variant="destructive" onSelect={(e) => e.preventDefault()}>
              <Trash2 /> Delete
            </DropdownMenuItem>
          }
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function TagForm({ tag, onClose }: { tag: TagRow | null; onClose: () => void }) {
  const [name, setName] = useState(tag?.name ?? "");
  const [color, setColor] = useState(tag?.color ?? TAG_PRESETS[0]);
  const { run, pending, fieldErrors } = useRunAction();
  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => (tag ? updateTagAction({ id: tag.id, name, color }) : createTagAction({ name, color })), { onSuccess: onClose });
      }}
    >
      <DialogHeader>
        <DialogTitle>{tag ? "Edit tag" : "New tag"}</DialogTitle>
        <DialogDescription>{tag ? "Changes apply everywhere the tag is used." : "Tags are case-insensitive and must be unique."}</DialogDescription>
      </DialogHeader>
      <div className="grid gap-2">
        <Label htmlFor="tag-name">Name</Label>
        <Input id="tag-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} required autoFocus aria-invalid={!!fieldErrors.name} />
        <FieldErrors errors={fieldErrors.name} />
      </div>
      <div className="grid gap-2">
        <Label>Color</Label>
        <ColorField value={color} onChange={setColor} presets={TAG_PRESETS} />
        <FieldErrors errors={fieldErrors.color} />
      </div>
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        Preview <ColorBadge color={color}>{name.trim() || "Tag name"}</ColorBadge>
      </div>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending || !name.trim()}>
          {pending && <Spinner />} {tag ? "Save tag" : "Create tag"}
        </Button>
      </DialogFooter>
    </form>
  );
}

function MergeForm({ tag, tags, onClose }: { tag: TagRow; tags: TagRow[]; onClose: () => void }) {
  const options = tags.filter((t) => t.id !== tag.id);
  const [targetId, setTargetId] = useState(options[0]?.id ?? "");
  const target = options.find((t) => t.id === targetId);
  const { run, pending } = useRunAction();
  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => mergeTagsAction({ sourceId: tag.id, targetId }), { onSuccess: onClose });
      }}
    >
      <DialogHeader>
        <DialogTitle>Merge “{tag.name}”</DialogTitle>
        <DialogDescription>
          Everyone tagged <strong>{tag.name}</strong> ({pluralize(tag.count, "contact")}) gets the tag you choose, then <strong>{tag.name}</strong> is deleted. Automations, smart views and broadcast audiences that use it are updated too.
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-2">
        <Label htmlFor="merge-target">Merge into</Label>
        <NativeSelect id="merge-target" className="w-full" value={targetId} onChange={(e) => setTargetId(e.target.value)}>
          {options.map((t) => (
            <NativeSelectOption key={t.id} value={t.id}>
              {t.name} ({t.count})
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" variant="destructive" disabled={pending || !target}>
          {pending && <Spinner />} Merge tags
        </Button>
      </DialogFooter>
    </form>
  );
}
