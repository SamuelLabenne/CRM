"use client";

import { useState } from "react";
import Link from "next/link";
import { CheckCircle2, Send, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { SettingsCard } from "@/components/settings/settings-card";
import { useRunAction } from "@/components/settings/use-run-action";
import { sendTestEmailAction, type TestEmailResult } from "./actions";

export function TestEmailCard({ to, provider }: { to: string; provider: string }) {
  const [result, setResult] = useState<TestEmailResult | null>(null);
  const { run, pending } = useRunAction();

  return (
    <SettingsCard
      title="Send a test email"
      description={
        <>
          Sends a test message to <span className="font-medium text-foreground">{to}</span> using the settings saved above. Save any changes first.
        </>
      }
      footer={
        <Button
          type="button"
          disabled={pending}
          onClick={() => {
            setResult(null);
            run(sendTestEmailAction, {
              success: "",
              onSuccess: (data) => {
                if (!data) return;
                setResult(data);
                if (data.status === "failed") toast.error("The test email failed to send");
                else toast.success(data.status === "simulated" ? "Test email added to the Outbox" : "Test email sent");
              },
              onError: () => setResult(null),
            });
          }}
        >
          {pending ? <Spinner /> : <Send />} Send test email
        </Button>
      }
    >
      {result ? (
        result.status === "failed" ? (
          <Alert variant="destructive">
            <XCircle />
            <AlertTitle>Sending failed</AlertTitle>
            <AlertDescription>
              <p>{result.error ?? "Unknown error"}</p>
              <p className="mt-1">Check your credentials and that the From address is verified with your provider.</p>
            </AlertDescription>
          </Alert>
        ) : (
          <Alert>
            <CheckCircle2 className="text-emerald-600" />
            <AlertTitle>{result.status === "simulated" ? "Simulated – nothing was delivered" : `Sent to ${result.to}`}</AlertTitle>
            <AlertDescription>
              {result.status === "simulated" ? (
                <>
                  Outbox mode is on, so the email only exists inside Relay.{" "}
                  {result.messageId && (
                    <Link href={`/emails/outbox/${result.messageId}`} className="font-medium underline underline-offset-4">
                      View it in the Outbox
                    </Link>
                  )}
                </>
              ) : (
                <>
                  Accepted by {provider === "resend" ? "Resend" : "your SMTP server"}. It should arrive in a moment – check spam if not.{" "}
                  {result.messageId && (
                    <Link href={`/emails/outbox/${result.messageId}`} className="font-medium underline underline-offset-4">
                      View message
                    </Link>
                  )}
                </>
              )}
            </AlertDescription>
          </Alert>
        )
      ) : (
        <p className="text-sm text-muted-foreground">
          {provider === "outbox"
            ? "Outbox mode: the test is logged in Emails → Outbox and not delivered."
            : "The result (sent or the exact error from your provider) appears here."}
        </p>
      )}
    </SettingsCard>
  );
}
