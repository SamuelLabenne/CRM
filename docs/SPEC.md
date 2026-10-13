# Relay – product spec (MVP)

Relay is a web-hosted CRM & marketing workspace for small teams that grow through **events,
meetings and email**. It combines a contact database, campaign & event tracking with
registrations and attendance, an email editor with broadcasts and automations, a built-in
calendar, and booking pages inspired by **iClosed** (2-step qualification forms, "potential"
lead capture, no-show reduction with reminders, meeting outcomes, funnel analytics).

Terminology: **Contact** (person) · **Campaign** (marketing initiative grouping events, emails
and attribution) · **Event** (group event with registrations: webinar, workshop, meetup…) ·
**Registration/attendee** (contact ↔ event, with status) · **Meeting** (1:1 event created by a
**booking page**) · **Template / Broadcast / Automation** (email) · **Stage** (manual pipeline
stage) · **Lead status** (system funnel status: potential → qualified/disqualified → registered/booked).

Statuses
- Attendee: `registered`, `confirmed` (RSVP yes), `waitlisted`, `attended`, `no_show`, `cancelled`.
- Event: `draft`, `scheduled`, `completed`, `cancelled`. Kind: `event` | `meeting`.
- Meeting outcome: `won`, `lost`, `follow_up`, `not_qualified`, `no_show`, `cancelled`
  (+ objection: money, timing, partner, fear, smoke_screen, no_objection; notes; deal value).

Key metrics (consistent everywhere)
- **Show-up rate** = attended / (attended + no_show) for past events/meetings.
- **Attendance rate** = attended / non-cancelled registrations of past events.
- **Registration conversion** = registrations / unique page views.
- **Open rate** = opened / delivered (sent+simulated); **Click rate** = clicked / delivered.
- **Closing rate** (meetings) = won / meetings with an outcome other than cancelled.

---

## 1. Contacts, pipeline & tasks (module A)

Routes: `/contacts`, `/contacts/new`, `/contacts/[id]`, `/contacts/import`, `/pipeline`, `/tasks`.

- **List** `/contacts`: server-paginated table (50/page) with search (`?q=`), quick filters
  (stage, lead status, tag, owner, email status, source), a **filter builder** producing a
  `FilterGroup` (encoded in the URL as `?f=<base64url json>`), and **Smart Views**
  (`saved_views`): save current filters as a named view (shared/private), list views in a
  left rail or tabs, delete/rename. Columns: name+email (avatar), company, stage
  (`ColorBadge` with stage color), lead status, tags, owner, last activity, created.
  Row checkboxes + **bulk actions**: add/remove tag, change stage, assign owner, add to event
  (`registerForEvent`, source manual), export selected, delete (confirm).
- **Export** CSV of the current filter (route handler `/contacts/export?…`, auth required).
- **Import** `/contacts/import`: upload CSV (papaparse client-side), map columns → fields
  (first/last/full name, email, phone, company, job title, website, city, country, notes,
  tags (comma separated), stage, custom fields), preview first rows, choose "update existing"
  (overwrite) or "skip/fill blanks", optional tag for all imported, then import via server
  action in chunks using `upsertContact({source:"import"})`. Show summary (created/updated/skipped/errors).
- **New/edit contact**: form with standard fields, custom fields (from `custom_field_defs`),
  stage, owner, tags, deal value. Use `upsertContact` for create (source manual) and a normal
  update for edit (log `contact_updated`; use `changeStage` for stage changes).
- **Contact card** `/contacts/[id]`: header (avatar, name, company/title, email/phone with
  copy/mailto, stage selector, lead status badge, owner, tags editor, actions: Send email
  (compose dialog with template picker → `sendEmail({kind:"manual"})`), Add note, Add task,
  Add to event, Delete). Left/right layout: **Details panel** (all fields inline-editable or
  via edit sheet, custom fields, UTM first-touch, email status with unsubscribe/resubscribe,
  created/source), and **tabs**: *Journey* (activities timeline with icons per type, newest
  first, filter by type, notes inline composer), *Events & meetings* (registrations with
  status/outcome badges + links), *Emails* (messages with status/opened/clicked), *Tasks*.
- **Pipeline** `/pipeline`: kanban of contacts by stage (stages from settings, colored
  columns, counts and sum of deal value per column), drag & drop (@dnd-kit) → `changeStage`.
  Filter by owner/tag/search. Card: name, company, deal value, last activity, owner avatar.
  Limit 100 cards per column with "+N more" link to the filtered list.
