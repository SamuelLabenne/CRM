import { requireAdmin } from "@/lib/auth";
import { getSetting } from "@/lib/settings";
import { formatDate, timeAgo } from "@/lib/format";
import { listPendingInvites, listTeam } from "@/lib/team";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { TeamManager, type MemberRow, type PendingInviteRow } from "./team-manager";

export const metadata = { title: "Team" };

export default async function TeamPage() {
  const me = await requireAdmin();
  const [members, pending, workspace] = await Promise.all([listTeam(), listPendingInvites(), getSetting("workspace")]);

  const rows: MemberRow[] = members.map((m) => ({
    id: m.id,
    name: m.name,
    email: m.email,
    role: m.role,
    color: m.color,
    title: m.title,
    lastLogin: m.lastLoginAt ? timeAgo(m.lastLoginAt) : "Never",
    joined: formatDate(m.createdAt, workspace.timezone),
    deactivated: !!m.deactivatedAt,
  }));
  const invites: PendingInviteRow[] = pending.map((i) => ({
    id: i.id,
    email: i.email,
    role: i.role,
    invitedBy: i.invitedByName,
    sent: timeAgo(i.createdAt),
    expires: i.expired ? "Expired" : `Expires ${formatDate(i.expiresAt, workspace.timezone, "d MMM")}`,
    expired: i.expired,
  }));
  const activeOwners = members.filter((m) => m.role === "owner" && !m.deactivatedAt).length;

  return (
    <>
      <PageHeader title="Team" description="Invite teammates and control what they can do." />
      <PageBody className="w-full max-w-4xl">
        <TeamManager members={rows} invites={invites} meId={me.id} meRole={me.role} activeOwners={activeOwners} />
      </PageBody>
    </>
  );
}
