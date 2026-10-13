"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { ExternalLink, Save, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { StatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { updateBookingPageAction } from "@/app/(app)/scheduling/actions";
import type { PageDraft } from "@/lib/scheduling/draft";
import { AvailabilityTab } from "./editor-availability";
import { FormTab } from "./editor-form";
import { SetupTab, type EditorCtx, type EditorUser } from "./editor-setup";
import { ShareTab } from "./editor-share";
import { NotificationsEditor, type TemplateOption } from "./notifications-editor";

const TABS = [
  { value: "setup", label: "Setup" },
  { value: "form", label: "Form & qualification" },
  { value: "availability", label: "Availability" },
  { value: "notifications", label: "Notifications" },
  { value: "share", label: "Share" },
] as const;

export function BookingPageEditor({
  pageId,
  initial,
  initialTab,
  users,
  campaigns,
  templates,
  customFields,
  origin,
  qrDataUrl,
  stats,
}: {
  pageId: string;
  initial: PageDraft;
  initialTab: string;
  users: EditorUser[];
  campaigns: { id: string; name: string }[];
  templates: TemplateOption[];
  customFields: { key: string; label: string }[];
  origin: string;
  qrDataUrl: string;
  stats: { bookings30: number; views30: number };
}) {
  const [saved, setSaved] = useState(initial);
  const [draft, setDraft] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string[] | undefined>>({});
  const [tab, setTab] = useState<string>(TABS.some((t) => t.value === initialTab) ? initialTab : "setup");
  const [pending, start] = useTransition();
  const dirty = JSON.stringify(saved) !== JSON.stringify(draft);

  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  const ctx: EditorCtx = { draft, update: (patch) => setDraft((d) => ({ ...d, ...patch })), errors };

  const save = () =>
    start(async () => {
      const res = await updateBookingPageAction(pageId, draft);
      if (res.ok) {
        // the server prunes dead rule conditions and trims values – mirror that locally
        const questionIds = new Set(draft.questions.map((q) => q.id));
        const next: PageDraft = {
          ...draft,
          disqualifyRules: draft.disqualifyRules
            .map((g) => ({ ...g, conditions: g.conditions.filter((c) => questionIds.has(c.questionId)) }))
            .filter((g) => g.conditions.length),
        };
        setDraft(next);
        setSaved(next);
        setErrors({});
        toast.success(res.message ?? "Saved");
      } else {
        setErrors(res.fieldErrors ?? {});
        toast.error(res.error);
        const key = Object.keys(res.fieldErrors ?? {})[0] ?? "";
        if (key.startsWith("questions") || key.startsWith("disqualify")) setTab("form");
        else if (/^(minNotice|maxDays|buffer|slotIncrement|dailyLimit)/.test(key)) setTab("availability");
        else if (key.startsWith("notifications")) setTab("notifications");
        else if (key) setTab("setup");
      }
    });

  return (
    <>
      <PageHeader
        back={{ href: "/scheduling", label: "Booking pages" }}
        title={
          <span className="flex items-center gap-2">
            <span className="size-3 shrink-0 rounded-full" style={{ background: draft.color }} />
            <span className="truncate">{saved.title}</span>
            <StatusBadge tone={saved.isActive ? "green" : "neutral"}>{saved.isActive ? "Live" : "Paused"}</StatusBadge>
          </span>
        }
        description={<span className="font-mono text-xs">/book/{saved.slug}</span>}
        actions={
          <>
            <Button asChild variant="outline">
              <Link href={`/book/${saved.slug}`} target="_blank">
                <ExternalLink /> Preview
              </Link>
            </Button>
            <Button onClick={save} disabled={pending || !dirty}>
              {pending ? <Spinner /> : <Save />} Save changes
            </Button>
          </>
        }
      />
      <PageBody className="pb-24">
        <Tabs value={tab} onValueChange={setTab} className="gap-5">
          <div className="-mx-1 overflow-x-auto px-1 pb-1">
            <TabsList variant="line" className="h-auto min-w-max justify-start gap-1 border-b">
              {TABS.map((t) => (
                <TabsTrigger key={t.value} value={t.value} className="flex-none px-3 py-2">
                  {t.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
          <TabsContent value="setup">
            <SetupTab ctx={ctx} users={users} campaigns={campaigns} />
          </TabsContent>
          <TabsContent value="form">
            <FormTab ctx={ctx} customFields={customFields} />
          </TabsContent>
          <TabsContent value="availability">
            <AvailabilityTab ctx={ctx} users={users} pageId={pageId} dirty={dirty} />
          </TabsContent>
          <TabsContent value="notifications">
            <div className="max-w-3xl">
              <NotificationsEditor value={draft.notifications} onChange={(notifications) => ctx.update({ notifications })} templates={templates} />
            </div>
          </TabsContent>
          <TabsContent value="share">
            <ShareTab slug={draft.slug} savedSlug={saved.slug} origin={origin} qrDataUrl={qrDataUrl} color={saved.color} isActive={saved.isActive} stats={stats} />
          </TabsContent>
        </Tabs>
      </PageBody>

      {dirty && (
        <div className="fixed inset-x-0 bottom-4 z-30 mx-auto flex w-[calc(100%-2rem)] max-w-md items-center justify-between gap-3 rounded-xl border bg-popover p-3 shadow-lg md:left-[var(--sidebar-width,0px)]">
          <span className="text-sm font-medium">Unsaved changes</span>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setDraft(saved);
                setErrors({});
              }}
              disabled={pending}
            >
              <Undo2 /> Discard
            </Button>
            <Button size="sm" onClick={save} disabled={pending}>
              {pending ? <Spinner /> : <Save />} Save
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
