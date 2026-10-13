"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Copy, Lock, MoreHorizontal, RotateCcw, Save, Send, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Spinner } from "@/components/ui/spinner";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { ControlledConfirm } from "@/components/email/controlled-confirm";
import { EmailComposer, type ComposerValue } from "@/components/email/email-composer";
import type { EmailBranding } from "@/components/email/types";
import { EMAIL_STARTERS } from "@/lib/email/starters";
import { cn } from "@/lib/utils";
import { deleteTemplateAction, duplicateTemplateAction, resetTemplateAction, saveTemplateAction } from "../actions";

type Category = "marketing" | "notification" | "follow_up" | "other";

export type TemplateFormTemplate = {
  id: string;
  name: string;
  subject: string;
  preheader: string;
  category: Category;
  contentJson: Record<string, unknown> | null;
  contentHtml: string;
  systemKey: string | null;
};

const CATEGORIES: { value: Category; label: string }[] = [
  { value: "marketing", label: "Marketing" },
  { value: "notification", label: "Notification" },
  { value: "follow_up", label: "Follow-up" },
  { value: "other", label: "Other" },
];

export function TemplateForm({
  template,
  branding,
  systemInfo,
  usage,
}: {
  template: TemplateFormTemplate | null;
  branding: EmailBranding;
  systemInfo?: string | null;
  usage?: string | null;
}) {
  const router = useRouter();
  const isNew = !template;
  const isSystem = Boolean(template?.systemKey);
  const [name, setName] = useState(template?.name ?? "");
  const [category, setCategory] = useState<Category>(template?.category ?? "marketing");
  const [content, setContent] = useState<ComposerValue>({
    subject: template?.subject ?? "",
    preheader: template?.preheader ?? "",
    json: template?.contentJson ?? null,
    html: template?.contentHtml ?? "",
  });
  const fingerprint = (n: string, c: Category, v: ComposerValue) => JSON.stringify([n, c, v.subject, v.preheader, v.html]);
  const [savedFp, setSavedFp] = useState(() => fingerprint(name, category, content));
  const dirty = fingerprint(name, category, content) !== savedFp;
  const [nameError, setNameError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"reset" | "delete" | null>(null);
  const [saving, startSave] = useTransition();
  const [busy, startBusy] = useTransition();

  // Warn before losing unsaved work.
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  const save = () => {
    if (!name.trim()) {
      setNameError("Give the template a name.");
      toast.error("Give the template a name.");
      return;
    }
    setNameError(null);
    startSave(async () => {
      const res = await saveTemplateAction({
        id: template?.id,
        name,
        category,
        subject: content.subject,
        preheader: content.preheader || null,
        contentJson: content.json,
        contentHtml: content.html,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(res.message ?? "Saved");
      setSavedFp(fingerprint(name, category, content));
      if (isNew) router.replace(`/emails/templates/${res.data!.id}`);
      else router.refresh();
    });
  };

  const duplicate = () =>
    startBusy(async () => {
      const res = await duplicateTemplateAction(template!.id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Template duplicated");
      router.push(`/emails/templates/${res.data!.id}`);
    });

  const startFrom = (id: string) => {
    const s = EMAIL_STARTERS.find((x) => x.id === id);
    if (!s) return;
    setContent({ subject: s.subject, preheader: s.preheader, json: null, html: s.html });
    if (!name.trim()) setName(s.name);
  };

  const showStarters = isNew && !content.html.trim();

  return (
    <>
      <PageHeader
        back={{ href: "/emails?tab=templates", label: "Templates" }}
        title={
          <span className="flex items-center gap-2">
            {isNew ? "New template" : name || "Untitled template"}
            {isSystem && <Lock className="size-4 text-muted-foreground" aria-label="Built-in template" />}
          </span>
        }
        description={isSystem ? (systemInfo ?? "Built-in email") : dirty ? "Unsaved changes" : isNew ? "Design a reusable email" : "All changes saved"}
        actions={
          <>
            {!isNew && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon" aria-label="More actions">
                    {busy ? <Spinner /> : <MoreHorizontal />}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52">
                  <DropdownMenuItem asChild>
                    <Link href={`/emails/broadcasts/new?template=${template!.id}`}>
                      <Send /> Use in a broadcast
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={duplicate}>
                    <Copy /> Duplicate
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  {isSystem ? (
                    <DropdownMenuItem onSelect={() => setConfirm("reset")}>
                      <RotateCcw /> Reset to default
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem variant="destructive" onSelect={() => setConfirm("delete")}>
                      <Trash2 /> Delete
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            <Button onClick={save} disabled={saving || (!isNew && !dirty)}>
              {saving ? <Spinner /> : <Save />} {isNew ? "Create template" : "Save changes"}
            </Button>
          </>
        }
      />
      <PageBody>
        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
            <CardDescription>
              {isSystem
                ? "Built-in emails keep their name and category. Edit the wording below, or reset to the original text."
                : "Name your template so it's easy to find when composing."}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <div className="grid gap-1.5">
              <Label htmlFor="tpl-name">Template name</Label>
              <Input
                id="tpl-name"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setNameError(null);
                }}
                disabled={isSystem}
                placeholder="e.g. Monthly newsletter"
                maxLength={120}
                aria-invalid={Boolean(nameError)}
                autoFocus={isNew}
              />
              {nameError && <p className="text-xs text-destructive">{nameError}</p>}
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="tpl-category">Category</Label>
              <NativeSelect id="tpl-category" value={category} onChange={(e) => setCategory(e.target.value as Category)} disabled={isSystem} className="w-full">
                {CATEGORIES.map((c) => (
                  <NativeSelectOption key={c.value} value={c.value}>
                    {c.label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
            {usage && (
              <p className="text-sm text-muted-foreground sm:col-span-2">
                Currently used by <span className="font-medium text-foreground">{usage}</span>. Changes apply to future sends.
              </p>
            )}
          </CardContent>
        </Card>

        {showStarters && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="size-4 text-primary" /> Start from a layout
              </CardTitle>
              <CardDescription>Pick a starting point, or just start writing below.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {EMAIL_STARTERS.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => startFrom(s.id)}
                  className={cn("rounded-lg border bg-background p-3 text-left transition-colors hover:border-primary/50 hover:bg-accent/50 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none")}
                >
                  <div className="text-sm font-medium">{s.name}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">{s.description}</div>
                </button>
              ))}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Email content</CardTitle>
            <CardDescription>Use merge tags like {"{{contact.first_name}}"} to personalise each email.</CardDescription>
          </CardHeader>
          <CardContent>
            <EmailComposer value={content} onChange={setContent} branding={branding} marketing={category === "marketing"} />
          </CardContent>
        </Card>
      </PageBody>

      <ControlledConfirm
        open={confirm === "reset"}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Reset to the default email?"
        description="Your edits to this built-in email's subject, preview text and body will be replaced with the original wording."
        confirmLabel="Reset to default"
        destructive
        onConfirm={async () => {
          const res = await resetTemplateAction(template!.id);
          if (!res.ok) {
        toast.error(res.error);
        return;
      }
          const d = res.data!;
          const next: ComposerValue = { subject: d.subject, preheader: d.preheader, json: null, html: d.html };
          setContent(next);
          setSavedFp(fingerprint(name, category, next));
          toast.success("Template reset to default");
          router.refresh();
        }}
      />
      <ControlledConfirm
        open={confirm === "delete"}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Delete this template?"
        description={
          <>
            “{name}” will be permanently deleted.
            {usage ? ` It is currently used by ${usage}; those will fall back to their default email.` : ""}
          </>
        }
        confirmLabel="Delete template"
        destructive
        onConfirm={async () => {
          const res = await deleteTemplateAction(template!.id);
          if (!res.ok) {
        toast.error(res.error);
        return;
      }
          toast.success("Template deleted");
          setSavedFp(fingerprint(name, category, content));
          router.push("/emails?tab=templates");
        }}
      />
    </>
  );
}
