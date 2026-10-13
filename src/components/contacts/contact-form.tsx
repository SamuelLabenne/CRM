"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Spinner } from "@/components/ui/spinner";
import { createContactAction, updateContactAction } from "@/app/(app)/contacts/actions";
import { TagsInput } from "@/components/contacts/tags-input";
import { CustomFieldInput } from "@/components/contacts/custom-field-input";
import type { CustomFieldLite } from "@/lib/contacts/custom-values";
import type { StageDTO, TagDTO, UserDTO } from "@/lib/contacts/dto";

export type ContactFormValues = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  company: string;
  jobTitle: string;
  website: string;
  city: string;
  country: string;
  stage: string;
  ownerId: string;
  dealValue: string;
  notes: string;
  customFields: Record<string, unknown>;
  tags: string[];
};

export const EMPTY_CONTACT_VALUES: ContactFormValues = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  company: "",
  jobTitle: "",
  website: "",
  city: "",
  country: "",
  stage: "",
  ownerId: "",
  dealValue: "",
  notes: "",
  customFields: {},
  tags: [],
};

/** Create / edit form for a contact (standard fields, stage, owner, deal value, tags, custom fields). */
export function ContactForm({
  contactId,
  initial,
  stages,
  users,
  customFields,
  tagSuggestions,
  defaultOwnerId,
  onDone,
  onCancel,
}: {
  /** Present when editing an existing contact. */
  contactId?: string;
  initial?: Partial<ContactFormValues>;
  stages: StageDTO[];
  users: UserDTO[];
  customFields: CustomFieldLite[];
  tagSuggestions: TagDTO[];
  defaultOwnerId?: string;
  onDone?: () => void;
  onCancel?: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [v, setV] = useState<ContactFormValues>({
    ...EMPTY_CONTACT_VALUES,
    stage: stages[0]?.key ?? "new",
    ownerId: defaultOwnerId ?? "",
    ...initial,
  });
  const [errors, setErrors] = useState<Record<string, string[] | undefined>>({});
  const [duplicateId, setDuplicateId] = useState<string | null>(null);
  const set = <K extends keyof ContactFormValues>(k: K, val: ContactFormValues[K]) => setV((p) => ({ ...p, [k]: val }));
  const err = (k: string) => errors[k]?.[0];

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});
    setDuplicateId(null);
    const dealValue = v.dealValue.trim() === "" ? null : Number(v.dealValue);
    if (dealValue != null && !Number.isFinite(dealValue)) {
      setErrors({ dealValue: ["Enter a number"] });
      return;
    }
    const payload = {
      firstName: v.firstName,
      lastName: v.lastName,
      email: v.email,
      phone: v.phone,
      company: v.company,
      jobTitle: v.jobTitle,
      website: v.website,
      city: v.city,
      country: v.country,
      stage: v.stage || undefined,
      ownerId: v.ownerId || null,
      dealValue,
      notes: v.notes,
      customFields: v.customFields,
      tags: v.tags,
    };
    start(async () => {
      const res = contactId ? await updateContactAction(contactId, payload) : await createContactAction(payload);
      if (!res.ok) {
        setErrors(res.fieldErrors ?? {});
        setDuplicateId((res as { duplicateId?: string }).duplicateId ?? null);
        toast.error(res.error);
        return;
      }
      toast.success(res.message ?? "Saved");
      if (contactId) {
        onDone?.();
        router.refresh();
      } else router.push(`/contacts/${res.data!.id}`);
    });
  };

  const field = (key: keyof ContactFormValues, label: string, props: React.ComponentProps<"input"> = {}) => (
    <div className="grid gap-1.5">
      <Label htmlFor={`cf-${key}`}>{label}</Label>
      <Input
        id={`cf-${key}`}
        value={v[key] as string}
        onChange={(e) => set(key, e.target.value as never)}
        aria-invalid={!!err(key)}
        {...props}
      />
      {err(key) && <p className="text-sm text-destructive">{err(key)}</p>}
    </div>
  );

  return (
    <form onSubmit={submit} className="grid gap-6">
      <section className="grid gap-4">
        <h3 className="text-sm font-medium">Basics</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          {field("firstName", "First name", { autoComplete: "off", autoFocus: !contactId })}
          {field("lastName", "Last name", { autoComplete: "off" })}
          {field("email", "Email", { type: "email", autoComplete: "off", placeholder: "name@company.com" })}
          {field("phone", "Phone", { type: "tel", autoComplete: "off", placeholder: "+61 400 000 000" })}
          {field("company", "Company")}
          {field("jobTitle", "Job title")}
          {field("website", "Website", { placeholder: "https://" })}
          <div className="grid grid-cols-2 gap-3">
            {field("city", "City")}
            {field("country", "Country")}
          </div>
        </div>
        {duplicateId && (
          <p className="text-sm text-muted-foreground">
            <Link href={`/contacts/${duplicateId}`} className="font-medium text-primary underline-offset-4 hover:underline">
              Open the existing contact
            </Link>{" "}
            to update it instead.
          </p>
        )}
      </section>

      <section className="grid gap-4">
        <h3 className="text-sm font-medium">Pipeline</h3>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="grid gap-1.5">
            <Label htmlFor="cf-stage">Stage</Label>
            <NativeSelect id="cf-stage" className="w-full" value={v.stage} onChange={(e) => set("stage", e.target.value)}>
              {stages.map((s) => (
                <NativeSelectOption key={s.key} value={s.key}>
                  {s.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="cf-owner">Owner</Label>
            <NativeSelect id="cf-owner" className="w-full" value={v.ownerId} onChange={(e) => set("ownerId", e.target.value)}>
              <NativeSelectOption value="">Unassigned</NativeSelectOption>
              {users.map((u) => (
                <NativeSelectOption key={u.id} value={u.id}>
                  {u.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
          {field("dealValue", "Deal value", { type: "number", min: 0, step: 1, inputMode: "numeric" })}
        </div>
        <div className="grid gap-1.5">
          <Label>Tags</Label>
          <TagsInput value={v.tags} onChange={(t) => set("tags", t)} suggestions={tagSuggestions} />
        </div>
      </section>

      {customFields.length > 0 && (
        <section className="grid gap-4">
          <h3 className="text-sm font-medium">Custom fields</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            {customFields.map((def) => (
              <div key={def.key} className="grid gap-1.5">
                <Label htmlFor={`cf-custom-${def.key}`}>{def.label}</Label>
                <CustomFieldInput
                  id={`cf-custom-${def.key}`}
                  def={def}
                  value={v.customFields[def.key]}
                  invalid={!!errors[`customFields.${def.key}`]}
                  onChange={(val) => set("customFields", { ...v.customFields, [def.key]: val })}
                />
                {errors[`customFields.${def.key}`] && <p className="text-sm text-destructive">{errors[`customFields.${def.key}`]?.[0]}</p>}
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="grid gap-1.5">
        <Label htmlFor="cf-notes">Notes</Label>
        <Textarea id="cf-notes" rows={4} value={v.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Background, preferences, anything worth remembering…" />
      </section>

      <div className="flex flex-wrap items-center justify-end gap-2">
        {onCancel ? (
          <Button type="button" variant="outline" onClick={onCancel} disabled={pending}>
            Cancel
          </Button>
        ) : (
          <Button type="button" variant="outline" asChild>
            <Link href="/contacts">Cancel</Link>
          </Button>
        )}
        <Button type="submit" disabled={pending}>
          {pending && <Spinner />} {contactId ? "Save changes" : "Create contact"}
        </Button>
      </div>
    </form>
  );
}