- **Tasks** `/tasks`: list grouped by Overdue / Today / Upcoming / No date / Completed, filter
  mine/all, create (title, due date+time, priority, contact picker, assignee), complete
  (checkbox, logs `task_completed` on the contact), edit, delete. Tasks show in the calendar.

## 2. Events, campaigns & attendance (module B)

Routes: `/events`, `/events/new`, `/events/[id]` (tabs: Overview, Attendees, Registration
page, Emails, Settings), `/events/[id]/check-in`, `/campaigns`, `/campaigns/new`,
`/campaigns/[id]`; public `/e/[slug]`, `/embed/e/[slug]`, `/m/[token]`, `/u/[token]`.

- **Events list**: tabs Upcoming / Past / Drafts / All, search, filter by campaign & type.
  Card or table rows: date block, title, type, location, campaign, capacity bar
  (registered/capacity), attendance rate for past events, status. A **"Needs attendance"**
  callout listing past events (ended) that still have registered/confirmed attendees not
  marked attended/no-show (iClosed "action required").
- **Create/edit event**: title, type, description, start/end (date + time in workspace tz),
  location type (online/in person/phone) + location/meeting URL, capacity + waitlist toggle,
  campaign, host (user), color, status (draft/scheduled), public registration page toggle +
  slug (auto from title, editable, unique), registration questions builder (FormQuestion[]:
  label, type, required, options, mapTo contact field), notifications editor
  (`EventNotifications`: confirmation on/off + template, reminders list with "N minutes/hours/
  days before" + template, follow-ups list with audience attended/no-show/all + delay + template,
  notify host). Default notifications: `DEFAULT_EVENT_NOTIFICATIONS`. After time or
  notification changes call `replanEventNotifications(eventId)`; when status becomes
  cancelled call `onEventCancelled`. Duplicate event action.
- **Event detail Overview**: KPIs (registered, confirmed, waitlisted, attended, no-show,
  show-up rate, page views & conversion), registrations over time mini chart, public link
  with copy button + embed snippet, upcoming scheduled emails for this event (from `jobs`
  with type `event.notification`), quick actions (check-in mode, email attendees → link to
  new broadcast prefilled with audience `{type:"event"}`).
- **Attendees tab**: table with contact, status badge, RSVP, registered at, source, answers
  (expand), check-in time; filters by status; search; per-row actions: mark attended / no-show
  / reset, cancel registration (staff), remove; bulk mark attended/no-show; add attendee
  (`ContactPicker` + quick-create contact), CSV export of attendees. Uses `markAttendance`,
  `cancelRegistration`, `registerForEvent`.
- **Check-in mode** `/events/[id]/check-in`: full-screen friendly list with big search box,
  tap a person to toggle attended (optimistic), counters (checked in / expected), walk-in
  quick add (name+email → upsert + register + mark attended).
