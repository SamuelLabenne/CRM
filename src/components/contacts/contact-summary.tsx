"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Mail, Phone } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { LEAD_STATUS, MappedStatus } from "@/components/app/status-badge";
import { UserAvatar } from "@/components/app/user-avatar";
import { TagsInput } from "@/components/contacts/tags-input";
import { CopyButton } from "@/components/contacts/copy-button";
import { changeStageAction } from "@/app/(app)/pipeline/actions";
import { setContactOwnerAction, setContactTagsAction } from "@/app/(app)/contacts/actions";
import type { StageDTO, TagDTO, UserDTO } from "@/lib/contacts/dto";

/** Profile bar on the contact card: avatar, quick contact methods, stage / owner selectors and the tags editor. */
export function ContactSummary({
  contactId,
  name,
  email,
  phone,
  stage,
  leadStatus,
  ownerId,
  tags,
  stages,
  users,
  tagSuggestions,
}: {
  contactId: string;
  name: string;
  email: string | null;
  phone: string | null;
  stage: string;
  leadStatus: string | null;
  ownerId: string | null;
  tags: string[];
  stages: StageDTO[];
  users: UserDTO[];
  tagSuggestions: TagDTO[];
}) {
  const router = useRouter();
  const [, start] = useTransition();
  const [stageKey, setStageKey] = useState(stage);
  const [owner, setOwner] = useState(ownerId ?? "");
  const [tagNames, setTagNames] = useState(tags);
  // Re-adopt server values after a refresh.
  const [seen, setSeen] = useState({ stage, ownerId, tags });
  if (seen.stage !== stage || seen.ownerId !== ownerId || seen.tags.join("\u0000") !== tags.join("\u0000")) {
    setSeen({ stage, ownerId, tags });
    setStageKey(stage);
    setOwner(ownerId ?? "");
    setTagNames(tags);
  }
  const current = stages.find((s) => s.key === stageKey);
  const ownerUser = users.find((u) => u.id === owner);

  return (
    <Card className="gap-4 p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="flex min-w-0 items-center gap-3">
          <UserAvatar name={name} className="size-12 rounded-xl text-base" />
          <div className="min-w-0 text-sm">
            {email ? (
              <div className="flex items-center gap-1">
                <Mail className="size-3.5 shrink-0 text-muted-foreground" />
                <a href={`mailto:${email}`} className="truncate hover:underline">
                  {email}
                </a>
                <CopyButton value={email} label="Email" />
              </div>
            ) : (
              <div className="text-muted-foreground">No email address</div>
            )}
            {phone ? (
              <div className="flex items-center gap-1">
                <Phone className="size-3.5 shrink-0 text-muted-foreground" />
                <a href={`tel:${phone}`} className="hover:underline">
                  {phone}
                </a>
                <CopyButton value={phone} label="Phone" />
              </div>
            ) : (
              <div className="text-muted-foreground">No phone number</div>
            )}
          </div>
        </div>

        <div className="grid gap-1">
          <Label htmlFor="summary-stage" className="text-xs text-muted-foreground">
            Stage
          </Label>
          <div className="flex items-center gap-2">
            <span className="size-2.5 rounded-full" style={{ background: current?.color ?? "#94a3b8" }} />
            <NativeSelect
              id="summary-stage"
              size="sm"
              value={stageKey}
              onChange={(e) => {
                const next = e.target.value;
                const prev = stageKey;
                setStageKey(next);
                start(async () => {
                  const res = await changeStageAction(contactId, next);
                  if (!res.ok) {
                    setStageKey(prev);
                    toast.error(res.error);
                  } else toast.success(res.message ?? "Stage updated");
                  router.refresh();
                });
              }}
            >
              {!current && <NativeSelectOption value={stageKey}>{stageKey}</NativeSelectOption>}
              {stages.map((s) => (
                <NativeSelectOption key={s.key} value={s.key}>
                  {s.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
        </div>

        <div className="grid gap-1">
          <span className="text-xs text-muted-foreground">Lead status</span>
          <div className="flex h-7 items-center">{leadStatus ? <MappedStatus map={LEAD_STATUS} value={leadStatus} /> : <span className="text-sm text-muted-foreground">None</span>}</div>
        </div>

        <div className="grid gap-1">
          <Label htmlFor="summary-owner" className="text-xs text-muted-foreground">
            Owner
          </Label>
          <div className="flex items-center gap-2">
            {ownerUser && <UserAvatar name={ownerUser.name} color={ownerUser.color} className="size-6" />}
            <NativeSelect
              id="summary-owner"
              size="sm"
              value={owner}
              onChange={(e) => {
                const next = e.target.value;
                const prev = owner;
                setOwner(next);
                start(async () => {
                  const res = await setContactOwnerAction(contactId, next || null);
                  if (!res.ok) {
                    setOwner(prev);
                    toast.error(res.error);
                  } else toast.success(res.message ?? "Owner updated");
                  router.refresh();
                });
              }}
            >
              <NativeSelectOption value="">Unassigned</NativeSelectOption>
              {users.map((u) => (
                <NativeSelectOption key={u.id} value={u.id}>
                  {u.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
        </div>
      </div>

      <div className="grid gap-1.5">
        <span className="text-xs text-muted-foreground">Tags</span>
        <TagsInput
          value={tagNames}
          suggestions={tagSuggestions}
          onChange={(next) => {
            const prev = tagNames;
            setTagNames(next);
            start(async () => {
              const res = await setContactTagsAction(contactId, next);
              if (!res.ok) {
                setTagNames(prev);
                toast.error(res.error);
              } else toast.success(res.message ?? "Tags updated");
              router.refresh();
            });
          }}
        />
      </div>
    </Card>
  );
}
