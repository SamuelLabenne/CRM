import { Mail, MapPin, Phone, Globe, Building2, Briefcase } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LEAD_STATUS, MappedStatus } from "@/components/app/status-badge";
import { CopyButton } from "@/components/contacts/copy-button";
import { EmailStatusControl } from "@/components/contacts/email-status-control";
import { formatCustomValue, type CustomFieldLite } from "@/lib/contacts/custom-values";
import { formatDateTime, formatMoney } from "@/lib/format";
import type { Contact } from "@/lib/db/schema";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[7.5rem_1fr] items-start gap-2 py-1.5 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

const dash = <span className="text-muted-foreground">—</span>;

const SOURCE_LABEL: Record<string, string> = {
  manual: "Added manually",
  import: "CSV import",
  registration: "Event registration",
  booking: "Booking page",
  form: "Form",
  api: "API",
  automation: "Automation",
};

/** Read-only details panel (editing happens in the Edit sheet). Server component. */
export function ContactDetails({
  contact,
  customFields,
  timezone,
  currency,
  ownerName,
}: {
  contact: Contact;
  customFields: CustomFieldLite[];
  timezone: string;
  currency: string;
  ownerName: string | null;
}) {
  const utm = contact.utm ?? {};
  const utmEntries = (["source", "medium", "campaign", "term", "content"] as const).filter((k) => utm[k]);
  const location = [contact.city, contact.country].filter(Boolean).join(", ");
  const customValues = customFields
    .map((d) => ({ def: d, text: formatCustomValue(d, contact.customFields?.[d.key]) }))
    .filter((v) => v.text !== "");

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader className="pb-0">
          <CardTitle className="text-sm">Details</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="divide-y">
            <Row label="Email">
              {contact.email ? (
                <span className="flex items-center gap-1">
                  <Mail className="size-3.5 shrink-0 text-muted-foreground" />
                  <a href={`mailto:${contact.email}`} className="min-w-0 truncate hover:underline">
                    {contact.email}
                  </a>
                  <CopyButton value={contact.email} label="Email" />
                </span>
              ) : (
                dash
              )}
            </Row>
            <Row label="Phone">
              {contact.phone ? (
                <span className="flex items-center gap-1">
                  <Phone className="size-3.5 shrink-0 text-muted-foreground" />
                  <a href={`tel:${contact.phone}`} className="hover:underline">
                    {contact.phone}
                  </a>
                  <CopyButton value={contact.phone} label="Phone" />
                </span>
              ) : (
                dash
              )}
            </Row>
            <Row label="Company">
              {contact.company ? (
                <span className="flex items-center gap-1.5">
                  <Building2 className="size-3.5 shrink-0 text-muted-foreground" /> {contact.company}
                </span>
              ) : (
                dash
              )}
            </Row>
            <Row label="Job title">
              {contact.jobTitle ? (
                <span className="flex items-center gap-1.5">
                  <Briefcase className="size-3.5 shrink-0 text-muted-foreground" /> {contact.jobTitle}
                </span>
              ) : (
                dash
              )}
            </Row>
            <Row label="Website">
              {contact.website ? (
                <span className="flex items-center gap-1.5">
                  <Globe className="size-3.5 shrink-0 text-muted-foreground" />
                  <a href={/^https?:\/\//i.test(contact.website) ? contact.website : `https://${contact.website}`} target="_blank" rel="noreferrer noopener" className="truncate hover:underline">
                    {contact.website.replace(/^https?:\/\//i, "")}
                  </a>
                </span>
              ) : (
                dash
              )}
            </Row>
            <Row label="Location">
              {location ? (
                <span className="flex items-center gap-1.5">
                  <MapPin className="size-3.5 shrink-0 text-muted-foreground" /> {location}
                </span>
              ) : (
                dash
              )}
            </Row>
            <Row label="Deal value">{contact.dealValue != null ? formatMoney(contact.dealValue, currency) : dash}</Row>
            <Row label="Owner">{ownerName ?? dash}</Row>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-0">
          <CardTitle className="text-sm">Lifecycle</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="divide-y">
            <Row label="Lead status">{contact.leadStatus ? <MappedStatus map={LEAD_STATUS} value={contact.leadStatus} /> : dash}</Row>
            <Row label="Email status">
              <EmailStatusControl contactId={contact.id} status={contact.emailStatus} hasEmail={Boolean(contact.email)} />
              {contact.unsubscribedAt && contact.emailStatus === "unsubscribed" && (
                <span className="mt-0.5 block text-xs text-muted-foreground">Since {formatDateTime(contact.unsubscribedAt, timezone)}</span>
              )}
            </Row>
            <Row label="Source">{SOURCE_LABEL[contact.source] ?? contact.source}</Row>
            <Row label="Created">{formatDateTime(contact.createdAt, timezone)}</Row>
            <Row label="Updated">{formatDateTime(contact.updatedAt, timezone)}</Row>
          </dl>
        </CardContent>
      </Card>

      {customValues.length > 0 && (
        <Card>
          <CardHeader className="pb-0">
            <CardTitle className="text-sm">Custom fields</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="divide-y">
              {customValues.map(({ def, text }) => (
                <Row key={def.key} label={def.label}>
                  {def.type === "url" ? (
                    <a href={text} target="_blank" rel="noreferrer noopener" className="text-primary hover:underline">
                      {text}
                    </a>
                  ) : (
                    <span className="whitespace-pre-wrap">{text}</span>
                  )}
                </Row>
              ))}
            </dl>
          </CardContent>
        </Card>
      )}

      {utmEntries.length > 0 && (
        <Card>
          <CardHeader className="pb-0">
            <CardTitle className="text-sm">First touch (UTM)</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="divide-y">
              {utmEntries.map((k) => (
                <Row key={k} label={k[0].toUpperCase() + k.slice(1)}>
                  {utm[k]}
                </Row>
              ))}
            </dl>
          </CardContent>
        </Card>
      )}

      {contact.notes && (
        <Card>
          <CardHeader className="pb-0">
            <CardTitle className="text-sm">Notes</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm whitespace-pre-wrap break-words">{contact.notes}</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
