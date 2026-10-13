"use client";

import { useState } from "react";
import { Ban, Check, Link2, MailPlus, MoreHorizontal, RotateCw, ShieldCheck, Trash2, UserCheck, UserX } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { EmptyState } from "@/components/app/empty-state";
import { StatusBadge } from "@/components/app/status-badge";
import { UserAvatar } from "@/components/app/user-avatar";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CopyButton } from "@/components/settings/copy-button";
import { FieldErrors } from "@/components/settings/field-error";
import { SettingsCard } from "@/components/settings/settings-card";
import { useRunAction } from "@/components/settings/use-run-action";
import type { UserRole } from "@/lib/types";
import { changeRoleAction, inviteAction, resendInviteAction, revokeInviteAction, setActiveAction, type InviteResult } from "./actions";

export type MemberRow = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  color: string;
  title: string | null;
  lastLogin: string;
  joined: string;
  deactivated: boolean;
};
export type PendingInviteRow = { id: string; email: string; role: UserRole; invitedBy: string | null; sent: string; expires: string; expired: boolean };

const ROLE_LABEL: Record<UserRole, string> = { owner: "Owner", admin: "Admin", member: "Member" };
const ROLE_HELP: Record<UserRole, string> = {
  owner: "Full control, including managing other owners.",
  admin: "Manages settings, team and all data.",
  member: "Works with contacts, events and emails. No access to settings.",
};

export function TeamManager({
  members,
  invites,
  meId,
  meRole,
  activeOwners,
}: {
  members: MemberRow[];
  invites: PendingInviteRow[];
  meId: string;
  meRole: UserRole;
  activeOwners: number;
}) {
  const [inviteOpen, setInviteOpen] = useState(false);
  const [issued, setIssued] = useState<InviteResult | null>(null);
  const canGrantOwner = meRole === "owner";
  const { run, pending } = useRunAction();
  const [busyId, setBusyId] = useState<string | null>(null);

  function changeRole(m: MemberRow, role: UserRole) {
    setBusyId(m.id);
    run(() => changeRoleAction({ userId: m.id, role }), { onSuccess: () => setBusyId(null), onError: () => setBusyId(null) });
  }

  return (
    <>
      <SettingsCard
        title="Members"
        description={`${members.filter((m) => !m.deactivated).length} active ${members.filter((m) => !m.deactivated).length === 1 ? "member" : "members"}`}
        action={
          <Button onClick={() => setInviteOpen(true)}>
            <MailPlus /> Invite teammate
          </Button>
        }
        contentClassName="px-0"
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-4">Member</TableHead>
              <TableHead>Role</TableHead>
              <TableHead className="hidden md:table-cell">Last login</TableHead>
              <TableHead className="hidden sm:table-cell">Status</TableHead>
              <TableHead className="w-10 pr-4" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.map((m) => {
              const isMe = m.id === meId;
              const lastOwner = m.role === "owner" && !m.deactivated && activeOwners <= 1;
              const roleLocked = (m.role === "owner" && !canGrantOwner) || lastOwner;
              const rowBusy = pending && busyId === m.id;
              return (
                <TableRow key={m.id} className={m.deactivated ? "opacity-60" : undefined}>
                  <TableCell className="pl-4">
                    <div className="flex items-center gap-3">
                      <UserAvatar name={m.name} color={m.color} className="size-8" />
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 font-medium">
                          <span className="truncate">{m.name}</span>
                          {isMe && <Badge variant="secondary">You</Badge>}
                        </div>
                        <div className="truncate text-xs text-muted-foreground">{m.email}</div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <NativeSelect
                        size="sm"
                        value={m.role}
                        disabled={roleLocked || m.deactivated || rowBusy}
                        onChange={(e) => changeRole(m, e.target.value as UserRole)}
                        aria-label={`Role for ${m.name}`}
                        title={lastOwner ? "Relay needs at least one owner" : roleLocked ? "Only an owner can change an owner's role" : undefined}
                      >
                        {(["owner", "admin", "member"] as UserRole[]).map((r) => (
                          <NativeSelectOption key={r} value={r} disabled={r === "owner" && !canGrantOwner}>
                            {ROLE_LABEL[r]}
                          </NativeSelectOption>
                        ))}
                      </NativeSelect>
                      {rowBusy && <Spinner />}
                    </div>
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground md:table-cell">{m.lastLogin}</TableCell>
                  <TableCell className="hidden sm:table-cell">
                    <StatusBadge tone={m.deactivated ? "neutral" : "green"}>{m.deactivated ? "Deactivated" : "Active"}</StatusBadge>
                  </TableCell>
                  <TableCell className="pr-4 text-right">
                    <MemberMenu member={m} isMe={isMe} meRole={meRole} lastOwner={lastOwner} />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        <div className="grid gap-1 px-4 text-xs text-muted-foreground sm:grid-cols-3">
          {(["owner", "admin", "member"] as UserRole[]).map((r) => (
            <p key={r}>
              <span className="font-medium text-foreground">{ROLE_LABEL[r]}.</span> {ROLE_HELP[r]}
            </p>
          ))}
        </div>
      </SettingsCard>

      <SettingsCard title="Pending invitations" description="Invitation links are valid for 7 days and can only be shown once – create a new link if you lost it." contentClassName={invites.length ? "px-0" : undefined}>
        {invites.length === 0 ? (
          <EmptyState icon={MailPlus} title="No pending invitations" description="People you invite will appear here until they accept." className="border-0 bg-transparent" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead className="hidden sm:table-cell">Status</TableHead>
                <TableHead className="pr-4 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invites.map((i) => (
                <PendingRow key={i.id} invite={i} onIssued={setIssued} />
              ))}
            </TableBody>
          </Table>
        )}
      </SettingsCard>

      <InviteDialog
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        canGrantOwner={canGrantOwner}
        onIssued={(r) => {
          setInviteOpen(false);
          setIssued(r);
        }}
      />
      <IssuedDialog result={issued} onClose={() => setIssued(null)} />
    </>
  );
}

