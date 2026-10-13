"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Loader2, Save, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { saveCampaignAction } from "@/app/(app)/campaigns/actions";
import { COLOR_SWATCHES } from "@/lib/events/utils";
import { CAMPAIGN_TYPES } from "@/lib/campaign-meta";
import { slugify } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { CampaignStatus, CampaignType } from "@/lib/types";

export type CampaignFormValues = {
  name: string;
  description: string;
  type: CampaignType;
  status: CampaignStatus;
  startDate: string;
  endDate: string;
  goal: string;
  budget: string;
  color: string;
  utmCampaign: string;
  ownerId: string;
};

export function CampaignForm({
  campaignId,
  initial,
  users,
  currency,
}: {
  campaignId?: string;
  initial: CampaignFormValues;
  users: { id: string; name: string }[];
  currency: string;
}) {
  const router = useRouter();
  const [v, setV] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string[] | undefined>>({});
  const [pending, start] = useTransition();
  const set = <K extends keyof CampaignFormValues>(k: K, val: CampaignFormValues[K]) => setV((p) => ({ ...p, [k]: val }));
  const err = (k: string) => errors[k]?.[0];

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setErrors({});
    start(async () => {
      const res = await saveCampaignAction({
        id: campaignId,
        values: { ...v, budget: v.budget.trim() === "" ? null : Number(v.budget), ownerId: v.ownerId || null },
      });
      if (!res.ok) {
        setErrors(res.fieldErrors ?? {});
        toast.error(res.error);
        return;
      }
      toast.success(res.message ?? "Saved");
      if (!campaignId && res.data) router.push(`/campaigns/${res.data.id}`);
      else router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="grid max-w-3xl gap-5">
      <div className="grid gap-5 rounded-xl border bg-card p-5 shadow-xs">
        <div className="grid gap-1.5">
          <Label htmlFor="c-name">
            Name <span className="text-destructive">*</span>
          </Label>
          <Input id="c-name" value={v.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Spring webinar series" maxLength={120} autoFocus={!campaignId} aria-invalid={!!err("name")} />
          {err("name") && <p className="text-sm text-destructive">{err("name")}</p>}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label>Type</Label>
            <NativeSelect className="w-full" value={v.type} onChange={(e) => set("type", e.target.value as CampaignType)}>
              {CAMPAIGN_TYPES.map((t) => (
                <NativeSelectOption key={t.value} value={t.value}>
                  {t.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
          <div className="grid gap-1.5">
            <Label>Status</Label>
            <NativeSelect className="w-full" value={v.status} onChange={(e) => set("status", e.target.value as CampaignStatus)}>
              <NativeSelectOption value="planned">Planned</NativeSelectOption>
              <NativeSelectOption value="active">Active</NativeSelectOption>
              <NativeSelectOption value="completed">Completed</NativeSelectOption>
              <NativeSelectOption value="archived">Archived</NativeSelectOption>
            </NativeSelect>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="c-start">Start date</Label>
            <Input id="c-start" type="date" value={v.startDate} onChange={(e) => set("startDate", e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="c-end">End date</Label>
            <Input id="c-end" type="date" value={v.endDate} onChange={(e) => set("endDate", e.target.value)} aria-invalid={!!err("endDate")} />
            {err("endDate") && <p className="text-sm text-destructive">{err("endDate")}</p>}
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="c-budget">Budget ({currency})</Label>
            <Input id="c-budget" type="number" min={0} inputMode="numeric" value={v.budget} onChange={(e) => set("budget", e.target.value)} placeholder="Optional" aria-invalid={!!err("budget")} />
            {err("budget") ? <p className="text-sm text-destructive">{err("budget")}</p> : <p className="text-xs text-muted-foreground">Used to calculate cost per registration.</p>}
          </div>
          <div className="grid gap-1.5">
            <Label>Owner</Label>
            <NativeSelect className="w-full" value={v.ownerId} onChange={(e) => set("ownerId", e.target.value)}>
              <NativeSelectOption value="">No owner</NativeSelectOption>
              {users.map((u) => (
                <NativeSelectOption key={u.id} value={u.id}>
                  {u.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="c-goal">Goal</Label>
          <Input id="c-goal" value={v.goal} onChange={(e) => set("goal", e.target.value)} placeholder="e.g. 300 registrations and 50 demos booked" maxLength={500} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="c-utm">UTM campaign</Label>
          <div className="flex gap-2">
            <Input id="c-utm" value={v.utmCampaign} onChange={(e) => set("utmCampaign", e.target.value)} placeholder="spring-webinars" maxLength={100} />
            <Button type="button" variant="outline" onClick={() => set("utmCampaign", slugify(v.name))} disabled={!v.name.trim()}>
              <Wand2 /> From name
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Contacts who arrive with <code className="rounded bg-muted px-1">utm_campaign={v.utmCampaign || "…"}</code> are attributed to this campaign.
          </p>
        </div>
        <div className="grid gap-2">
          <Label>Color</Label>
          <div className="flex flex-wrap gap-2">
            {COLOR_SWATCHES.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => set("color", c)}
                aria-label={`Color ${c}`}
                aria-pressed={v.color === c}
                className={cn("grid size-8 place-items-center rounded-full ring-offset-2 ring-offset-background transition", v.color === c && "ring-2 ring-foreground")}
                style={{ background: c }}
              >
                {v.color === c && <Check className="size-4 text-white" />}
              </button>
            ))}
          </div>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="c-desc">Description</Label>
          <Textarea id="c-desc" rows={4} value={v.description} onChange={(e) => set("description", e.target.value)} placeholder="What is this campaign about?" />
        </div>
      </div>
      <div className="flex items-center justify-end gap-2">
        {!campaignId && (
          <Button asChild variant="ghost">
            <Link href="/campaigns">Cancel</Link>
          </Button>
        )}
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : <Save />} {campaignId ? "Save changes" : "Create campaign"}
        </Button>
      </div>
    </form>
  );
}
