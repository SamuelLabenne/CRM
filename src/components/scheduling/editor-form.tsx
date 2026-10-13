"use client";

import { Info } from "lucide-react";
import { QuestionBuilder } from "@/components/forms/question-builder";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, FieldError, type EditorCtx } from "./editor-setup";
import { RuleBuilder } from "./rule-builder";

export function FormTab({ ctx, customFields }: { ctx: EditorCtx; customFields: { key: string; label: string }[] }) {
  const { draft, update, errors } = ctx;
  const questionError = Object.entries(errors).find(([k]) => k.startsWith("questions"))?.[1]?.[0];
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card
        title="Qualification questions"
        description="Asked on step 2, after name and email. Answers are saved on the contact and shown on every meeting. Leave empty to skip this step."
      >
        <QuestionBuilder value={draft.questions} onChange={(questions) => update({ questions })} customFields={customFields} />
        <FieldError>{questionError}</FieldError>
      </Card>

      <div className="grid content-start gap-5">
        <Card
          title="Disqualification rules"
          description="Screen out leads that are not a fit. When a rule matches, the visitor never sees the calendar."
        >
          <RuleBuilder questions={draft.questions} value={draft.disqualifyRules} onChange={(disqualifyRules) => update({ disqualifyRules })} />
          <p className="flex items-start gap-2 rounded-lg bg-muted/60 p-3 text-xs text-muted-foreground">
            <Info className="mt-0.5 size-3.5 shrink-0" />
            Conditions inside a group use the all/any choice; a lead is blocked as soon as <strong className="font-medium text-foreground">any</strong> group matches. Rules are checked on the server.
          </p>
        </Card>
        <Card title="What blocked leads see" description="Shown instead of the calendar. Be kind – the page never says the lead was disqualified.">
          <div className="grid gap-2">
            <Label htmlFor="dq-msg">Message</Label>
            <Textarea
              id="dq-msg"
              rows={4}
              value={draft.disqualifyMessage}
              onChange={(e) => update({ disqualifyMessage: e.target.value })}
              placeholder="Thanks for your interest! Right now we are not able to offer a call, but here is a resource that may help…"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="dq-redirect">Redirect to (optional)</Label>
            <Input id="dq-redirect" type="url" placeholder="https://example.com/resources" value={draft.disqualifyRedirectUrl} onChange={(e) => update({ disqualifyRedirectUrl: e.target.value })} aria-invalid={!!errors.disqualifyRedirectUrl} />
            <p className="text-xs text-muted-foreground">If set, visitors are sent there 2 seconds after seeing the message.</p>
            <FieldError>{errors.disqualifyRedirectUrl?.[0]}</FieldError>
          </div>
        </Card>
      </div>
    </div>
  );
}
