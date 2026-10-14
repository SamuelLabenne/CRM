# Deploying Relay

Relay runs anywhere Next.js 16 runs, with any Postgres database. The production setup used for
this project is **Vercel** (app, region `syd1`) + **Supabase** (Postgres, `ap-southeast-2`).

## Environment variables

| Name | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes (prod) | Postgres connection string. On Supabase use the **transaction pooler** (port 6543). Without it the app uses an embedded PGlite database in `.data/` (local dev only). |
| `APP_SECRET` | yes (prod) | ≥ 32 random characters. Signs sessions & links, encrypts stored API keys/SMTP passwords. Never change it after launch (stored secrets become unreadable). |
| `CRON_SECRET` | yes (prod) | Protects `/api/cron` (the background job runner). |
| `SETUP_CODE` | recommended | Required on the first-run `/setup` page so only you can claim the workspace. Unused after setup. |
| `APP_URL` | optional | Public base URL used in emails (defaults to the Vercel production URL). Set it when you add a custom domain. |
| `RESEND_API_KEY` | optional | Resend key. When set, Resend is the default sending method (a key saved in Settings → Email sending takes precedence). |
| `EMAIL_FROM` | with Resend | Default sender address on a domain verified in Resend (e.g. `hello@ksaraevents.com`). Used at setup; editable in Settings. |
| `RESEND_WEBHOOK_SECRET` | with Resend | Signing secret of the Resend webhook pointing at `/api/webhooks/resend` (events: bounced, complained, failed, suppressed). Hard bounces and spam complaints stop further email to that contact. |

## Database migrations

Migrations live in `./drizzle` and are generated from `src/lib/db/schema.ts` with
`npm run db:generate`. `npm run build` applies pending migrations automatically when
`DATABASE_URL` is set (`scripts/migrate.ts`); set `SKIP_MIGRATIONS=1` to skip.

## Background jobs (emails, reminders, automations)

All delayed work goes through the `jobs` table and is processed by `GET/POST /api/cron`
(header `Authorization: Bearer $CRON_SECRET`). Triggers, in order of importance:

1. **Supabase pg_cron** – calls `/api/cron` every minute (see SQL below).
2. **Vercel cron** – once a day as a safety net (`vercel.json`; Hobby plans only allow daily crons).
3. While anyone has the app open, the browser pings `/api/jobs/tick` once a minute.

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;
select cron.schedule('relay-jobs', '* * * * *', $$
  select net.http_post(
    url := 'https://<your-domain>/api/cron',
    headers := jsonb_build_object('Authorization', 'Bearer <CRON_SECRET>'),
    timeout_milliseconds := 55000
  );
$$);
```

## Email sending

**Production is connected to Resend** (domain `ksaraevents.com`, API key `relay-crm-production`,
webhook → `/api/webhooks/resend`). Without `RESEND_API_KEY`, emails are **simulated** (visible in Emails → Outbox, nothing leaves the
app). To send for real go to **Settings → Email sending** and choose:

- **Resend** – create an API key at resend.com and verify your sending domain (SPF/DKIM DNS
  records). Without a verified domain Resend only delivers to your own address.
- **SMTP** – any provider (Google Workspace, Microsoft 365, Postmark, Mailgun…).

## Deploying updates

```bash
npx vercel deploy --prod
```

Or connect the GitHub repository in Vercel → Project → Settings → Git so every push to
`main` deploys automatically.
