"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Plus, RotateCcw, Trash2 } from "lucide-react";
import { nanoid } from "nanoid";
import { toast } from "sonner";
import { ColorBadge } from "@/components/app/status-badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import { ColorField } from "@/components/settings/color-field";
import { SettingsCard } from "@/components/settings/settings-card";
import { useRunAction } from "@/components/settings/use-run-action";
import { pluralize } from "@/lib/format";
import type { Stage, StageCategory } from "@/lib/types";
import { savePipelineAction } from "./actions";

type Item = { id: string; key: string | null; label: string; color: string; category: StageCategory };

const CATEGORY_LABEL: Record<StageCategory, string> = { active: "Active", won: "Won", lost: "Lost" };
const PROTECTED_KEY = "new";

const toItems = (stages: Stage[]): Item[] => stages.map((s) => ({ ...s, id: s.key }));

export function StagesEditor({ initial, usage }: { initial: Stage[]; usage: Record<string, number> }) {
  const [items, setItems] = useState<Item[]>(() => toItems(initial));
  const [moves, setMoves] = useState<Record<string, string>>({});
  const [removing, setRemoving] = useState<Item | null>(null);
  const [target, setTarget] = useState("");
  const { run, pending } = useRunAction();

  const dirty = useMemo(
    () =>
      Object.keys(moves).length > 0 ||
      items.length !== initial.length ||
      items.some((it, i) => it.key !== initial[i]?.key || it.label !== initial[i]?.label || it.color !== initial[i]?.color || it.category !== initial[i]?.category),
    [items, initial, moves],
  );

  const update = (id: string, patch: Partial<Item>) => setItems((list) => list.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  const move = (i: number, dir: -1 | 1) =>
    setItems((list) => {
      const j = i + dir;
      if (j < 0 || j >= list.length) return list;
      const next = [...list];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  function removeItem(it: Item, moveTo?: string) {
    setItems((list) => list.filter((x) => x.id !== it.id));
    if (it.key) {
      setMoves((m) => {
        const next = { ...m };
        // Anything that was going to be moved into this stage now follows it.
        if (moveTo) for (const [from, to] of Object.entries(next)) if (to === it.key) next[from] = moveTo;
        if (moveTo) next[it.key!] = moveTo;
        return next;
      });
    }
  }

  function askRemove(it: Item) {
    const used = it.key ? (usage[it.key] ?? 0) : 0;
    if (used > 0) {
      const firstOther = items.find((x) => x.id !== it.id && x.key && x.category === it.category) ?? items.find((x) => x.id !== it.id && x.key);
      setTarget(firstOther?.key ?? "");
      setRemoving(it);
    } else {
      removeItem(it);
      toast.message(`“${it.label || "Stage"}” removed – save to apply`);
    }
  }

  function save() {
    run(() => savePipelineAction({ stages: items.map(({ key, label, color, category }) => ({ key, label, color, category })), moves }), {
      onSuccess: () => setMoves({}),
    });
  }

  const targets = removing ? items.filter((x) => x.id !== removing.id && x.key) : [];

  return (
    <>
      <SettingsCard
        title="Stages"
        description="Reorder with the arrows. Stage keys stay the same when you rename a stage, so contacts, automations and reports keep working."
        action={
          <Button variant="outline" onClick={() => setItems((l) => [...l, { id: `tmp_${nanoid(6)}`, key: null, label: "New stage", color: "#64748b", category: "active" }])} disabled={items.length >= 30}>
            <Plus /> Add stage
          </Button>
        }
        footer={
          <>
            {dirty && (
              <Button variant="ghost" onClick={() => (setItems(toItems(initial)), setMoves({}))} disabled={pending}>
                <RotateCcw /> Discard changes
              </Button>
            )}
            <Button onClick={save} disabled={pending || !dirty}>
              {pending && <Spinner />} Save pipeline
            </Button>
          </>
        }
      >
        <div className="flex flex-wrap gap-2 rounded-lg border bg-muted/30 p-3" aria-label="Pipeline preview">
          {items.map((it) => (
            <ColorBadge key={it.id} color={it.color}>
              {it.label || "Untitled"}
            </ColorBadge>
          ))}
        </div>

        <ul className="grid gap-2">
          {items.map((it, i) => {
            const used = it.key ? (usage[it.key] ?? 0) : 0;
            const locked = it.key === PROTECTED_KEY;
            return (
              <li key={it.id} className="flex flex-wrap items-center gap-2 rounded-lg border bg-card p-2.5 sm:flex-nowrap">
                <Popover>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      aria-label={`Color for ${it.label}`}
                      className="size-8 shrink-0 rounded-lg border ring-offset-2 ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
                      style={{ background: it.color }}
                    />
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-72">
                    <ColorField value={it.color} onChange={(c) => update(it.id, { color: c })} presets={["#64748b", "#3b82f6", "#8b5cf6", "#ec4899", "#f59e0b", "#f97316", "#10b981", "#14b8a6", "#0ea5e9", "#ef4444"]} />
                  </PopoverContent>
                </Popover>
                <div className="min-w-0 flex-1 basis-40">
                  <Input value={it.label} maxLength={40} onChange={(e) => update(it.id, { label: e.target.value })} aria-label="Stage name" placeholder="Stage name" />
                </div>
                <NativeSelect value={it.category} onChange={(e) => update(it.id, { category: e.target.value as StageCategory })} aria-label={`Category for ${it.label}`}>
                  {(Object.keys(CATEGORY_LABEL) as StageCategory[]).map((c) => (
                    <NativeSelectOption key={c} value={c}>
                      {CATEGORY_LABEL[c]}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
                <span className="hidden w-24 shrink-0 text-xs text-muted-foreground tabular-nums sm:block">{it.key ? pluralize(used, "contact") : "new"}</span>
                <div className="ml-auto flex shrink-0 items-center">
                  <Button type="button" variant="ghost" size="icon-sm" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up">
                    <ArrowUp />
                  </Button>
                  <Button type="button" variant="ghost" size="icon-sm" onClick={() => move(i, 1)} disabled={i === items.length - 1} aria-label="Move down">
                    <ArrowDown />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => askRemove(it)}
                    disabled={locked || items.length <= 1}
                    aria-label={`Delete ${it.label}`}
                    title={locked ? "Contacts start in this stage, so it can’t be deleted (you can rename it)" : undefined}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
        <Alert>
          <AlertDescription>
            <strong>Categories</strong> drive reporting: <em>Won</em> stages count towards won pipeline value, <em>Lost</em> stages are excluded from open deals. The first stage, &ldquo;New lead&rdquo;, is where new contacts start – you can rename it but not delete it.
          </AlertDescription>
        </Alert>
      </SettingsCard>

      <Dialog open={!!removing} onOpenChange={(o) => !o && setRemoving(null)}>
        <DialogContent>
          {removing && (
            <>
              <DialogHeader>
                <DialogTitle>Delete “{removing.label}”?</DialogTitle>
                <DialogDescription>
                  {pluralize(removing.key ? (usage[removing.key] ?? 0) : 0, "contact")} {(usage[removing.key ?? ""] ?? 0) === 1 ? "is" : "are"} in this stage. Choose where to move them when you save.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-2">
                <Label htmlFor="move-target">Move contacts to</Label>
                <NativeSelect id="move-target" className="w-full" value={target} onChange={(e) => setTarget(e.target.value)}>
                  {targets.map((t) => (
                    <NativeSelectOption key={t.id} value={t.key!}>
                      {t.label || "Untitled"}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setRemoving(null)}>
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  disabled={!target}
                  onClick={() => {
                    removeItem(removing, target);
                    setRemoving(null);
                    toast.message(`“${removing.label}” removed – save to apply`);
                  }}
                >
                  Delete stage
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
