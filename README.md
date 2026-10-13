# Relay — CRM & marketing

Relay is a web-hosted CRM and marketing workspace for teams that grow through **events, meetings
and email**. It brings contacts, campaigns, events with registrations & attendance, an email editor
with broadcasts and automations, a built-in calendar and iClosed-style qualified booking pages into
one app.

**Production:** https://relay-crm-fawn.vercel.app (Vercel, Sydney) · **Database:** Supabase Postgres (`crm`, Sydney)

## What's inside

| Area | Highlights |
|---|---|
| **Dashboard** | KPIs with period-over-period deltas, public funnel (page views → potential leads → registrations/bookings → attended), registrations chart, upcoming 7 days, *Needs attention* (unmarked attendance, missing meeting outcomes, overdue tasks, failed emails), activity feed, top campaigns, getting-started checklist |
| **Contacts** | Searchable/filterable list, filter builder + saved Smart Views, bulk actions (tag, stage, owner, add to event, delete), CSV import wizard with column mapping & de-duplication, CSV export, contact card with journey timeline, notes, tasks, emails, registrations |
| **Pipeline & tasks** | Drag-and-drop kanban by configurable stages with deal values; follow-up tasks grouped by due date |
| **Campaigns** | Group events & broadcasts, budget, goal, UTM attribution; registrations, show-up rate, open/click rate and cost per registration |
| **Events** | Webinars/workshops/meetups with capacity & waitlist, public 2-step registration page (+ embeddable iframe), custom questions, attendee list, check-in mode for phones, automatic confirmation / reminder / follow-up emails, RSVP & self-service cancel links, .ics / Google Calendar |
| **Calendar** | Month/week/day/list views of events, meetings, campaigns, scheduled broadcasts and tasks; click-to-create, drag-to-reschedule (reminders re-planned), personal ICS feed for Google/Outlook/Apple |
| **Emails** | Rich editor (TipTap) with merge tags & buttons, live desktop/mobile preview, templates (incl. editable built-in notification templates), broadcasts to any audience with scheduling, open/click tracking, unsubscribe handling, full outbox log |
| **Automations** | Visual step builder (send email, wait, wait until event, condition, tags, stage, task, notify team, webhook) with triggers such as registered / attended / no-show / booked / outcome / tag added / link clicked / abandoned form; recipes; runs & logs |
| **Booking pages** (iClosed-inspired) | Qualification questions with disqualification rules & redirect, “potential lead” capture after the first step, round-robin hosts, availability with buffers/notice/limits, reminders to cut no-shows, reschedule/cancel links, meeting outcomes with objections & deal values, potential-leads list |
| **Reports** | Events, email, campaigns, meetings (per host & page, outcomes, objections) and lead sources |
| **Settings** | Workspace & branding, email sending (Outbox / Resend / SMTP), team & invites, profile & weekly availability, pipeline stages, custom fields, tags, webhooks, API keys, REST API, system status |

Emails are **simulated** (kept in the Outbox) until you configure Resend or SMTP in
Settings → Email sending.

## Local development

```bash
npm install
npm run dev
```

Open http://localhost:3000 and create a workspace (tick *Load sample data* to explore). Locally the
app uses an embedded Postgres (PGlite) in `.data/` — no database setup needed.

```bash
npm run typecheck   # next typegen + tsc
npm run lint
npm test            # vitest (in-memory Postgres per test file)
```

## Docs

- [`docs/SPEC.md`](docs/SPEC.md) — product spec and metric definitions
- [`docs/DEPLOY.md`](docs/DEPLOY.md) — environment variables, migrations, background jobs, email
- [`AGENTS.md`](AGENTS.md) — engineering guide (stack, conventions, shared libraries)
