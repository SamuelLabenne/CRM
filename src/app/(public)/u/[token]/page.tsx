import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { BellOff, BellRing, MailCheck, MailWarning } from "lucide-react";
import { db } from "@/lib/db";
import { contacts } from "@/lib/db/schema";
import { PublicCard, PublicShell } from "@/components/public/public-shell";
import { SubmitButton } from "@/components/app/submit-button";
import { getSetting } from "@/lib/settings";
import { resubscribeAction, unsubscribeAction } from "./actions";

export const metadata: Metadata = { title: "Email preferences", robots: { index: false, follow: false } };

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function EmailPreferencesPage({ params, searchParams }: PageProps<"/u/[token]">) {
  const { token } = await params;
  const sp = await searchParams;
  if (!/^[a-zA-Z0-9_-]{8,100}$/.test(token)) notFound();
  const [contact] = await db.select().from(contacts).where(eq(contacts.unsubscribeToken, token));
  if (!contact || !contact.email) notFound();
  const ws = await getSetting("workspace");

  const unsubscribed = contact.emailStatus === "unsubscribed";
  const blocked = contact.emailStatus === "bounced" || contact.emailStatus === "complained";
  const justDone = first(sp.done) === "1" && unsubscribed;
  const justResubscribed = first(sp.resubscribed) === "1" && contact.emailStatus === "subscribed";

  const header = blocked
    ? { icon: MailWarning, title: "Emails are paused for this address", tone: "bg-amber-500/15 text-amber-600 dark:text-amber-400" }
    : unsubscribed
      ? { icon: BellOff, title: justDone ? "You've been unsubscribed" : "You're unsubscribed", tone: "bg-muted text-muted-foreground" }
      : justResubscribed
        ? { icon: MailCheck, title: "You're subscribed again", tone: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" }
        : { icon: BellRing, title: "Email preferences", tone: "bg-[color-mix(in_oklch,var(--brand)_14%,transparent)] text-[var(--brand)]" };
  const Icon = header.icon;

  return (
    <PublicShell>
      <PublicCard className="mx-auto grid max-w-md gap-6 text-center">
        <div className={`mx-auto grid size-14 place-items-center rounded-full ${header.tone}`}>
          <Icon className="size-7" />
        </div>
        <div className="grid gap-2">
          <h1 className="text-xl font-semibold tracking-tight">{header.title}</h1>
          <p className="text-sm text-muted-foreground">
            {blocked ? (
              <>
                We couldn&apos;t deliver to <span className="font-medium text-foreground">{contact.email}</span>, so we&apos;ve paused emails to it. Contact {ws.name} if you think this is a mistake.
              </>
            ) : unsubscribed ? (
              <>
                <span className="font-medium text-foreground">{contact.email}</span> won&apos;t receive marketing emails from {ws.name} any more. You may still get messages about events you registered for.
              </>
            ) : (
              <>
                <span className="font-medium text-foreground">{contact.email}</span> is subscribed to updates and event invitations from {ws.name}.
              </>
            )}
          </p>
        </div>
        {!blocked && !unsubscribed && (
          <form action={unsubscribeAction.bind(null, token)} className="grid gap-2">
            <SubmitButton size="lg" variant="outline" className="h-11 w-full">
              Unsubscribe from marketing emails
            </SubmitButton>
            <p className="text-xs text-muted-foreground">Confirmations and reminders for events you signed up to are not affected.</p>
          </form>
        )}
        {unsubscribed && (
          <form action={resubscribeAction.bind(null, token)} className="grid gap-2">
            <p className="text-xs text-muted-foreground">{justDone ? "Changed your mind?" : "Want to hear from us again?"}</p>
            <SubmitButton size="lg" className="h-11 w-full text-white" style={{ background: "var(--brand)" }}>
              Resubscribe
            </SubmitButton>
          </form>
        )}
      </PublicCard>
    </PublicShell>
  );
}
