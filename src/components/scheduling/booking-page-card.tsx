"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CalendarClock, Copy, ExternalLink, MoreHorizontal, Pencil, Share2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { StatusBadge } from "@/components/app/status-badge";
import { UserAvatar } from "@/components/app/user-avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { deleteBookingPageAction, duplicateBookingPageAction, setPageActiveAction } from "@/app/(app)/scheduling/actions";
import { durationLabel, locationLabel } from "@/lib/scheduling/defaults";
import { formatPercent } from "@/lib/format";
import type { LocationType } from "@/lib/types";
import { CopyButton } from "./copy-button";

export type PageCardData = {
  id: string;
  slug: string;
  title: string;
  color: string;
  durationMinutes: number;
  locationType: LocationType;
  isActive: boolean;
  hosts: { id: string; name: string; color: string }[];
  bookings30: number;
  views30: number;
  questionCount: number;
};

export function BookingPageCard({ page }: { page: PageCardData }) {
  const router = useRouter();
  const [active, setActive] = useState(page.isActive);
  const [pending, start] = useTransition();
  const conversion = page.views30 ? page.bookings30 / page.views30 : null;

  const toggle = (next: boolean) => {
    setActive(next);
    start(async () => {
      const res = await setPageActiveAction(page.id, next);
      if (res.ok) toast.success(res.message ?? "Updated");
      else {
        setActive(!next);
        toast.error(res.error);
      }
    });
  };

  return (
    <Card className="gap-0 overflow-hidden p-0">
      <div className="h-1.5" style={{ background: page.color }} />
      <div className="flex flex-1 flex-col gap-4 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <Link href={`/scheduling/${page.id}`} className="block truncate text-base font-semibold hover:underline">
              {page.title}
            </Link>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {durationLabel(page.durationMinutes)} · {locationLabel(page.locationType)}
            </p>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="More actions">
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild>
                <Link href={`/scheduling/${page.id}`}>
                  <Pencil /> Edit
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href={`/scheduling/${page.id}?tab=share`}>
                  <Share2 /> Share & embed
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <a href={`/book/${page.slug}`} target="_blank" rel="noreferrer">
                  <ExternalLink /> Open public page
                </a>
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() =>
                  start(async () => {
                    const res = await duplicateBookingPageAction(page.id);
                    if (res.ok) {
                      toast.success(res.message ?? "Duplicated");
                      router.push(`/scheduling/${res.data!.id}`);
                    } else toast.error(res.error);
                  })
                }
              >
                <Copy /> Duplicate
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <ConfirmDialog
                destructive
                title={`Delete “${page.title}”?`}
                description="The public link stops working. Meetings already booked are kept."
                confirmLabel="Delete page"
                trigger={
                  <DropdownMenuItem variant="destructive" onSelect={(e) => e.preventDefault()}>
                    <Trash2 /> Delete
                  </DropdownMenuItem>
                }
                onConfirm={async () => {
                  const res = await deleteBookingPageAction(page.id);
                  if (res.ok) {
                    toast.success(res.message ?? "Deleted");
                    router.refresh();
                  } else toast.error(res.error);
                }}
              />
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center">
            {page.hosts.length ? (
              <div className="flex -space-x-2">
                {page.hosts.slice(0, 4).map((h) => (
                  <UserAvatar key={h.id} name={h.name} color={h.color} className="size-7 rounded-full ring-2 ring-card" />
                ))}
                {page.hosts.length > 4 && (
                  <span className="grid size-7 place-items-center rounded-full bg-muted text-xs font-medium ring-2 ring-card">+{page.hosts.length - 4}</span>
                )}
              </div>
            ) : (
              <span className="text-xs text-destructive">No hosts</span>
            )}
          </div>
          <StatusBadge tone={active ? "green" : "neutral"}>{active ? "Live" : "Paused"}</StatusBadge>
        </div>

        <dl className="grid grid-cols-3 gap-2 rounded-lg bg-muted/50 p-3 text-center">
          <div>
            <dt className="text-[11px] text-muted-foreground">Bookings (30d)</dt>
            <dd className="text-lg font-semibold tabular-nums">{page.bookings30}</dd>
          </div>
          <div>
            <dt className="text-[11px] text-muted-foreground">Visitors (30d)</dt>
            <dd className="text-lg font-semibold tabular-nums">{page.views30}</dd>
          </div>
          <div>
            <dt className="text-[11px] text-muted-foreground">Conversion</dt>
            <dd className="text-lg font-semibold tabular-nums">{conversion == null ? "–" : formatPercent(Math.min(conversion, 1))}</dd>
          </div>
        </dl>

        <div className="mt-auto flex items-center justify-between gap-2 border-t pt-3">
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <Switch checked={active} onCheckedChange={toggle} disabled={pending} aria-label={active ? "Pause booking page" : "Activate booking page"} />
            {active ? "Active" : "Paused"}
          </label>
          <div className="flex items-center gap-1.5">
            <CopyButton path={`/book/${page.slug}`} label="Copy link" successMessage="Booking link copied" size="sm" />
            <Button asChild size="sm">
              <Link href={`/scheduling/${page.id}`}>
                <CalendarClock /> Edit
              </Link>
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}
