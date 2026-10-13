import { beforeAll, describe, expect, it } from "vitest";
import { setupTestDb } from "@/test/setup-db";

await setupTestDb();
const { NOW, TZ, seedWorld } = await import("./test-utils");
const { resolveRange, dayKeys } = await import("./range");
const dash = await import("./dashboard");
const metrics = await import("./metrics");

/** Fails when any number in the structure is NaN/Infinity. */
function assertNoNaN(value: unknown, path = "root") {
  if (typeof value === "number") expect(Number.isFinite(value), `${path} is ${value}`).toBe(true);
  else if (Array.isArray(value)) value.forEach((v, i) => assertNoNaN(v, `${path}[${i}]`));
  else if (value && typeof value === "object" && !(value instanceof Date)) {
    for (const [k, v] of Object.entries(value)) assertNoNaN(v, `${path}.${k}`);
  }
}

describe("range & metric helpers", () => {
  it("builds rolling day ranges in the workspace timezone with a previous period", () => {
    const r = resolveRange("7", "UTC", NOW);
    expect(r.from.toISOString()).toBe("2026-10-07T00:00:00.000Z");
    expect(r.to.toISOString()).toBe("2026-10-14T00:00:00.000Z");
    expect(r.prevFrom?.toISOString()).toBe("2026-09-30T00:00:00.000Z");
    expect(r.prevTo?.toISOString()).toBe("2026-10-07T00:00:00.000Z");
    expect(dayKeys(r)).toEqual(["2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10", "2026-10-11", "2026-10-12", "2026-10-13"]);
    // Perth is UTC+8: 06:00Z is 14:00 on the 13th there.
    const perth = resolveRange("7", "Australia/Perth", NOW);
    expect(perth.to.toISOString()).toBe("2026-10-13T16:00:00.000Z");
    expect(dayKeys(perth).at(-1)).toBe("2026-10-13");
  });

  it("never returns NaN/Infinity from ratios and deltas", () => {
    expect(metrics.ratio(1, 0)).toBeNull();
    expect(metrics.ratio(null, 3)).toBeNull();
    expect(metrics.showUpRate(0, 0)).toBeNull();
    expect(metrics.showUpRate(3, 1)).toBe(0.75);
    expect(metrics.relativeDelta(5, 0)).toBeNull();
    expect(metrics.relativeDelta(0, 0)).toBe(0);
    expect(metrics.relativeDelta(6, 4)).toBe(0.5);
    expect(metrics.rateDelta(null, 0.5)).toBeNull();
  });
});

describe("empty workspace", () => {
  const range = resolveRange("30", TZ, NOW);

  it("returns zeros and null rates, never NaN", async () => {
    const kpis = await dash.getDashboardKpis(range, NOW);
    expect(kpis.current).toMatchObject({ newContacts: 0, registrations: 0, emailsDelivered: 0, meetingsBooked: 0, wonValue: 0 });
    expect(kpis.current.showUpRate).toBeNull();
    expect(kpis.current.openRate).toBeNull();
    assertNoNaN(kpis);

    const funnel = await dash.getFunnel(range);
    expect(funnel.map((s) => s.value)).toEqual([0, 0, 0, 0]);
    expect(funnel.every((s) => s.rate === null)).toBe(true);

    const series = await dash.getRegistrationSeries(range);
    expect(series).toHaveLength(30);
    expect(series.every((p) => p.registrations === 0 && p.bookings === 0)).toBe(true);

    expect(await dash.getUpcoming(NOW)).toEqual([]);
    expect(await dash.getRecentActivity()).toEqual([]);
    expect(await dash.getTopCampaigns(range)).toEqual([]);
    const attention = await dash.getNeedsAttention("00000000-0000-0000-0000-000000000000", NOW);
    expect(attention.total).toBe(0);
    assertNoNaN(attention);

    const onboarding = await dash.getOnboardingState();
    expect(onboarding.fresh).toBe(true);
    expect(onboarding.done).toBe(0);
    expect(onboarding.items.map((i) => i.key)).toEqual(["email", "event", "booking", "contacts", "automation", "team"]);
  });
});

