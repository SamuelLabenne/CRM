"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { Building2, GripVertical, MoreHorizontal } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { UserAvatar } from "@/components/app/user-avatar";
import { changeStageAction } from "@/app/(app)/pipeline/actions";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

export type BoardCard = {
  id: string;
  name: string;
  company: string | null;
  dealValue: number | null;
  lastActivity: string;
  owner: { name: string; color: string } | null;
};

export type BoardColumn = {
  key: string;
  label: string;
  color: string;
  category: "active" | "won" | "lost" | "other";
  count: number;
  sum: number;
  cards: BoardCard[];
  /** Link to the contacts list filtered to this stage (for the "+N more" footer). */
  moreHref: string;
};

/** Kanban of contacts by stage with optimistic drag & drop (rolls back and toasts on failure). */
export function PipelineBoard({ columns: serverColumns, currency }: { columns: BoardColumn[]; currency: string }) {
  const router = useRouter();
  const [columns, setColumns] = useState(serverColumns);
  const [seen, setSeen] = useState(serverColumns);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [, start] = useTransition();

  // Adopt fresh server data (after refresh/revalidate or filter changes).
  if (seen !== serverColumns) {
    setSeen(serverColumns);
    setColumns(serverColumns);
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
    useSensor(KeyboardSensor),
  );

  const findCard = (id: string) => {
    for (const col of columns) {
      const card = col.cards.find((c) => c.id === id);
      if (card) return { card, from: col };
    }
    return null;
  };

  const move = (cardId: string, toKey: string) => {
    const found = findCard(cardId);
    const target = columns.find((c) => c.key === toKey);
    if (!found || !target || found.from.key === toKey || target.category === "other") return;
    const snapshot = columns;
    const value = found.card.dealValue ?? 0;
    setColumns(
      columns.map((col) => {
        if (col.key === found.from.key) return { ...col, count: col.count - 1, sum: col.sum - value, cards: col.cards.filter((c) => c.id !== cardId) };
        if (col.key === toKey) return { ...col, count: col.count + 1, sum: col.sum + value, cards: [{ ...found.card, lastActivity: "just now" }, ...col.cards] };
        return col;
      }),
    );
    start(async () => {
      const res = await changeStageAction(cardId, toKey);
      if (!res.ok) {
        setColumns(snapshot);
        toast.error(`Couldn't move ${found.card.name}: ${res.error}`);
        return;
      }
      toast.success(`Moved ${found.card.name} to ${target.label}`);
      router.refresh();
    });
  };

  const onDragStart = (e: DragStartEvent) => setActiveId(String(e.active.id));
  const onDragEnd = (e: DragEndEvent) => {
    setActiveId(null);
    if (e.over) move(String(e.active.id), String(e.over.id));
  };
  const active = activeId ? findCard(activeId)?.card : null;
  const moveTargets = columns.filter((c) => c.category !== "other");

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setActiveId(null)}>
      <div className="-mx-6 flex flex-1 snap-x gap-3 overflow-x-auto px-6 pb-4">
        {columns.map((col) => (
          <Column key={col.key} col={col} currency={currency} activeId={activeId} moveTargets={moveTargets} onMove={move} />
        ))}
      </div>
      <DragOverlay dropAnimation={null}>{active ? <CardBody card={active} currency={currency} overlay /> : null}</DragOverlay>
    </DndContext>
  );
}

function Column({
  col,
  currency,
  activeId,
  moveTargets,
  onMove,
}: {
  col: BoardColumn;
  currency: string;
  activeId: string | null;
  moveTargets: BoardColumn[];
  onMove: (cardId: string, toKey: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: col.key, disabled: col.category === "other" });
  const more = col.count - col.cards.length;
  return (
    <section
      ref={setNodeRef}
      aria-label={`${col.label} stage`}
      className={cn(
        "flex max-h-[calc(100vh-15rem)] min-h-64 w-72 shrink-0 snap-start flex-col rounded-xl border bg-muted/40 transition-colors sm:w-80",
        isOver && activeId && "border-primary/60 bg-accent/60",
      )}
    >
      <header className="flex items-center gap-2 px-3 pt-3 pb-2">
        <span className="size-2.5 shrink-0 rounded-full" style={{ background: col.color }} />
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">{col.label}</h2>
        <span className="rounded-full bg-background px-2 py-0.5 text-xs font-medium tabular-nums text-muted-foreground">{col.count}</span>
      </header>
      <div className="px-3 pb-2 text-xs text-muted-foreground tabular-nums">{col.sum > 0 ? formatMoney(col.sum, currency) : "No deal value"}</div>
      <div className="flex flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
        {col.cards.map((card) => (
          <DraggableCard key={card.id} card={card} currency={currency} column={col} moveTargets={moveTargets} onMove={onMove} />
        ))}
        {col.cards.length === 0 && (
          <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
            {col.category === "other" ? "Contacts with an unknown stage" : "Drop contacts here"}
          </div>
        )}
        {more > 0 && (
          <Link href={col.moreHref} className="rounded-lg px-2 py-2 text-center text-xs font-medium text-primary hover:bg-background">
            +{more} more – view in contacts
          </Link>
        )}
      </div>
    </section>
  );
}

function DraggableCard({
  card,
  currency,
  column,
  moveTargets,
  onMove,
}: {
  card: BoardCard;
  currency: string;
  column: BoardColumn;
  moveTargets: BoardColumn[];
  onMove: (cardId: string, toKey: string) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: card.id });
  return (
    <div ref={setNodeRef} {...attributes} {...listeners} className={cn("touch-manipulation", isDragging && "opacity-40")}>
      <CardBody
        card={card}
        currency={currency}
        menu={
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={`Move ${card.name}`}
                onPointerDown={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
              >
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Move to stage</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {moveTargets
                .filter((t) => t.key !== column.key)
                .map((t) => (
                  <DropdownMenuItem key={t.key} onSelect={() => onMove(card.id, t.key)}>
                    <span className="size-2 rounded-full" style={{ background: t.color }} />
                    {t.label}
                  </DropdownMenuItem>
                ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link href={`/contacts/${card.id}`}>Open contact</Link>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        }
      />
    </div>
  );
}

function CardBody({ card, currency, menu, overlay }: { card: BoardCard; currency: string; menu?: React.ReactNode; overlay?: boolean }) {
  return (
    <div className={cn("group/card rounded-lg border bg-card p-3 text-sm shadow-xs", overlay ? "rotate-1 cursor-grabbing shadow-lg ring-2 ring-primary/40" : "cursor-grab hover:border-foreground/20")}>
      <div className="flex items-start gap-1.5">
        <GripVertical className="mt-0.5 size-3.5 shrink-0 text-muted-foreground/40" />
        <div className="min-w-0 flex-1">
          <Link href={`/contacts/${card.id}`} className="block truncate font-medium hover:underline" draggable={false}>
            {card.name}
          </Link>
          {card.company && (
            <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-muted-foreground">
              <Building2 className="size-3 shrink-0" /> <span className="truncate">{card.company}</span>
            </p>
          )}
        </div>
        {menu}
      </div>
      <div className="mt-2.5 flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="font-medium tabular-nums text-foreground">{card.dealValue != null ? formatMoney(card.dealValue, currency) : ""}</span>
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate">{card.lastActivity}</span>
          {card.owner && <UserAvatar name={card.owner.name} color={card.owner.color} className="size-5 rounded-md text-[9px]" />}
        </span>
      </div>
    </div>
  );
}
