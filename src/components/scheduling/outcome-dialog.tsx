"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { logOutcomeAction } from "@/app/(app)/meetings/actions";
import { MEETING_OBJECTIONS, type MeetingOutcome } from "@/lib/types";
import { cn } from "@/lib/utils";

type Loggable = Exclude<MeetingOutcome, "cancelled">;

const OUTCOMES: { value: Loggable; label: string; hint: string; tone: string }[] = [
  { value: "won", label: "Won", hint: "They said yes", tone: "data-[on=true]:border-emerald-500 data-[on=true]:bg-emerald-500/10" },
  { value: "lost", label: "Lost", hint: "They said no", tone: "data-[on=true]:border-red-500 data-[on=true]:bg-red-500/10" },
  { value: "follow_up", label: "Follow-up", hint: "Needs another touch", tone: "data-[on=true]:border-amber-500 data-[on=true]:bg-amber-500/10" },
  { value: "not_qualified", label: "Not qualified", hint: "Not a fit", tone: "data-[on=true]:border-slate-500 data-[on=true]:bg-slate-500/10" },
  { value: "no_show", label: "No-show", hint: "They did not join", tone: "data-[on=true]:border-red-500 data-[on=true]:bg-red-500/10" },
];

const OBJECTION_LABEL: Record<string, string> = {
  money: "Money",
  timing: "Timing",
  partner: "Needs to ask partner",
  fear: "Fear / trust",
  smoke_screen: "Smoke screen",
  no_objection: "No objection",
};

export type OutcomeTarget = {
  attendeeId: string;
  contactName: string;
  title: string;
  outcome: MeetingOutcome | null;
  objection: string | null;
  notes: string | null;
  dealValue: number | null;
};

function defaultDue() {
  const d = new Date(Date.now() + 2 * 86_400_000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function OutcomeDialog({ target, open, onOpenChange, onSaved }: { target: OutcomeTarget; open: boolean; onOpenChange: (o: boolean) => void; onSaved?: () => void }) {
  const [outcome, setOutcome] = useState<Loggable | null>(target.outcome && target.outcome !== "cancelled" ? target.outcome : null);
  const [objection, setObjection] = useState(target.objection ?? "");
  const [notes, setNotes] = useState(target.notes ?? "");
  const [deal, setDeal] = useState(target.dealValue != null ? String(target.dealValue) : "");
  const [createTask, setCreateTask] = useState(true);
  const [taskTitle, setTaskTitle] = useState(`Follow up with ${target.contactName}`);
  const [due, setDue] = useState(defaultDue);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const showDeal = outcome === "won" || outcome === "follow_up";
  const showObjection = outcome === "lost" || outcome === "follow_up" || outcome === "not_qualified";

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!outcome) {
      setError("Choose an outcome");
      return;
    }
    setError(null);
    start(async () => {
      const res = await logOutcomeAction({
        attendeeId: target.attendeeId,
        outcome,
        objection: showObjection && objection ? (objection as (typeof MEETING_OBJECTIONS)[number]) : null,
        notes,
        dealValue: showDeal && deal !== "" ? Math.round(Number(deal)) : null,
        followUp: outcome === "follow_up" && createTask ? { title: taskTitle, dueDate: due || null } : null,
      });
      if (res.ok) {
        toast.success(outcome === "follow_up" && createTask ? "Outcome saved and follow-up task created" : "Outcome saved");
        onOpenChange(false);
        onSaved?.();
      } else {
        setError(res.error);
        toast.error(res.error);
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Log outcome</DialogTitle>
          <DialogDescription>
            {target.contactName} · {target.title}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Outcome">
            {OUTCOMES.map((o) => (
              <button
                key={o.value}
                type="button"
                role="radio"
                aria-checked={outcome === o.value}
                data-on={outcome === o.value}
                onClick={() => setOutcome(o.value)}
                className={cn("rounded-lg border px-3 py-2 text-left transition-colors hover:bg-muted/60", o.tone)}
              >
                <div className="text-sm font-medium">{o.label}</div>
                <div className="text-xs text-muted-foreground">{o.hint}</div>
              </button>
            ))}
          </div>

          {showObjection && (
            <div className="grid gap-2">
              <Label htmlFor="oc-obj">Main objection</Label>
              <NativeSelect id="oc-obj" className="w-full" value={objection} onChange={(e) => setObjection(e.target.value)}>
                <NativeSelectOption value="">None recorded</NativeSelectOption>
                {MEETING_OBJECTIONS.map((o) => (
                  <NativeSelectOption key={o} value={o}>
                    {OBJECTION_LABEL[o]}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
          )}
          {showDeal && (
            <div className="grid gap-2">
              <Label htmlFor="oc-deal">{outcome === "won" ? "Deal value" : "Potential deal value"}</Label>
              <Input id="oc-deal" type="number" min={0} inputMode="numeric" placeholder="0" value={deal} onChange={(e) => setDeal(e.target.value)} />
            </div>
          )}
          <div className="grid gap-2">
            <Label htmlFor="oc-notes">Notes</Label>
            <Textarea id="oc-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What happened on the call?" />
          </div>
          {outcome === "follow_up" && (
            <div className="grid gap-3 rounded-lg border bg-muted/40 p-3">
              <label className="flex items-center gap-2 text-sm font-medium">
                <Checkbox checked={createTask} onCheckedChange={(v) => setCreateTask(v === true)} /> Create a follow-up task
              </label>
              {createTask && (
                <div className="grid gap-3 sm:grid-cols-[1fr_9.5rem]">
                  <Input aria-label="Task title" value={taskTitle} onChange={(e) => setTaskTitle(e.target.value)} />
                  <Input aria-label="Due date" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
                </div>
              )}
            </div>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || !outcome}>
              {pending && <Spinner />} Save outcome
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