describe("workspace with data", () => {
  let w: Awaited<ReturnType<typeof seedWorld>>;
  beforeAll(async () => {
    w = await seedWorld();
  });
  const range = resolveRange("30", TZ, NOW);

  it("computes KPIs with previous-period deltas", async () => {
    const k = await dash.getDashboardKpis(range, NOW);
    expect(k.current.newContacts).toBe(3);
    expect(k.previous?.newContacts).toBe(1);
    expect(k.deltas.newContacts).toBe(2);

    // registrations: Spring Webinar (3 active, cancelled excluded) + Autumn Workshop (1; waitlisted excluded)
    expect(k.current.registrations).toBe(4);
    expect(k.previous?.registrations).toBe(2);
    expect(k.deltas.registrations).toBe(1);

    // bookings: 4 non-cancelled meeting invitees
    expect(k.current.meetingsBooked).toBe(4);
    expect(k.deltas.meetingsBooked).toBeNull(); // previous period had none

    // show-up = attended / (attended + no_show) for events & meetings that already ended in the period
    expect(k.current.attended).toBe(3);
    expect(k.current.noShow).toBe(1);
    expect(k.current.showUpRate).toBe(0.75);
    expect(k.previous?.showUpRate).toBe(0.5);
    expect(k.deltas.showUpRate).toBeCloseTo(0.25);

    // emails: 3 delivered + 1 broadcast simulated (m_7) = 4; test + failed excluded; opened = 2
    expect(k.current.emailsDelivered).toBe(4);
    expect(k.current.emailsOpened).toBe(2);
    expect(k.current.openRate).toBe(0.5);
    expect(k.previous?.emailsDelivered).toBe(1);

    expect(k.current.wonValue).toBe(5000);
    expect(k.current.wonCount).toBe(1);
    expect(k.deltas.wonValue).toBeNull();
    assertNoNaN(k);
  });

  it("builds the funnel from page views to attendance", async () => {
    const f = await dash.getFunnel(range);
    expect(f.map((s) => s.value)).toEqual([8, 6, 7, 3]);
    expect(f[1].rate).toBe(0.75);
    expect(f[2].rate).toBeCloseTo(7 / 6);
    expect(f[3].rate).toBeCloseTo(3 / 7);
  });

  it("buckets registrations and bookings per day", async () => {
    const s = await dash.getRegistrationSeries(range);
    expect(s).toHaveLength(30);
    const by = Object.fromEntries(s.map((p) => [p.date, p]));
    expect(by["2026-10-02"]).toMatchObject({ registrations: 1, bookings: 1 });
    expect(by["2026-10-06"]).toMatchObject({ registrations: 1, bookings: 0 });
    expect(by["2026-10-11"]).toMatchObject({ registrations: 0, bookings: 1 });
    expect(s.reduce((n, p) => n + p.registrations, 0)).toBe(4);
    expect(s.reduce((n, p) => n + p.bookings, 0)).toBe(4);
  });

  it("buckets days in the workspace timezone", async () => {
    // 2026-10-02T03:00Z is 11:00 on the 2nd in Perth, but a registration at 20:00Z lands on the next day there.
    const perth = resolveRange("30", "Australia/Perth", NOW);
    const s = await dash.getRegistrationSeries(perth);
    expect(s.reduce((n, p) => n + p.registrations + p.bookings, 0)).toBe(8);
  });

  it("lists upcoming scheduled events and meetings for the next 7 days", async () => {
    const up = await dash.getUpcoming(NOW);
    expect(up.map((u) => u.title)).toEqual(["Intro call with Cy Test (2)", "Autumn Workshop"]);
    expect(up[0]).toMatchObject({ kind: "meeting", contactName: "Cy Test", registered: 1 });
    expect(up[1]).toMatchObject({ kind: "event", registered: 1, capacity: 10, campaignName: "Spring Webinars" });
  });

  it("flags what needs attention", async () => {
    const a = await dash.getNeedsAttention(w.owner.id, NOW);
    expect(a.eventsWithoutAttendance.total).toBe(1);
    expect(a.eventsWithoutAttendance.items[0]).toMatchObject({ id: w.e1.id, unmarked: 1 });
    expect(a.meetingsWithoutOutcome.total).toBe(1);
    expect(a.meetingsWithoutOutcome.items[0]).toMatchObject({ id: w.m3.id, contactName: "Bob Test" });
    expect(a.overdueTasks.total).toBe(2); // mine + unassigned
    expect(a.failedMessages).toBe(1);
    expect(a.failedJobs).toBe(1);
    expect(a.total).toBe(6);
  });

  it("returns recent activity with contact names and top campaigns by registrations", async () => {
    const act = await dash.getRecentActivity(10);
    expect(act.map((a) => a.title)).toEqual(["Called back", "System thing", "Registered for “Spring Webinar”"]);
    expect(act[0].contactName).toBe("Bob Test");
    expect(act.find((a) => a.title === "System thing")?.contactName).toBeNull();

    const top = await dash.getTopCampaigns(range);
    expect(top).toEqual([{ id: w.campA.id, name: "Spring Webinars", color: "#6366f1", registrations: 4, events: 2 }]);
  });

  it("derives onboarding state from data", async () => {
    const o = await dash.getOnboardingState();
    expect(o.fresh).toBe(false);
    const done = Object.fromEntries(o.items.map((i) => [i.key, i.done]));
    expect(done).toEqual({ email: false, event: true, booking: true, contacts: true, automation: false, team: true });
    expect(o.done).toBe(4);
  });
});
