"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Bookmark, Check, Filter, Globe, Lock, MoreHorizontal, Pencil, Save, Search, Trash2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { FilterBuilder } from "@/components/contacts/filter-builder";
import { deleteViewAction, saveViewAction } from "@/app/(app)/contacts/actions";
import { encodeFilter, sanitizeFilterGroup } from "@/lib/contacts/filter-codec";
import { EMAIL_STATUS_OPTIONS, LEAD_STATUS_OPTIONS, SOURCE_OPTIONS, describeFilter, type FilterOptions } from "@/lib/contacts/filter-fields";
import type { SavedViewDTO } from "@/lib/contacts/dto";
import type { QuickFilters } from "@/lib/contacts/query";
import type { FilterGroup } from "@/lib/types";
import { cn } from "@/lib/utils";

export type ViewPill = SavedViewDTO & { href: string; canEdit: boolean };

type Props = {
  q: string;
  group: FilterGroup;
  quick: QuickFilters;
  views: ViewPill[];
  activeViewId: string | null;
  /** True when the current filters differ from the active view's saved filters. */
  viewDirty: boolean;
  /** Quick + advanced filters merged into one group (null when they can't be expressed as a single view). */
  mergedGroup: FilterGroup | null;
  options: FilterOptions;
  total: number;
};