function MemberMenu({ member, isMe, meRole, lastOwner }: { member: MemberRow; isMe: boolean; meRole: UserRole; lastOwner: boolean }) {
  const { run } = useRunAction();
  const [open, setOpen] = useState(false);
  const ownerProtected = member.role === "owner" && meRole !== "owner";
  if (member.deactivated) {
    return (
      <Button variant="ghost" size="sm" onClick={() => run(() => setActiveAction({ userId: member.id, active: true }))}>
        <UserCheck /> Reactivate
      </Button>
    );
  }
  const blocked = isMe || lastOwner || ownerProtected;
  const reason = isMe ? "You can't deactivate yourself" : lastOwner ? "You can't deactivate the last owner" : ownerProtected ? "Only an owner can deactivate an owner" : "";
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${member.name}`}>
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <ConfirmDialog
          title={`Deactivate ${member.name}?`}
          description="They'll be signed out immediately and can no longer log in. Their contacts, events and history stay in Relay, and you can reactivate them at any time."
          confirmLabel="Deactivate"
          destructive
          onConfirm={async () => {
            const res = await setActiveAction({ userId: member.id, active: false });
            if (res.ok) toast.success(res.message);
            else toast.error(res.error);
            setOpen(false);
          }}
          trigger={
            <DropdownMenuItem variant="destructive" disabled={blocked} onSelect={(e) => e.preventDefault()}>
              <UserX /> Deactivate
            </DropdownMenuItem>
          }
        />
        {blocked && (
          <>
            <DropdownMenuSeparator />
            <p className="px-2 py-1.5 text-xs text-muted-foreground">{reason}</p>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function PendingRow({ invite, onIssued }: { invite: PendingInviteRow; onIssued: (r: InviteResult) => void }) {
  const { run, pending } = useRunAction();
  return (
    <TableRow>
      <TableCell className="pl-4 font-medium">{invite.email}</TableCell>
      <TableCell>{ROLE_LABEL[invite.role]}</TableCell>
      <TableCell className="hidden sm:table-cell">
        <StatusBadge tone={invite.expired ? "red" : "amber"}>{invite.expired ? "Expired" : "Pending"}</StatusBadge>
        <span className="ml-2 text-xs text-muted-foreground">
          {invite.expired ? `sent ${invite.sent}` : `${invite.expires} · sent ${invite.sent}`}
          {invite.invitedBy ? ` by ${invite.invitedBy}` : ""}
        </span>
      </TableCell>
      <TableCell className="pr-4">
        <div className="flex justify-end gap-1">
          <Button
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={() => run(() => resendInviteAction(invite.id), { success: "", onSuccess: (r) => r && onIssued(r) })}
          >
            {pending ? <Spinner /> : <RotateCw />} <span className="hidden sm:inline">New link</span>
          </Button>
          <ConfirmDialog
            title="Revoke this invitation?"
            description={`The link sent to ${invite.email} will stop working.`}
            confirmLabel="Revoke"
            destructive
            onConfirm={async () => {
              const res = await revokeInviteAction(invite.id);
              if (res.ok) toast.success(res.message);
              else toast.error(res.error);
            }}
            trigger={
              <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive">
                <Trash2 /> <span className="hidden sm:inline">Revoke</span>
              </Button>
            }
          />
        </div>
      </TableCell>
    </TableRow>
  );
}

function InviteDialog({
  open,
  onOpenChange,
  canGrantOwner,
  onIssued,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  canGrantOwner: boolean;
  onIssued: (r: InviteResult) => void;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<UserRole>("member");
  const { run, pending, fieldErrors } = useRunAction();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => inviteAction({ email, role }), {
              success: "",
              onSuccess: (r) => {
                if (!r) return;
                setEmail("");
                setRole("member");
                onIssued(r);
              },
            });
          }}
        >
          <DialogHeader>
            <DialogTitle>Invite a teammate</DialogTitle>
            <DialogDescription>They&apos;ll get an email with a link to choose a password and join.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="invite-email">Email</Label>
            <Input id="invite-email" type="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" aria-invalid={!!fieldErrors.email} />
            <FieldErrors errors={fieldErrors.email} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="invite-role">Role</Label>
            <NativeSelect id="invite-role" value={role} onChange={(e) => setRole(e.target.value as UserRole)} className="w-full">
              <NativeSelectOption value="member">Member</NativeSelectOption>
              <NativeSelectOption value="admin">Admin</NativeSelectOption>
              {canGrantOwner && <NativeSelectOption value="owner">Owner</NativeSelectOption>}
            </NativeSelect>
            <p className="text-xs text-muted-foreground">{ROLE_HELP[role]}</p>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || !email.trim()}>
              {pending && <Spinner />} Send invitation
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function IssuedDialog({ result, onClose }: { result: InviteResult | null; onClose: () => void }) {
  return (
    <Dialog open={!!result} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        {result && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <ShieldCheck className="size-5 text-emerald-600" /> Invitation ready
              </DialogTitle>
              <DialogDescription>
                Share this link with <span className="font-medium text-foreground">{result.email}</span>. For security it&apos;s only shown now – if you lose it, create a new link.
              </DialogDescription>
            </DialogHeader>
            <div className="flex items-center gap-2">
              <Input readOnly value={result.url} onFocus={(e) => e.currentTarget.select()} className="min-w-0 flex-1 font-mono text-xs" aria-label="Invitation link" />
              <CopyButton value={result.url} label="Copy" />
            </div>
            {result.emailStatus === "sent" && (
              <Alert>
                <Check className="text-emerald-600" />
                <AlertDescription>We also emailed the invitation to {result.email}.</AlertDescription>
              </Alert>
            )}
            {result.emailStatus === "simulated" && (
              <Alert>
                <Link2 />
                <AlertTitle>Email not delivered (Outbox mode)</AlertTitle>
                <AlertDescription>Email sending is simulated, so send the link above yourself. Switch to Resend or SMTP in Email settings to deliver invitations automatically.</AlertDescription>
              </Alert>
            )}
            {(result.emailStatus === "failed" || result.emailStatus === "skipped") && (
              <Alert variant="destructive">
                <Ban />
                <AlertTitle>The invitation email couldn&apos;t be sent</AlertTitle>
                <AlertDescription>{result.emailError ?? "Unknown error"}. Share the link above manually.</AlertDescription>
              </Alert>
            )}
            <DialogFooter>
              <Button onClick={onClose}>Done</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
