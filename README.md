# Relay — CRM & marketing

Contacts, campaigns, events with registrations & attendance, email templates / broadcasts /
automations, a built-in calendar and iClosed-style booking pages — in one Next.js app.

See [`docs/SPEC.md`](docs/SPEC.md) for the product spec and [`AGENTS.md`](AGENTS.md) for the engineering guide.

## Local development

```bash
npm install
npm run dev
```

Open http://localhost:3000 and create your workspace. Locally the app uses an embedded
Postgres (PGlite) stored in `.data/` — no database setup needed.
