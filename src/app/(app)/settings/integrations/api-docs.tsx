import { BookOpen } from "lucide-react";
import { CopyButton } from "@/components/settings/copy-button";
import { SettingsCard } from "@/components/settings/settings-card";
import { Badge } from "@/components/ui/badge";

function Code({ children }: { children: string }) {
  return <pre className="overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs leading-relaxed text-foreground">{children}</pre>;
}

function Endpoint({ method, path, summary, children }: { method: "GET" | "POST"; path: string; summary: string; children?: React.ReactNode }) {
  return (
    <div className="grid gap-2 rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={method === "GET" ? "secondary" : "default"} className="font-mono">
          {method}
        </Badge>
        <code className="font-mono text-sm">{path}</code>
      </div>
      <p className="text-sm text-muted-foreground">{summary}</p>
      {children}
    </div>
  );
}

/** Reference for the REST API (v1). */
export function ApiDocsCard({ baseUrl }: { baseUrl: string }) {
  const curlList = `curl "${baseUrl}/contacts?q=ada&limit=10" \\
  -H "Authorization: Bearer $RELAY_API_KEY"`;
  const curlCreate = `curl -X POST "${baseUrl}/contacts" \\
  -H "Authorization: Bearer $RELAY_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"email":"ada@example.com","firstName":"Ada","lastName":"Lovelace","tags":["Newsletter"]}'`;
  const curlRegister = `curl -X POST "${baseUrl}/events/<event-id>/registrations" \\
  -H "Authorization: Bearer $RELAY_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"email":"ada@example.com","firstName":"Ada","lastName":"Lovelace","answers":{}}'`;
  return (
    <SettingsCard
      title="REST API"
      description={
        <span className="inline-flex items-center gap-1.5">
          <BookOpen className="size-3.5" /> Version 1 · JSON over HTTPS
        </span>
      }
      action={<CopyButton value={baseUrl} label="Copy base URL" />}
    >
      <div className="grid gap-2 text-sm">
        <p>
          Base URL: <code className="font-mono text-xs">{baseUrl}</code>
        </p>
        <p className="text-muted-foreground">
          Authenticate every request with an API key: <code className="font-mono text-xs">Authorization: Bearer rly_…</code>. Errors are JSON:{" "}
          <code className="font-mono text-xs">{`{"error":{"code":"invalid_request","message":"…"}}`}</code> with a matching HTTP status (400/401/404/409/422).
        </p>
      </div>

      <Endpoint method="GET" path="/contacts" summary="Search and list contacts. Query: q (name, email, company…), limit (1–100, default 25), offset.">
        <Code>{curlList}</Code>
      </Endpoint>
      <Endpoint method="POST" path="/contacts" summary="Create a contact, or update the one with the same email/phone (blank fields are filled; set overwrite: true to replace). Returns 201 when created, 200 when it already existed.">
        <Code>{curlCreate}</Code>
        <p className="text-xs text-muted-foreground">
          Fields: email, phone, firstName, lastName, company, jobTitle, website, city, country, stage, tags (names – created if missing), customFields (by key), utm, overwrite. At least a name, email or phone is required.
        </p>
      </Endpoint>
      <Endpoint method="GET" path="/events" summary="Upcoming scheduled events (not meetings) with seats left. Query: limit (1–100, default 25)." />
      <Endpoint method="POST" path="/events/{id}/registrations" summary="Register a person for an event. The contact is created or matched by email, then registered (confirmation email, reminders and automations run as usual). 201 when new, 200 if already registered; 409 when the event is full.">
        <Code>{curlRegister}</Code>
        <p className="text-xs text-muted-foreground">Body: email (required), firstName, lastName, phone, answers (object keyed by question id).</p>
      </Endpoint>
    </SettingsCard>
  );
}
