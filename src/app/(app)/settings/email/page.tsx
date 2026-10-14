import { requireAdmin } from "@/lib/auth";
import { getSetting } from "@/lib/settings";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { EmailSettingsForm } from "./email-form";
import { TestEmailCard } from "./test-email-card";

export const metadata = { title: "Email sending" };

export default async function EmailSettingsPage() {
  const user = await requireAdmin();
  const cfg = await getSetting("email");
  return (
    <>
      <PageHeader title="Email sending" description="Choose how Relay delivers email, and who it comes from." />
      <PageBody className="w-full max-w-4xl">
        {/* Secrets are never sent to the browser – only whether they are stored. */}
        <EmailSettingsForm
          initial={{
            provider: cfg.provider,
            fromName: cfg.fromName,
            fromEmail: cfg.fromEmail,
            replyTo: cfg.replyTo ?? "",
            tracking: cfg.tracking,
            testMode: cfg.testMode,
            testRecipients: cfg.testRecipients.join(", "),
            dailyLimit: cfg.dailyLimit == null ? "" : String(cfg.dailyLimit),
            smtp: { host: cfg.smtp?.host ?? "", port: cfg.smtp?.port ?? 587, secure: cfg.smtp?.secure ?? false, user: cfg.smtp?.user ?? "" },
          }}
          resendKeySaved={!!cfg.resendApiKey}
          resendKeyFromEnv={!!process.env.RESEND_API_KEY}
          smtpPasswordSaved={!!cfg.smtp?.password}
        />
        <TestEmailCard to={user.email} provider={cfg.provider} />
      </PageBody>
    </>
  );
}
