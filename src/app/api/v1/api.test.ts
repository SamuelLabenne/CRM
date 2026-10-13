import { describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { setupTestDb } from "@/test/setup-db";

vi.mock("@/lib/jobs/kick", () => ({ kickJobs: () => {} }));

const { db } = await setupTestDb();
const s = await import("@/lib/db/schema");
const { createApiKey } = await import("@/lib/api-keys");
const { DEFAULT_EVENT_NOTIFICATIONS } = await import("@/lib/types");
const contactsRoute = await import("./contacts/route");
const eventsRoute = await import("./events/route");
const regRoute = await import("./events/[id]/registrations/route");

const { key } = await createApiKey({ name: "test" });

function req(path: string, init: { method?: string; body?: unknown; auth?: string | null } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  const auth = init.auth === undefined ? `Bearer ${key}` : init.auth;
  if (auth) headers.authorization = auth;
  return new NextRequest(`http://localhost:3000${path}`, {
    method: init.method ?? "GET",
    headers,
    body: init.body === undefined ? undefined : typeof init.body === "string" ? init.body : JSON.stringify(init.body),
  });
}

async function makeEvent(overrides: Partial<typeof s.events.$inferInsert> = {}) {
  const start = new Date(Date.now() + 3 * 864e5);
  const [e] = await db
    .insert(s.events)
    .values({ title: "API event", startsAt: start, endsAt: new Date(start.getTime() + 36e5), notifications: DEFAULT_EVENT_NOTIFICATIONS, ...overrides })
    .returning();
  return e;
}

const regCtx = (id: string) => ({ params: Promise.resolve({ id }) }) as never;

describe("API auth", () => {
  it("rejects missing, malformed and unknown keys with a JSON 401", async () => {
    for (const auth of [null, "Bearer nope", "Basic abc", `Bearer rly_${"x".repeat(32)}`]) {
      const res = await contactsRoute.GET(req("/api/v1/contacts", { auth }), {} as never);
      expect(res.status).toBe(401);
      expect((await res.json()).error.code).toBe("unauthorized");
    }
  });
});

describe("/api/v1/contacts", () => {
  it("creates (201), then upserts the same email (200) with source api and tags", async () => {
    const res = await contactsRoute.POST(
      req("/api/v1/contacts", { method: "POST", body: { email: "Ada@Example.com", firstName: "Ada", lastName: "Lovelace", company: "Engines", tags: ["Newsletter", "VIP"] } }),
      {} as never,
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.created).toBe(true);
    expect(body.data).toMatchObject({ email: "ada@example.com", source: "api", firstName: "Ada" });

    const again = await contactsRoute.POST(req("/api/v1/contacts", { method: "POST", body: { email: "ada@example.com", jobTitle: "Mathematician" } }), {} as never);
    expect(again.status).toBe(200);
    const b2 = await again.json();
    expect(b2.created).toBe(false);
    expect(b2.data.id).toBe(body.data.id);
    expect(b2.data.company).toBe("Engines");
    const links = await db.select().from(s.contactTags).where(eq(s.contactTags.contactId, body.data.id));
    expect(links).toHaveLength(2);
  });

  it("validates input with JSON errors", async () => {
    const empty = await contactsRoute.POST(req("/api/v1/contacts", { method: "POST", body: {} }), {} as never);
    expect(empty.status).toBe(400);
    expect((await empty.json()).error.code).toBe("invalid_request");
    const badEmail = await contactsRoute.POST(req("/api/v1/contacts", { method: "POST", body: { email: "nope" } }), {} as never);
    expect(badEmail.status).toBe(400);
    const badJson = await contactsRoute.POST(req("/api/v1/contacts", { method: "POST", body: "{not json" }), {} as never);
    expect(badJson.status).toBe(400);
    expect((await badJson.json()).error.code).toBe("invalid_json");
    const badStage = await contactsRoute.POST(req("/api/v1/contacts", { method: "POST", body: { email: "s@x.io", stage: "nope" } }), {} as never);
    expect(badStage.status).toBe(422);
  });

  it("lists and searches with limit/offset", async () => {
    for (const n of ["bob", "carol", "dave"]) {
      await contactsRoute.POST(req("/api/v1/contacts", { method: "POST", body: { email: `${n}@example.com`, firstName: n } }), {} as never);
    }
    const all = await (await contactsRoute.GET(req("/api/v1/contacts?limit=2"), {} as never)).json();
    expect(all.data).toHaveLength(2);
    expect(all.total).toBeGreaterThanOrEqual(4);
    const q = await (await contactsRoute.GET(req("/api/v1/contacts?q=carol"), {} as never)).json();
    expect(q.data.map((c: { email: string }) => c.email)).toEqual(["carol@example.com"]);
    const bad = await contactsRoute.GET(req("/api/v1/contacts?limit=1000"), {} as never);
    expect(bad.status).toBe(400);
  });
});

describe("/api/v1/events", () => {
  it("lists upcoming scheduled events with seats left", async () => {
    const open = await makeEvent({ title: "Open workshop", capacity: 5, isPublic: true, slug: "open-workshop" });
    await makeEvent({ title: "Draft", status: "draft" });
    await makeEvent({ title: "Past", startsAt: new Date(Date.now() - 864e5 * 3), endsAt: new Date(Date.now() - 864e5 * 3 + 36e5) });
    await makeEvent({ title: "Meeting", kind: "meeting" });
    const res = await eventsRoute.GET(req("/api/v1/events"), {} as never);
    const body = await res.json();
    expect(body.data.map((e: { title: string }) => e.title)).toEqual(["Open workshop"]);
    expect(body.data[0]).toMatchObject({ id: open.id, capacity: 5, registered: 0, spotsLeft: 5 });
    expect(body.data[0].publicUrl).toMatch(/\/e\/open-workshop$/);
    expect((await eventsRoute.GET(req("/api/v1/events", { auth: null }), {} as never)).status).toBe(401);
  });
});

describe("/api/v1/events/[id]/registrations", () => {
  it("registers a new person via the API, then reports already-registered", async () => {
    const e = await makeEvent({ capacity: 10 });
    const res = await regRoute.POST(req(`/api/v1/events/${e.id}/registrations`, { method: "POST", body: { email: "reg@example.com", firstName: "Reg", lastName: "Istrant", answers: { q1: "hello" } } }), regCtx(e.id));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data).toMatchObject({ eventId: e.id, status: "registered", waitlisted: false, alreadyRegistered: false });
    expect(body.data.contact).toMatchObject({ email: "reg@example.com", source: "api" });
    const [att] = await db.select().from(s.eventAttendees).where(eq(s.eventAttendees.id, body.data.registrationId));
    expect(att).toMatchObject({ source: "api", answers: { q1: "hello" } });

    const again = await regRoute.POST(req(`/api/v1/events/${e.id}/registrations`, { method: "POST", body: { email: "reg@example.com" } }), regCtx(e.id));
    expect(again.status).toBe(200);
    expect((await again.json()).data.alreadyRegistered).toBe(true);
  });

  it("returns 409 when full, 422 when not open, 404 for unknown events, 400 for bad input", async () => {
    const full = await makeEvent({ capacity: 1 });
    expect((await regRoute.POST(req(`/api/v1/events/${full.id}/registrations`, { method: "POST", body: { email: "one@example.com" } }), regCtx(full.id))).status).toBe(201);
    const second = await regRoute.POST(req(`/api/v1/events/${full.id}/registrations`, { method: "POST", body: { email: "two@example.com" } }), regCtx(full.id));
    expect(second.status).toBe(409);
    expect((await second.json()).error.code).toBe("event_full");

    const draft = await makeEvent({ status: "draft" });
    expect((await regRoute.POST(req(`/api/v1/events/${draft.id}/registrations`, { method: "POST", body: { email: "d@example.com" } }), regCtx(draft.id))).status).toBe(422);
    const closed = await makeEvent({ registrationOpen: false });
    expect((await regRoute.POST(req(`/api/v1/events/${closed.id}/registrations`, { method: "POST", body: { email: "c@example.com" } }), regCtx(closed.id))).status).toBe(422);

    const missing = "00000000-0000-4000-8000-000000000000";
    expect((await regRoute.POST(req(`/api/v1/events/${missing}/registrations`, { method: "POST", body: { email: "m@example.com" } }), regCtx(missing))).status).toBe(404);
    expect((await regRoute.POST(req(`/api/v1/events/not-a-uuid/registrations`, { method: "POST", body: { email: "m@example.com" } }), regCtx("not-a-uuid"))).status).toBe(404);
    expect((await regRoute.POST(req(`/api/v1/events/${full.id}/registrations`, { method: "POST", body: { email: "bad" } }), regCtx(full.id))).status).toBe(400);
  });
});
