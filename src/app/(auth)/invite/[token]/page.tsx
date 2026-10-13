import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { invites } from "@/lib/db/schema";
import { sha256 } from "@/lib/crypto";
import { getSetting } from "@/lib/settings";
import { AcceptInviteForm } from "./accept-form";

export const metadata = { title: "Join workspace" };

export default async function InvitePage({ params }: PageProps<"/invite/[token]">) {
  const { token } = await params;
  const [invite] = await db
    .select()
    .from(invites)
    .where(and(eq(invites.tokenHash, sha256(token)), isNull(invites.acceptedAt), gt(invites.expiresAt, new Date())));
  const ws = await getSetting("workspace");
  if (!invite) {
    return (
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Invitation not valid</h1>
        <p className="text-sm text-muted-foreground">This invitation link is invalid, already used, or expired. Ask an admin for a new one.</p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Join {ws.name}</h1>
        <p className="text-sm text-muted-foreground">
          You were invited as <span className="font-medium text-foreground">{invite.email}</span>. Choose your name and a password.
        </p>
      </div>
      <AcceptInviteForm token={token} />
    </div>
  );
}