- **Public registration page** `/e/[slug]` (only when `isPublic` and status scheduled):
  branded page (workspace name/logo/brand color), cover color/image, title, date/time
  (shown in the visitor's timezone with tz label), location, description, seats left,
  **2-step form**: step 1 first name, last name, email (and phone optional) → on "Continue"
  the server immediately upserts the contact (source `registration`), creates/updates a
  `lead_captures` row (status `partial`), sets lead status `potential`, emits trigger
  `lead_potential` and webhook `lead.potential`; step 2 custom questions → submit →
  `registerForEvent({source:"public"})`, map answers to contact fields (`mapTo`), lead
  capture `completed`, then a confirmation screen (add to calendar links, manage link).
  Honeypot field for bots; capture UTM params (`utm_*` in the URL) into contact first-touch
  utm and attendee utm; record a `page_views` row per visit (visitorHash = sha256(ip+ua+day)).
  Registration closed / full (waitlist) / past event states. `/embed/e/[slug]` renders the
  same form without chrome for iframes. Prefill via `?email=&first_name=&last_name=`.
- **Attendee self-service** `/m/[token]`: shows event details & status; RSVP buttons
  (yes/maybe/no via `setRsvp`; query `?rsvp=yes` applies on load with confirmation message);
  cancel (`?action=cancel` asks to confirm, optional reason) → `cancelRegistration({by:"attendee"})`;
  add to calendar (.ics `/api/ics/attendee/[token]`, Google link); join link for online events
  (shown from 30 min before start). For meetings: also "Book another time" link to the booking page.
- **Email preferences** `/u/[token]`: shows the email, Unsubscribe button (or "You've been
  unsubscribed" when arriving from a one-click link `?done=1`), resubscribe. Uses
  `unsubscribeByToken` / `resubscribeByToken` from `@/lib/email/tracking`.
- **Campaigns**: list (cards with color, status, date range, type, # events, registrations,
  attendance rate, budget), create/edit (name, type, status, dates, goal, budget, color,
  utm_campaign, owner, description), detail page: KPIs (events, registrations, attended,
  show-up rate, emails sent, open/click rate of broadcasts linked to the campaign, contacts
  attributed via utm, cost per registration = budget/registrations), events list (link new
  event to campaign), broadcasts list, contacts tab (audience `{type:"campaign"}` preview).

## 3. Email: templates, broadcasts, outbox (module C)

Routes: `/emails` (tabs: Broadcasts, Templates, Outbox), `/emails/templates/new`,
`/emails/templates/[id]`, `/emails/broadcasts/new`, `/emails/broadcasts/[id]`, `/emails/outbox/[id]`.

- **Editor** (shared component `src/components/email/email-editor.tsx`): TipTap v3 with
  StarterKit, Link, Image (by URL), TextAlign, Placeholder; toolbar (headings, bold, italic,
  underline, strike, lists, quote, divider, align, link, image, **button** (inserts
  `<a data-button href="…">Label</a>` in its own paragraph – implement as a custom node or
  mark that keeps `data-button` and `data-color` attributes), **merge tag** insert menu from
  `MERGE_TAG_GROUPS` (inserts `{{key}}` text; optionally render as chips), undo/redo.
  Output `contentJson` + `contentHtml`. Subject + preheader inputs with merge-tag insert.
  **Preview** pane: desktop/mobile width toggle rendering `renderEmailLayout(inlineEmailStyles(applyMergeTags(html, sampleMergeContext())))`
  in an `iframe srcDoc`; "Preview as contact" picker. **Send test** to the current user's
  email (`sendEmail({to, kind:"test", silent:true, track:false})`).
- **Templates**: list (name, category, updated, system badge), create/edit/duplicate/delete
  (system templates can be edited and "reset to default" but not deleted).
- **Broadcasts**: list with status, audience summary, scheduled/sent time, recipients, open
  & click rates. Compose: name, campaign (optional), audience builder (`Audience`: all
  subscribed contacts / smart view / tags any|all / event attendees by status / campaign /
  filter builder) with **live recipient count** (`countAudience`), subject/preheader/body
  (editor, start from template or blank), send test, **Send now** or **Schedule** (date/time
  in workspace tz) → status `scheduled` and enqueue job `broadcast.send` with `runAt`
  (dedupe `broadcast:<id>`); cancel scheduled. Implement the `broadcast.send` handler in
  `src/lib/email/broadcasts.ts` (resumable, batches of ~50, `sendEmail({kind:"broadcast",
  broadcastId, marketing:true})`, re-enqueue itself if more remain, set status sent/sentAt/
  recipientCount). Report page: KPIs (recipients, delivered, opens, clicks, unsubscribes,
  failed) + recipients table with per-recipient status/opened/clicked + top clicked links (from `email_events`).
- **Outbox**: all messages (filters: kind, status, search by email/subject), detail view
  rendering the HTML in an iframe with metadata (status, provider, error, opens, clicks, events).
  Banner when provider is `outbox` explaining emails are simulated + link to settings.

## 4. Automations (module D)

Routes: `/automations`, `/automations/new`, `/automations/[id]` (builder + runs + logs).

- **Engine** in `src/lib/automations/engine.ts` (replace the stub):
  `automation.trigger` handler: find `active` automations with matching `trigger.type` and
  config (tagId, stage, eventId, campaignId (event belongs to campaign), bookingPageId,
  outcome); skip if contact already has an active/waiting run for that automation unless
  `allowReentry`; also skip re-enrolment of completed runs unless allowReentry. Create run
  (context from trigger) and enqueue `automation.step` {runId}.
  `automation.step` handler executes steps sequentially from `currentStep` until a wait:
  `send_email` (template → `sendEmail({kind:"automation", automationId, contactId, eventId/attendeeId from context, marketing:true})`),
  `wait` (enqueue next step at now+duration, status `waiting`), `wait_until_event`
  (anchor start/end of `context.eventId` + offset; if already past, continue immediately),
  `condition` (`buildContactWhere` on this contact and optional attendance statuses for
  context attendee; if not matching → status `exited`), `add_tag`/`remove_tag`, `set_stage`
  (`changeStage`), `create_task`, `notify_team` (`notifyUsers`), `webhook` (POST JSON).
  Log each step to `automation_logs`; on error set run `failed` with lastError. Pausing an
  automation stops runs from advancing (step handler checks status; paused → reschedule
  check in 1h or mark cancelled on delete).
  Add `"manual"` enrolment: from the automation page pick contacts or a smart view to enroll.
- **Builder UI**: name/description, trigger picker (type + config selectors: tag, stage,
  event, campaign, booking page, outcome), vertical step list (add between, reorder with
  @dnd-kit, edit in a side sheet, delete), status toggle (draft/active/paused), allow
  re-entry toggle. Stats: enrolled, active, completed, exited/failed; Runs tab (contact,
  status, current step, next run, started) with cancel; Logs tab.
- **Recipes** ("Start from a recipe" on /automations/new): Event reminder & follow-up
  sequence (event_registered → wait_until_event start −1d → email → wait_until_event end
  +2h → condition attended → email), No-show recovery (event_no_show → email → wait 2d →
  task for owner), Welcome series (contact_created → email → wait 2d → email), Abandoned
  registration (lead_potential → wait 1h → condition lead_status is potential → email "finish
  your registration"), Meeting no-show follow-up (meeting_outcome=no_show → email with booking link),
  Hot lead alert (email_clicked → notify team + add tag "hot"). Recipes create placeholder
  templates if needed.

## 5. Scheduling: booking pages & meetings (module E) – iClosed-inspired

Routes: `/scheduling`, `/scheduling/new`, `/scheduling/[id]` (tabs: Setup, Form &
qualification, Availability, Notifications, Share), `/meetings`; public `/book/[slug]`,
`/embed/book/[slug]`; settings `/settings/profile` holds personal weekly availability (module F).

- **Slot engine** `src/lib/scheduling/slots.ts` (+ unit tests): for a booking page and date
  range compute available start times: host weekly availability (`users.availability`,
  default Mon–Fri 09:00–17:00 in the host's timezone or workspace tz) minus date overrides,
  minus existing non-cancelled events/meetings of that host (with buffers before/after),
  respecting minNotice, maxDaysAhead, slotIncrement, duration, dailyLimit. Multi-host pages:
  union of hosts' slots; on booking pick a host free at that time via **round robin** (host
  with the oldest last assigned meeting from this page). Return UTC ISO strings.
- **Booking page editor**: title, slug, description, duration, location type/URL, hosts
  (multi-select users), buffers, min notice, max days ahead, increment, daily limit, color,
  campaign, active toggle; **questions** builder (shared FormQuestion builder component from
  module B is fine to duplicate locally); **disqualification rules** (RuleGroup[]: IF group of
  conditions on question answers joined by AND/OR, groups OR'ed) + disqualify message and
  optional redirect URL; confirmation message / redirect URL; notifications (`EventNotifications`
  defaults with reminders 24h & 1h and a meeting follow-up). Share tab: link, embed snippets
  (inline iframe and popup button script), QR code (`qrcode` package → data URL).
- **Public booking flow** `/book/[slug]`: step 1 name + email (+ phone) → upsert contact
  (source `booking`), lead capture `partial`, lead status `potential`, trigger
  `lead_potential`; step 2 questions → evaluate disqualification rules server-side →
  disqualified: lead capture `disqualified`, lead status `disqualified`, show message (and
  redirect after 2s if URL set) – don't reveal "disqualified"; else `qualified` → step 3
  calendar (month view of days with availability, then time slots in the visitor's timezone,
  timezone selector) → confirm → create meeting event (kind `meeting`, title
  "<page title> with <contact name>", host, bookingPageId, campaignId, notifications copied
  from page, status scheduled, location from page) + `registerForEvent({source:"booking"})`
  (which emails, schedules reminders, logs, triggers `meeting_booked`) → lead capture
  `completed` → confirmation screen or redirect. Re-check slot availability at confirm time.
  Record page views. Honeypot. UTM capture. `/embed/book/[slug]` without chrome.
- **Reschedule**: from `/m/[token]` for meetings ("Reschedule" → pick a new slot of the same
  page → update event times, `replanEventNotifications`, log activity).
- **Meetings** `/meetings`: tabs Upcoming / Past / Needs outcome / Cancelled; filters host,
  booking page, date range; row: time, contact, host, page, status/outcome badges, answers
  popover. **Log outcome** dialog (outcome, objection, notes, deal value; for follow_up offer
  "Create follow-up task") → `setMeetingOutcome`. Cancel meeting (staff) → `cancelRegistration`.
  KPIs on top: booked (period), show-up rate, closing rate, won value, pending outcomes.
  **Potential leads** tab: contacts with lead status potential/qualified from booking/
  registration lead captures that never completed (iClosed "Appointment setting") with
  answers, created time, and quick actions (email, create task, open contact).

## 6. Calendar, dashboard, reports, settings (module F)

Routes: `/calendar`, `/dashboard`, `/reports`, `/settings` (+ `/settings/profile`,
`/settings/email`, `/settings/team`, `/settings/pipeline`, `/settings/fields`,
`/settings/tags`, `/settings/integrations`), `/api/ics/feed/[token]`.

- **Calendar** `/calendar`: FullCalendar (dayGrid month, timeGrid week/day, list) themed with
  CSS vars; sources: events (color by event/campaign color; meetings in sky), campaigns
  (all-day background spans), scheduled broadcasts, tasks with due dates (if not completed).
  Toolbar: view switcher, today/prev/next, filters (types, campaign, host "mine/all"). Event
  click → popover (title, time, location, registered/attended counts, buttons: open, check-in,
  attendees). Click/select empty slot → quick-create dialog (title, type, times) → creates a
  draft/scheduled event. Drag/resize event → update times (confirm dialog for events with
  attendees: "Notify/replan reminders" → `replanEventNotifications`). Data via a route
  handler or server action returning events for the visible range. "Subscribe" button
  showing the personal ICS feed URL (`users.calendarToken`, generate if missing).
- **Dashboard** `/dashboard`: greeting, date range selector (7/30/90 days) with previous-period
  deltas, KPI row (new contacts, registrations, show-up rate, emails delivered + open rate,
  meetings booked, pipeline value won), **funnel** (page views → potential leads → registrations/
  bookings → attended) chart, registrations & bookings over time (area/bar chart), upcoming
  events & meetings (next 7 days), **Needs attention** (past events without attendance, meetings
  without outcome, overdue tasks, failed emails/jobs), recent activity feed, top campaigns.
  `?welcome=1` shows a getting-started checklist card (set sender email, create event, publish
  booking page, import contacts, create automation) with completion state.
- **Reports** `/reports`: tabs Events (per-event table: registrations, attended, no-show,
  show-up rate, page views, conversion), Email (per broadcast & per template: delivered,
  opens, clicks, unsubscribes), Campaigns (KPIs per campaign incl. cost per registration),
  Meetings (per host: booked, show-up, closing rate, won value; outcomes & objections
  breakdown charts), Sources (contacts by source & utm_source/utm_campaign).
- **Settings**: General (workspace name, timezone, brand color, logo URL, address, currency,
  week start), Email sending (provider outbox/Resend/SMTP, from name/email, reply-to,
  tracking toggle, Resend key / SMTP creds stored with `encryptSecret`, "Send test email",
  DNS hint), Team (users list, roles, invite by email → creates `invites` row + shows copyable
  link `/invite/<token>` and emails it, deactivate/reactivate, change role; owner-only for
  owners), Profile (name, email, password change, timezone, color, **weekly availability**
  editor + date overrides, calendar feed URL), Pipeline stages (add/rename/reorder/color/
  category, can't delete stage in use), Custom fields (CRUD `custom_field_defs`), Tags
  (CRUD with colors + usage counts, merge), Integrations (webhooks CRUD with event selection,
  secret reveal, test ping, last status; API keys create/revoke with one-time display; cron
  status: last job heartbeat & pending jobs; danger zone: delete sample data). Admin-only
  except Profile.
- **ICS feed** `/api/ics/feed/[token]`: the user's events (host or all if admin) & meetings for
  −30…+180 days.

## 7. Cross-cutting

- Sample data (`src/lib/sample-data.ts`): ~60 contacts with tags/stages/UTMs, 3 campaigns,
  6 events (past with attendance marked, upcoming with registrations), 2 booking pages with
  meetings & outcomes, templates, 2 broadcasts (one sent with simulated opens/clicks),
  automations from recipes, tasks, activities. Mark sample rows so they can be deleted
  (tag "Sample data" on contacts; names prefixed in a recognisable way are not needed).
- REST API (later): `/api/v1/contacts` (GET list/search, POST upsert), `/api/v1/events`,
  `/api/v1/events/[id]/registrations` (POST register) with `Authorization: Bearer <api key>`.
