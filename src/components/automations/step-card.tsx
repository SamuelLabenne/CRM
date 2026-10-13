"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ArrowDown, ArrowUp, Copy, Ellipsis, GripVertical, Pencil, Plus, Trash2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { STEP_META, type StepType } from "@/lib/automations/meta";
import type { AutomationStep } from "@/lib/types";
import { cn } from "@/lib/utils";
import { STEP_ICONS, STEP_TONE } from "./icons";
import { StepPicker } from "./step-picker";

/** Vertical line with a "+" button in the middle; picking a step type inserts it here. */
export function Connector({ onInsert, className }: { onInsert: (type: StepType) => void; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center", className)} aria-hidden={false}>
      <div className="h-4 w-px bg-border" />
      <StepPicker onPick={onInsert}>
        <button
          type="button"
          aria-label="Add a step here"
          className="flex size-7 items-center justify-center rounded-full border bg-card text-muted-foreground shadow-xs transition-colors hover:border-primary hover:bg-primary hover:text-primary-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <Plus className="size-4" />
        </button>
      </StepPicker>
      <div className="h-4 w-px bg-border" />
    </div>
  );
}

export function SortableStep({
  step,
  index,
  total,
  summary,
  issues,
  active,
  onEdit,
  onDelete,
  onDuplicate,
  onMove,
  onInsertBefore,
}: {
  step: AutomationStep;
  index: number;
  total: number;
  summary: string;
  issues: string[];
  active: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onMove: (dir: -1 | 1) => void;
  onInsertBefore: (type: StepType) => void;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: step.id });
  const Icon = STEP_ICONS[step.type];
  return (
    <div
      ref={setNodeRef}
      style={{
        transform: transform ? CSS.Translate.toString({ x: 0, y: transform.y, scaleX: 1, scaleY: 1 }) : undefined,
        transition,
      }}
      className={cn("relative", isDragging && "z-20")}
    >
      <Connector onInsert={onInsertBefore} />
      <Card
        className={cn(
          "flex-row items-center gap-2 p-2.5 pr-1.5 transition-shadow",
          active && "ring-2 ring-primary/40",
          issues.length > 0 && !active && "ring-1 ring-destructive/30",
          isDragging && "shadow-lg",
        )}
      >
        <button
          type="button"
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          aria-label={`Drag to reorder step ${index + 1}`}
          className="flex size-7 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-muted-foreground hover:bg-muted active:cursor-grabbing"
        >
          <GripVertical className="size-4" />
        </button>
        <button type="button" onClick={onEdit} className="flex min-w-0 flex-1 items-center gap-3 rounded-md py-0.5 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
          <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg", STEP_TONE[step.type])}>
            <Icon className="size-4.5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-xs text-muted-foreground">
              Step {index + 1} · {STEP_META[step.type].label}
            </span>
            <span className="line-clamp-2 text-sm font-medium break-words">{summary}</span>
            {issues.length > 0 && (
              <span className="mt-0.5 flex items-center gap-1 text-xs text-destructive">
                <TriangleAlert className="size-3 shrink-0" /> {issues[0]}
              </span>
            )}
          </span>
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={`Actions for step ${index + 1}`}>
              <Ellipsis />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={onEdit}>
              <Pencil /> Edit
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onDuplicate}>
              <Copy /> Duplicate
            </DropdownMenuItem>
            <DropdownMenuItem disabled={index === 0} onSelect={() => onMove(-1)}>
              <ArrowUp /> Move up
            </DropdownMenuItem>
            <DropdownMenuItem disabled={index === total - 1} onSelect={() => onMove(1)}>
              <ArrowDown /> Move down
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={onDelete}>
              <Trash2 /> Delete step
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </Card>
    </div>
  );
}
