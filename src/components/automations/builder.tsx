"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { nanoid } from "nanoid";
import { toast } from "sonner";
import { Check, ChevronDown, Flag, Info, Plus, RefreshCw, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { AUTOMATION_STATUS, StatusBadge } from "@/components/app/status-badge";
import { saveAutomationAction } from "@/app/(app)/automations/actions";
import {
  STEP_META,
  describeStep,
  newStep,
  toNameLookups,
  validateAutomation,
  type BuilderLookups,
  type StepType,
} from "@/lib/automations/meta";
import type { AutomationStatus, AutomationStep, AutomationTrigger } from "@/lib/types";
import { cn } from "@/lib/utils";
import { STEP_ICONS, STEP_TONE } from "./icons";
import { Connector, SortableStep } from "./step-card";
import { StepEditor } from "./step-editor";
import { StepPicker } from "./step-picker";
import { TriggerCard } from "./trigger-card";

export type BuilderAutomation = {
  id: string;
  name: string;
  description: string | null;
  status: AutomationStatus;
  trigger: AutomationTrigger;
  steps: AutomationStep[];
  allowReentry: boolean;
};

type Draft = Omit<BuilderAutomation, "id">;

const STATUS_HELP: Record<AutomationStatus, string> = {
  draft: "Not running. Build and test freely.",
  active: "Live: contacts who match the trigger are enrolled.",
  paused: "No new contacts are enrolled and running contacts wait.",
};

const snapshot = (d: Draft) =>
  JSON.stringify({ name: d.name.trim(), description: (d.description ?? "").trim(), status: d.status, trigger: d.trigger, steps: d.steps, allowReentry: d.allowReentry });

export function AutomationBuilder({
  automation,
  lookups,
  inFlightRuns,
}: {
  automation: BuilderAutomation;
  lookups: BuilderLookups;
  inFlightRuns: number;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(() => {
    const { id: _id, ...rest } = automation;
    return rest;
  });
  const [saved, setSaved] = useState(() => snapshot(draft));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showIssues, setShowIssues] = useState(false);
  const [pending, start] = useTransition();

  const dirty = snapshot(draft) !== saved;
  const names = useMemo(() => toNameLookups(lookups), [lookups]);
  const issues = useMemo(() => validateAutomation(draft), [draft]);
  const stepIssues = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const i of issues) if (i.stepId) map.set(i.stepId, [...(map.get(i.stepId) ?? []), i.message]);
    return map;
  }, [issues]);
  const generalIssues = issues.filter((i) => !i.stepId);

  // Warn before leaving with unsaved changes.
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const patch = (p: Partial<Draft>) => setDraft((d) => ({ ...d, ...p }));
  const setSteps = (steps: AutomationStep[]) => patch({ steps });

  const insertStep = (index: number, type: StepType) => {
    const step = newStep(type);
    const next = [...draft.steps];
    next.splice(index, 0, step);
    setSteps(next);
    setEditingId(step.id);
  };

  const updateStep = (next: AutomationStep) => setSteps(draft.steps.map((s) => (s.id === next.id ? next : s)));

  const deleteStep = (id: string) => {
    const index = draft.steps.findIndex((s) => s.id === id);
    if (index < 0) return;
    const removed = draft.steps[index];
    setSteps(draft.steps.filter((s) => s.id !== id));
    if (editingId === id) setEditingId(null);
    toast("Step removed", {
      action: {
        label: "Undo",
        onClick: () =>
          setDraft((d) => {
            const copy = [...d.steps];
            copy.splice(Math.min(index, copy.length), 0, removed);
            return { ...d, steps: copy };
          }),
      },
    });
  };

  const duplicateStep = (id: string) => {
    const index = draft.steps.findIndex((s) => s.id === id);
    if (index < 0) return;
    const copy = { ...structuredClone(draft.steps[index]), id: nanoid(8) } as AutomationStep;
    const next = [...draft.steps];
    next.splice(index + 1, 0, copy);
    setSteps(next);
  };

  const moveStep = (id: string, dir: -1 | 1) => {
    const from = draft.steps.findIndex((s) => s.id === id);
    const to = from + dir;
    if (from < 0 || to < 0 || to >= draft.steps.length) return;
    setSteps(arrayMove(draft.steps, from, to));
  };

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = draft.steps.findIndex((s) => s.id === active.id);
    const to = draft.steps.findIndex((s) => s.id === over.id);
    if (from >= 0 && to >= 0) setSteps(arrayMove(draft.steps, from, to));
  };

  const save = (status: AutomationStatus = draft.status) => {
    start(async () => {
      const res = await saveAutomationAction({ id: automation.id, ...draft, status });
      if (!res.ok) {
        toast.error(res.error);
        setShowIssues(true);
        return;
      }
      const next = { ...draft, status: res.data?.status ?? status };
      setDraft(next);
      setSaved(snapshot(next));
      setShowIssues(false);
      toast.success(res.message ?? "Saved");
      router.refresh();
    });
  };

  const changeStatus = (status: AutomationStatus) => {
    if (status === draft.status) return;
    if (status === "active" && issues.length) {
      setShowIssues(true);
      toast.error("Fix these before activating", { description: issues[0].message });
      return;
    }
    save(status);
  };

  const editing = draft.steps.find((s) => s.id === editingId) ?? null;

  return (
    <div className="flex flex-col gap-6">
      {/* Toolbar */}
      <div className="sticky top-14 z-10 -mx-6 -mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 border-b bg-background/90 px-6 py-2.5 backdrop-blur supports-[backdrop-filter]:bg-background/75">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" aria-label="Change status">
              <StatusBadge tone={AUTOMATION_STATUS[draft.status].tone} className="bg-transparent p-0">
                {AUTOMATION_STATUS[draft.status].label}
              </StatusBadge>
              <ChevronDown />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-64">
            <DropdownMenuRadioGroup value={draft.status} onValueChange={(v) => changeStatus(v as AutomationStatus)}>
              {(["draft", "active", "paused"] as const).map((s) => (
                <DropdownMenuRadioItem key={s} value={s} className="flex-col items-start gap-0">
                  <span className="font-medium">{AUTOMATION_STATUS[s].label}</span>
                  <span className="text-xs text-muted-foreground">{STATUS_HELP[s]}</span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        <label className="flex items-center gap-2 text-sm">
          <Switch size="sm" checked={draft.allowReentry} onCheckedChange={(v) => patch({ allowReentry: v })} />
          <span>Allow re-entry</span>
        </label>
        <p className="hidden text-xs text-muted-foreground xl:block">
          {draft.allowReentry
            ? "A contact can enter again, e.g. for every event they register for."
            : "Each contact goes through this automation only once."}
        </p>

        <div className="ml-auto flex items-center gap-3">
          {dirty ? (
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="size-1.5 rounded-full bg-amber-500" /> Unsaved changes
            </span>
          ) : (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Check className="size-3.5" /> Saved
            </span>
          )}
          <Button size="sm" onClick={() => save()} disabled={pending || !dirty}>
            {pending ? <Spinner /> : <Save />} Save
          </Button>
        </div>
      </div>

      {inFlightRuns > 0 && (
        <Alert className="mx-auto w-full max-w-2xl">
          <Info />
          <AlertDescription>
            {inFlightRuns} contact{inFlightRuns === 1 ? " is" : "s are"} currently inside this automation. Changes to the steps apply to them from
            where they are – reordering or removing steps can make them skip or repeat steps.
          </AlertDescription>
        </Alert>
      )}

      <div className="mx-auto flex w-full max-w-2xl flex-col">
        {/* Details */}
        <Card className="gap-3 p-4">
          <div className="grid gap-1.5">
            <Label htmlFor="automation-name">Name</Label>
            <Input
              id="automation-name"
              value={draft.name}
              maxLength={120}
              aria-invalid={showIssues && !draft.name.trim() ? true : undefined}
              onChange={(e) => patch({ name: e.target.value })}
              placeholder="e.g. Webinar reminders"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="automation-description">Description (optional)</Label>
            <Textarea
              id="automation-description"
              rows={2}
              maxLength={500}
              value={draft.description ?? ""}
              onChange={(e) => patch({ description: e.target.value })}
              placeholder="What does this automation do, and why?"
            />
          </div>
        </Card>

        <div className="mx-auto h-5 w-px bg-border" />

        <TriggerCard trigger={draft.trigger} onChange={(trigger) => patch({ trigger })} lookups={lookups} />

        {/* Steps */}
        {draft.steps.length === 0 ? (
          <>
            <div className="mx-auto h-5 w-px bg-border" />
            <StepPicker onPick={(t) => insertStep(0, t)}>
              <button
                type="button"
                className="flex flex-col items-center gap-1 rounded-xl border border-dashed bg-card/50 px-4 py-8 text-sm text-muted-foreground transition-colors hover:border-primary hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                <span className="flex size-9 items-center justify-center rounded-full border bg-card">
                  <Plus className="size-4" />
                </span>
                <span className="font-medium text-foreground">Add your first step</span>
                <span>Send an email, wait, check a condition, tag the contact…</span>
              </button>
            </StepPicker>
          </>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={draft.steps.map((s) => s.id)} strategy={verticalListSortingStrategy}>
              {draft.steps.map((step, index) => (
                <SortableStep
                  key={step.id}
                  step={step}
                  index={index}
                  total={draft.steps.length}
                  summary={describeStep(step, names)}
                  issues={stepIssues.get(step.id) ?? []}
                  active={step.id === editingId}
                  onEdit={() => setEditingId(step.id)}
                  onDelete={() => deleteStep(step.id)}
                  onDuplicate={() => duplicateStep(step.id)}
                  onMove={(dir) => moveStep(step.id, dir)}
                  onInsertBefore={(type) => insertStep(index, type)}
                />
              ))}
            </SortableContext>
          </DndContext>
        )}

        {draft.steps.length > 0 && <Connector onInsert={(t) => insertStep(draft.steps.length, t)} />}
        {draft.steps.length > 0 && (
          <div className="mx-auto flex items-center gap-1.5 rounded-full border bg-card px-3 py-1 text-xs text-muted-foreground">
            <Flag className="size-3" /> End of automation
          </div>
        )}

        {showIssues && generalIssues.length > 0 && (
          <Alert variant="destructive" className="mt-6">
            <AlertDescription>{generalIssues.map((i) => i.message).join(" · ")}</AlertDescription>
          </Alert>
        )}
      </div>

      {/* Step editor */}
      <Sheet open={Boolean(editing)} onOpenChange={(open) => !open && setEditingId(null)}>
        <SheetContent className="w-full gap-0 sm:max-w-md">
          {editing && (
            <>
              <SheetHeader className="border-b pr-12">
                <div className="flex items-center gap-3">
                  <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg", STEP_TONE[editing.type])}>
                    {(() => {
                      const Icon = STEP_ICONS[editing.type];
                      return <Icon className="size-4.5" />;
                    })()}
                  </span>
                  <div className="min-w-0">
                    <SheetTitle>{STEP_META[editing.type].label}</SheetTitle>
                    <SheetDescription>{STEP_META[editing.type].description}</SheetDescription>
                  </div>
                </div>
              </SheetHeader>
              <div className="flex-1 overflow-y-auto p-4">
                <StepEditor
                  key={editing.id}
                  step={editing}
                  onChange={updateStep}
                  lookups={lookups}
                  trigger={draft.trigger}
                  issues={showIssues ? (stepIssues.get(editing.id) ?? []) : []}
                />
              </div>
              <SheetFooter className="flex-row justify-between border-t">
                <Button variant="ghost" className="text-destructive hover:text-destructive" onClick={() => deleteStep(editing.id)}>
                  <Trash2 /> Delete step
                </Button>
                <Button onClick={() => setEditingId(null)}>Done</Button>
              </SheetFooter>
            </>
          )}
        </SheetContent>
      </Sheet>

      <p className="mx-auto flex items-center gap-1.5 text-xs text-muted-foreground">
        <RefreshCw className="size-3" /> Changes are saved when you press Save. Activating saves automatically.
      </p>
    </div>
  );
}