/** Search box, quick filters, advanced filter popover, active-filter chips and Smart Views. */
export function ContactsToolbar(props: Props) {
  const { group, quick, views, activeViewId, options } = props;
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [navPending, startNav] = useTransition();
  const [q, setQ] = useState(props.q);
  const [seenQ, setSeenQ] = useState(props.q);
  const [lastPushed, setLastPushed] = useState(props.q);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep the input in sync with the URL when it changes elsewhere (clear all, saved views…).
  if (props.q !== seenQ) {
    setSeenQ(props.q);
    if (props.q !== lastPushed) setQ(props.q);
  }

  const nav = (patch: Record<string, string | null | undefined>) => {
    const p = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v == null || v === "") p.delete(k);
      else p.set(k, v);
    }
    p.delete("page");
    const qs = p.toString();
    startNav(() => router.replace(qs ? `${pathname}?${qs}` : pathname));
  };

  const onSearch = (value: string) => {
    setQ(value);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setLastPushed(value.trim());
      nav({ q: value.trim() });
    }, 350);
  };

  const [draft, setDraft] = useState<FilterGroup>(group);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const clean = sanitizeFilterGroup(group);
  const quickCount = Object.values(quick).filter(Boolean).length;
  const activeCount = clean.filters.length + quickCount;

  const applyAdvanced = (g: FilterGroup) => {
    const enc = encodeFilter(g);
    nav({ f: enc, view: enc ? activeViewId : null });
  };
  const setQuick = (key: keyof QuickFilters, value: string) => nav({ [key]: value || null });
  const clearAll = () => {
    setQ("");
    setLastPushed("");
    nav({ q: null, f: null, view: null, stage: null, lead: null, tag: null, owner: null, email: null, source: null });
  };

  const activeView = views.find((v) => v.id === activeViewId) ?? null;
  const [dialog, setDialog] = useState<"create" | "edit" | null>(null);

  return (
    <div className="grid gap-3">
      <ViewsRow views={views} activeViewId={activeViewId} />

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-52 flex-1 sm:max-w-sm">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => onSearch(e.target.value)} placeholder="Search name, email, phone, company…" className="pl-8" aria-label="Search contacts" />
          {navPending && <Spinner className="absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-muted-foreground" />}
        </div>

        <NativeSelect size="sm" aria-label="Filter by stage" value={quick.stage ?? ""} onChange={(e) => setQuick("stage", e.target.value)}>
          <NativeSelectOption value="">All stages</NativeSelectOption>
          {options.stages.map((s) => (
            <NativeSelectOption key={s.key} value={s.key}>
              {s.label}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <NativeSelect size="sm" aria-label="Filter by lead status" value={quick.lead ?? ""} onChange={(e) => setQuick("lead", e.target.value)}>
          <NativeSelectOption value="">Any lead status</NativeSelectOption>
          {LEAD_STATUS_OPTIONS.map((o) => (
            <NativeSelectOption key={o.value} value={o.value}>
              {o.label}
            </NativeSelectOption>
          ))}
          <NativeSelectOption value="none">No lead status</NativeSelectOption>
        </NativeSelect>
        <NativeSelect size="sm" aria-label="Filter by tag" value={quick.tag ?? ""} onChange={(e) => setQuick("tag", e.target.value)}>
          <NativeSelectOption value="">Any tag</NativeSelectOption>
          {options.tags.map((t) => (
            <NativeSelectOption key={t.id} value={t.id}>
              {t.name}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <NativeSelect size="sm" aria-label="Filter by owner" value={quick.owner ?? ""} onChange={(e) => setQuick("owner", e.target.value)}>
          <NativeSelectOption value="">Any owner</NativeSelectOption>
          {options.users.map((u) => (
            <NativeSelectOption key={u.id} value={u.id}>
              {u.name}
            </NativeSelectOption>
          ))}
          <NativeSelectOption value="none">Unassigned</NativeSelectOption>
        </NativeSelect>
        <NativeSelect size="sm" aria-label="Filter by email status" value={quick.email ?? ""} onChange={(e) => setQuick("email", e.target.value)} className="hidden sm:block">
          <NativeSelectOption value="">Any email status</NativeSelectOption>
          {EMAIL_STATUS_OPTIONS.map((o) => (
            <NativeSelectOption key={o.value} value={o.value}>
              {o.label}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <NativeSelect size="sm" aria-label="Filter by source" value={quick.source ?? ""} onChange={(e) => setQuick("source", e.target.value)} className="hidden sm:block">
          <NativeSelectOption value="">Any source</NativeSelectOption>
          {SOURCE_OPTIONS.map((o) => (
            <NativeSelectOption key={o.value} value={o.value}>
              {o.label}
            </NativeSelectOption>
          ))}
        </NativeSelect>

        <Popover
          open={filtersOpen}
          onOpenChange={(o) => {
            if (o) setDraft(group);
            setFiltersOpen(o);
          }}
        >
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm">
              <Filter /> Filters
              {clean.filters.length > 0 && (
                <Badge variant="secondary" className="ml-0.5 h-4 px-1.5">
                  {clean.filters.length}
                </Badge>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-[min(46rem,calc(100vw-2rem))] p-4">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-medium">Advanced filters</h3>
                <p className="text-xs text-muted-foreground">Combine conditions on any field, tag, event or custom field.</p>
              </div>
            </div>
            <FilterBuilder value={draft} onChange={setDraft} options={options} />
            <div className="mt-4 flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setDraft({ match: "all", filters: [] });
                  applyAdvanced({ match: "all", filters: [] });
                  setFiltersOpen(false);
                }}
              >
                Clear
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  applyAdvanced(sanitizeFilterGroup(draft));
                  setFiltersOpen(false);
                }}
              >
                <Check /> Apply
              </Button>
            </div>
          </PopoverContent>
        </Popover>

        {(activeCount > 0 || q) && (
          <Button variant="ghost" size="sm" onClick={clearAll}>
            <X /> Clear
          </Button>
        )}
      </div>

      {(clean.filters.length > 0 || activeView) && (
        <div className="flex flex-wrap items-center gap-2">
          {clean.filters.length > 1 && (
            <span className="text-xs text-muted-foreground">Matching {clean.match === "any" ? "any" : "all"} of:</span>
          )}
          {clean.filters.map((f, i) => (
            <Badge key={i} variant="secondary" className="h-6 gap-1 pr-1 font-normal">
              {describeFilter(f, options)}
              <button
                type="button"
                aria-label="Remove filter"
                className="rounded-full p-0.5 hover:bg-foreground/10"
                onClick={() => applyAdvanced({ ...clean, filters: clean.filters.filter((_, j) => j !== i) })}
              >
                <X className="size-3" />
              </button>
            </Badge>
          ))}
          <div className="ml-auto flex items-center gap-2">
            {activeView && props.viewDirty && activeView.canEdit && (
              <Button
                size="sm"
                variant="outline"
                disabled={!props.mergedGroup}
                onClick={async () => {
                  const res = await saveViewAction({ id: activeView.id, name: activeView.name, description: activeView.description, visibility: activeView.visibility, filters: props.mergedGroup! });
                  if (res.ok) {
                    toast.success(res.message ?? "View updated");
                    router.refresh();
                  } else toast.error(res.error);
                }}
              >
                <Save /> Update “{activeView.name}”
              </Button>
            )}
            {activeCount > 0 && (
              <Button size="sm" variant="outline" onClick={() => setDialog("create")}>
                <Bookmark /> Save as Smart View
              </Button>
            )}
            {activeView && activeView.canEdit && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="icon-sm" variant="ghost" aria-label="View options">
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => setDialog("edit")}>
                    <Pencil /> Rename / visibility
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <ConfirmDialog
                    destructive
                    title={`Delete “${activeView.name}”?`}
                    description="The view is removed for everyone who can see it. Contacts are not affected."
                    confirmLabel="Delete view"
                    onConfirm={async () => {
                      const res = await deleteViewAction(activeView.id);
                      if (res.ok) {
                        toast.success(res.message ?? "View deleted");
                        nav({ view: null, f: null });
                      } else toast.error(res.error);
                    }}
                    trigger={
                      <DropdownMenuItem variant="destructive" onSelect={(e) => e.preventDefault()}>
                        <Trash2 /> Delete view
                      </DropdownMenuItem>
                    }
                  />
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>
      )}

      {dialog && (
        <ViewDialog
          mode={dialog}
          view={dialog === "edit" ? activeView : null}
          mergedGroup={props.mergedGroup}
          onClose={() => setDialog(null)}
          onSaved={(id) => {
            setDialog(null);
            const g = props.mergedGroup;
            if (dialog === "create" && g) {
              // Quick filters are now part of the view's filter group, so move them into `f`.
              nav({ view: id, f: encodeFilter(g), stage: null, lead: null, tag: null, owner: null, email: null, source: null });
            } else router.refresh();
          }}
        />
      )}
    </div>
  );
}

function ViewsRow({ views, activeViewId }: { views: ViewPill[]; activeViewId: string | null }) {
  return (
    <div className="-mx-1 flex items-center gap-1 overflow-x-auto px-1 pb-1" role="tablist" aria-label="Smart Views">
      <Link
        href="/contacts"
        role="tab"
        aria-selected={!activeViewId}
        className={cn(
          "shrink-0 rounded-full px-3 py-1 text-sm transition-colors",
          !activeViewId ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
        )}
      >
        All contacts
      </Link>
      {views.map((v) => (
        <Link
          key={v.id}
          href={v.href}
          role="tab"
          aria-selected={v.id === activeViewId}
          className={cn(
            "inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-sm transition-colors",
            v.id === activeViewId ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          {v.visibility === "private" ? <Lock className="size-3" /> : <Globe className="size-3 opacity-70" />}
          {v.name}
        </Link>
      ))}
      {views.length === 0 && <span className="px-2 text-xs text-muted-foreground">Filter, then “Save as Smart View” to create a reusable list.</span>}
    </div>
  );
}

function ViewDialog({
  mode,
  view,
  mergedGroup,
  onClose,
  onSaved,
}: {
  mode: "create" | "edit";
  view: ViewPill | null;
  mergedGroup: FilterGroup | null;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const [name, setName] = useState(mode === "edit" ? (view?.name ?? "") : "");
  const [description, setDescription] = useState(mode === "edit" ? (view?.description ?? "") : "");
  const [visibility, setVisibility] = useState<"private" | "shared">(view?.visibility ?? "shared");
  const [pending, start] = useTransition();
  const blocked = mode === "create" && !mergedGroup;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    start(async () => {
      const res = await saveViewAction({
        id: mode === "edit" ? view?.id : undefined,
        name,
        description,
        visibility,
        filters: mode === "create" ? (mergedGroup ?? undefined) : undefined,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(res.message ?? "Saved");
      onSaved(res.data!.id);
    });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{mode === "create" ? "Save as Smart View" : "Edit Smart View"}</DialogTitle>
            <DialogDescription>
              {mode === "create" ? "Saves the current filters so you can come back to this list in one click." : "Change the name or who can see this view."}
            </DialogDescription>
          </DialogHeader>
          {blocked && (
            <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
              Quick filters can&apos;t be combined with an advanced filter set to “match any”. Clear the quick filters or switch the advanced filter to “match all” to save this view.
            </p>
          )}
          <div className="grid gap-1.5">
            <Label htmlFor="view-name">Name</Label>
            <Input id="view-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Hot leads this month" autoFocus required maxLength={80} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="view-desc">Description (optional)</Label>
            <Input id="view-desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="view-vis">Visibility</Label>
            <NativeSelect id="view-vis" className="w-full" value={visibility} onChange={(e) => setVisibility(e.target.value as "private" | "shared")}>
              <NativeSelectOption value="shared">Shared – everyone on the team</NativeSelectOption>
              <NativeSelectOption value="private">Private – only me</NativeSelectOption>
            </NativeSelect>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || blocked || !name.trim()}>
              {pending && <Spinner />} {mode === "create" ? "Save view" : "Save changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
