import { eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  activities,
  automations,
  bookingPages,
  broadcasts,
  campaigns,
  contacts,
  emailTemplates,
  eventAttendees,
  events,
  leadCaptures,
  messages,
  emailEvents,
  pageViews,
  savedViews,
  settings,
  tasks,
  tags,
  users,
} from "@/lib/db/schema";
import { addTagToContact, changeStage, ensureTag, upsertContact } from "@/lib/contacts";
import { logActivity } from "@/lib/activity";
import { markAttendance, registerForEvent, setMeetingOutcome, setRsvp } from "@/lib/events/registration";
import { sha256 } from "@/lib/crypto";
import { getSetting } from "@/lib/settings";
import { DEFAULT_EVENT_NOTIFICATIONS, type AutomationStep, type EventNotifications, type FormQuestion, type MeetingOutcome } from "@/lib/types";

// Realistic demo data so a fresh workspace can be explored. Every created row id
// is recorded in the "sampleData" setting so it can be deleted again from Settings.

const FIRST = ["Olivia", "Liam", "Charlotte", "Noah", "Amelia", "Jack", "Isla", "William", "Mia", "Oliver", "Ava", "Henry", "Grace", "Lucas", "Chloe", "Thomas", "Zoe", "James", "Ella", "Leo", "Harper", "Ethan", "Sophie", "Archie", "Ruby", "Mason", "Lily", "Hugo", "Evie", "Max", "Aria", "Lachlan", "Matilda", "Kai", "Willow", "Finn", "Ivy", "Oscar", "Sienna", "Arlo", "Priya", "Wei", "Aisha", "Mateo", "Yuki", "Fatima", "Diego", "Hana", "Ravi", "Elena", "Sam", "Nina", "Tariq", "Lena", "Marco", "Freya", "Jonah", "Asha", "Theo", "Maya"];
const LAST = ["Smith", "Nguyen", "Williams", "Brown", "Chen", "Wilson", "Taylor", "Patel", "Martin", "Anderson", "Thompson", "Kelly", "Walker", "Singh", "White", "Harris", "Lee", "Ryan", "King", "Clarke", "Robinson", "Wright", "Mitchell", "Hughes", "Murphy", "Campbell", "Cooper", "Evans", "Lim", "Russo"];
const COMPANIES = ["Northwind Studio", "Bluegum Analytics", "Swan River Dental", "Kookaburra Coffee Co.", "Coastal Physio", "Brightside Accounting", "Indian Ocean Realty", "Fremantle Fitness", "Banksia Legal", "Outback Outfitters", "Harbour Design", "Pinnacle Coaching", "Saltwater Media", "Redgum Builders", "Lumen Skincare", "Cobalt Software", "Wattle & Co", "Ironbark Advisory", "Sunset Yoga", "Peak Performance Labs"];
const TITLES = ["Founder", "Marketing Manager", "Head of Growth", "Operations Lead", "CEO", "Sales Director", "Practice Owner", "Community Manager", "Product Lead", "Consultant"];
const CITIES = [["Perth", "Australia"], ["Fremantle", "Australia"], ["Sydney", "Australia"], ["Melbourne", "Australia"], ["Brisbane", "Australia"], ["Auckland", "New Zealand"], ["Singapore", "Singapore"], ["London", "United Kingdom"]] as const;

/** Small deterministic PRNG so the demo looks the same every time. */
function rng(seed = 42) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const DAY = 864e5;
const HOUR = 36e5;

export async function loadSampleData(ownerId: string): Promise<void> {
  const rand = rng(7);
  const pick = <T,>(arr: readonly T[]) => arr[Math.floor(rand() * arr.length)];
  const chance = (p: number) => rand() < p;
  const ids: Record<string, string[]> = {};
  const track = (table: string, id: string) => (ids[table] ??= []).push(id);
  const ws = await getSetting("workspace");
  const now = Date.now();
  const at = (days: number, hour = 10, minute = 0) => {
    const d = new Date(now + days * DAY);
    d.setUTCHours(hour - 8, minute, 0, 0); // hours given in AWST (UTC+8) for a Perth-flavoured demo
    return d;
  };

  // ── Tags ────────────────────────────────────────────────────────────────
  const tagDefs: [string, string][] = [
    ["Sample data", "#94a3b8"],
    ["VIP", "#f59e0b"],
    ["Newsletter", "#0ea5e9"],
    ["Webinar attendee", "#8b5cf6"],
    ["Partner", "#10b981"],
    ["Hot lead", "#ef4444"],
  ];
  const tagByName: Record<string, string> = {};
  for (const [name, color] of tagDefs) {
    const t = await ensureTag(name, color);
    tagByName[name] = t.id;
    track("tags", t.id);
  }

  // ── Campaigns ───────────────────────────────────────────────────────────
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const [spring] = await db
    .insert(campaigns)
    .values({
      name: "Spring Growth Series 2026",
      description: "A series of practical workshops and webinars for local business owners.",
      type: "event_series",
      status: "active",
      startDate: iso(new Date(now - 35 * DAY)),
      endDate: iso(new Date(now + 30 * DAY)),
      goal: "150 registrations, 60% show-up rate, 10 strategy calls",
      budget: 5000,
      color: "#6366f1",
      utmCampaign: "spring-growth",
      ownerId,
    })
    .returning();
  const [launch] = await db
    .insert(campaigns)
    .values({
      name: "Q4 Product Launch",
      description: "Launch of the new coaching programme: webinar, email sequence and paid social.",
      type: "webinar",
      status: "active",
      startDate: iso(new Date(now - 10 * DAY)),
      endDate: iso(new Date(now + 45 * DAY)),
      goal: "300 webinar sign-ups and 25 sales",
      budget: 8000,
      color: "#ec4899",
      utmCampaign: "q4-launch",
      ownerId,
    })
    .returning();
  const [appreciation] = await db
    .insert(campaigns)
    .values({
      name: "Customer Appreciation Night",
      description: "End-of-year event for customers and partners.",
      type: "conference",
      status: "planned",
      startDate: iso(new Date(now + 30 * DAY)),
      endDate: iso(new Date(now + 42 * DAY)),
      goal: "80% of active customers attend",
      budget: 3000,
      color: "#10b981",
      utmCampaign: "appreciation",
      ownerId,
    })
    .returning();
  for (const c of [spring, launch, appreciation]) track("campaigns", c.id);

  // ── Contacts ────────────────────────────────────────────────────────────
  const stageWeights: [string, number][] = [
    ["new", 0.3],
    ["contacted", 0.2],
    ["engaged", 0.18],
    ["follow_up", 0.1],
    ["customer", 0.17],
    ["lost", 0.05],
  ];
  const pickStage = () => {
    let r = rand();
    for (const [k, w] of stageWeights) {
      if ((r -= w) <= 0) return k;
    }
    return "new";
  };
  const utmOptions = [
    { source: "linkedin", medium: "social", campaign: "spring-growth" },
    { source: "facebook", medium: "paid", campaign: "q4-launch" },
    { source: "google", medium: "cpc", campaign: "q4-launch" },
    { source: "newsletter", medium: "email", campaign: "spring-growth" },
    {},
    {},
  ];
  const contactIds: string[] = [];
  for (let i = 0; i < 60; i++) {
    const first = FIRST[i % FIRST.length];
    const last = pick(LAST);
    const company = chance(0.85) ? pick(COMPANIES) : null;
    const [city, country] = pick(CITIES);
    // RFC 2606 reserved TLD: demo addresses can never reach a real inbox.
    const domain = (company ? company.toLowerCase().replace(/[^a-z]+/g, "") : "mail") + ".example";
    const stage = pickStage();
    const { contact } = await upsertContact(
      {
        firstName: first,
        lastName: last,
        email: `${first}.${last}${i}`.toLowerCase() + `@${domain}`,
        phone: chance(0.6) ? `+61 4${String(10000000 + Math.floor(rand() * 89999999))}` : null,
        company,
        jobTitle: company ? pick(TITLES) : null,
        city,
        country,
        stage,
        ownerId: chance(0.7) ? ownerId : null,
        dealValue: stage === "customer" ? 1500 + Math.floor(rand() * 18) * 500 : stage === "engaged" || stage === "follow_up" ? 1000 + Math.floor(rand() * 10) * 500 : null,
        utm: pick(utmOptions),
        tagIds: [tagByName["Sample data"]],
      },
      { source: pick(["manual", "import", "import", "registration", "booking"] as const), actorId: ownerId },
    );
    contactIds.push(contact.id);
    track("contacts", contact.id);
    if (chance(0.45)) await addTagToContact(contact.id, tagByName["Newsletter"]);
    if (stage === "customer" && chance(0.4)) await addTagToContact(contact.id, tagByName["VIP"]);
    if (chance(0.08)) await addTagToContact(contact.id, tagByName["Partner"]);
    if ((stage === "engaged" || stage === "follow_up") && chance(0.4)) await addTagToContact(contact.id, tagByName["Hot lead"]);
    if (chance(0.25)) {
      await logActivity({
        contactId: contact.id,
        type: "note",
        title: "Note",
        body: pick([
          "Interested in the group coaching programme – asked for pricing.",
          "Met at the Fremantle networking breakfast. Follow up after the webinar.",
          "Prefers email over phone. Busy until end of month.",
          "Referred by an existing customer. Warm lead.",
          "Wants a case study for dental practices before deciding.",
        ]),
        actorId: ownerId,
      });
    }
  }
  // A few unsubscribes for realism.
  await db.update(contacts).set({ emailStatus: "unsubscribed", unsubscribedAt: new Date(now - 5 * DAY) }).where(inArray(contacts.id, contactIds.slice(55, 58)));

  // ── Email templates ────────────────────────────────────────────────────
  const tpl = async (name: string, subject: string, html: string, category: "marketing" | "follow_up" = "marketing") => {
    const [t] = await db.insert(emailTemplates).values({ name, subject, contentHtml: html, category, createdById: ownerId }).returning();
    track("email_templates", t.id);
    return t;
  };
  const newsletterTpl = await tpl(
    "Monthly newsletter",
    "{{contact.first_name | \"Hi\"}}, here's what's new this month",
    `<h1>What's new this month</h1><p>Hi {{contact.first_name | "there"}},</p><p>Here's a quick round-up of upcoming events, new resources and a few wins from our community.</p><h2>Upcoming</h2><ul><li><strong>Q4 Product Launch Webinar</strong> – save your seat</li><li><strong>Founders Breakfast Perth</strong> – limited spots</li></ul><p style="text-align: center"><a data-button href="https://example.com/events">See all events</a></p><p>Talk soon,<br>The ${ws.name} team</p>`,
  );
  const inviteTpl = await tpl(
    "Webinar invitation",
    "You're invited: Q4 Product Launch Webinar",
    `<h1>Join us live</h1><p>Hi {{contact.first_name | "there"}}, we're unveiling our new coaching programme in a 45-minute live webinar – with Q&amp;A and an exclusive launch offer for attendees.</p><p style="text-align: center"><a data-button href="https://example.com/e/q4-launch">Reserve my seat</a></p>`,
  );
  const followTpl = await tpl(
    "Sorry we missed you",
    "We missed you, {{contact.first_name | \"friend\"}}",
    `<p>Hi {{contact.first_name | "there"}},</p><p>We noticed you couldn't make it – no stress. Here's the recording and the slides. Want to talk it through? Book a quick call with us.</p>`,
    "follow_up",
  );

  // ── Events ──────────────────────────────────────────────────────────────
  const regQuestions: FormQuestion[] = [
    { id: "role", label: "What best describes you?", type: "select", required: true, options: ["Business owner", "Marketer", "Freelancer", "Other"], mapTo: null },
    { id: "goal", label: "What do you want to get out of this session?", type: "textarea", required: false, mapTo: null },
  ];
  const mkEvent = async (v: Partial<typeof events.$inferInsert> & { title: string; startsAt: Date; endsAt: Date }) => {
    const [e] = await db
      .insert(events)
      .values({ notifications: DEFAULT_EVENT_NOTIFICATIONS, hostId: ownerId, createdById: ownerId, timezone: ws.timezone, ...v })
      .returning();
    track("events", e.id);
    return e;
  };
  const masterclass = await mkEvent({
    title: "Growth Marketing Masterclass",
    slug: "growth-masterclass",
    description: "A practical 60-minute masterclass on building a predictable lead engine with events and email.",
    type: "webinar",
    locationType: "online",
    meetingUrl: "https://meet.example.com/growth-masterclass",
    startsAt: at(-21, 11),
    endsAt: at(-21, 12),
    capacity: 100,
    isPublic: true,
    campaignId: spring.id,
    registrationQuestions: regQuestions,
    status: "completed",
    color: "#6366f1",
  });
  const workshop = await mkEvent({
    title: "LinkedIn Lead Gen Workshop",
    slug: "linkedin-workshop",
    description: "Hands-on workshop: optimise your profile, build a content plan and start conversations that convert.",
    type: "workshop",
    locationType: "in_person",
    location: "The Hub, 140 St Georges Terrace, Perth",
    startsAt: at(-6, 9, 30),
    endsAt: at(-6, 12, 30),
    capacity: 20,
    isPublic: true,
    campaignId: spring.id,
    color: "#8b5cf6",
  });
  const launchWebinar = await mkEvent({
    title: "Q4 Product Launch Webinar",
    slug: "q4-launch",
    description: "Be the first to see our new coaching programme. Live demo, Q&A and an attendee-only launch offer.",
    type: "webinar",
    locationType: "online",
    meetingUrl: "https://meet.example.com/q4-launch",
    startsAt: at(5, 10),
    endsAt: at(5, 10, 45),
    capacity: 200,
    isPublic: true,
    campaignId: launch.id,
    registrationQuestions: regQuestions,
    color: "#ec4899",
  });
  const breakfast = await mkEvent({
    title: "Founders Breakfast Perth",
    slug: "founders-breakfast",
    description: "An informal breakfast for founders: coffee, croissants and honest conversations about growth.",
    type: "meetup",
    locationType: "in_person",
    location: "Kookaburra Coffee Co., Fremantle",
    startsAt: at(12, 7, 30),
    endsAt: at(12, 9),
    capacity: 15,
    waitlistEnabled: true,
    isPublic: true,
    campaignId: spring.id,
    color: "#f59e0b",
  });
  const appreciationNight = await mkEvent({
    title: "Customer Appreciation Night",
    slug: "appreciation-night",
    description: "Drinks, canapés and a look back at the year with our customers and partners.",
    type: "conference",
    locationType: "in_person",
    location: "Rooftop at The Westin, Perth",
    startsAt: at(35, 18),
    endsAt: at(35, 21),
    capacity: 80,
    isPublic: true,
    campaignId: appreciation.id,
    color: "#10b981",
  });
  await mkEvent({
    title: "Email Automation Clinic",
    slug: "automation-clinic",
    description: "Bring your funnel – we'll help you set up reminders and follow-ups that run themselves.",
    type: "class",
    locationType: "online",
    meetingUrl: "https://meet.example.com/clinic",
    startsAt: at(24, 13),
    endsAt: at(24, 14, 30),
    capacity: 30,
    status: "draft",
    campaignId: spring.id,
  });

  const shuffled = (n: number, offset: number) => {
    const arr = [...contactIds.slice(0, 55)];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr.slice(offset % 5, (offset % 5) + n);
  };
  const register = async (eventId: string, ids: string[], answers = true) => {
    const out: string[] = [];
    for (const cid of ids) {
      const r = await registerForEvent({
        eventId,
        contactId: cid,
        source: "manual",
        silent: true,
        ignoreCapacity: false,
        answers: answers ? { role: pick(regQuestions[0].options!), goal: chance(0.4) ? "Learn how to get more qualified leads" : null } : {},
      }).catch(() => null);
      if (r) out.push(r.attendee.id);
    }
    return out;
  };

  // Past masterclass: 25 registrations → 17 attended, 6 no-shows, 2 cancelled.
  const mAtt = await register(masterclass.id, shuffled(25, 1));
  for (let i = 0; i < mAtt.length; i++) {
    if (i < 17) {
      await markAttendance(mAtt[i], "attended", { actorId: ownerId });
    } else if (i < 23) {
      await markAttendance(mAtt[i], "no_show", { actorId: ownerId });
    } else {
      await db.update(eventAttendees).set({ status: "cancelled", cancelledAt: new Date(now - 22 * DAY) }).where(eq(eventAttendees.id, mAtt[i]));
    }
  }
  for (const a of mAtt.slice(0, 17)) {
    const [row] = await db.select({ c: eventAttendees.contactId }).from(eventAttendees).where(eq(eventAttendees.id, a));
    if (row && chance(0.6)) await addTagToContact(row.c, tagByName["Webinar attendee"]);
  }
  // Past workshop: 18 registrations → 12 attended, 4 no-shows, 2 not marked yet (needs attention).
  const wAtt = await register(workshop.id, shuffled(18, 2), false);
  for (let i = 0; i < wAtt.length; i++) {
    if (i < 12) await markAttendance(wAtt[i], "attended", { actorId: ownerId });
    else if (i < 16) await markAttendance(wAtt[i], "no_show", { actorId: ownerId });
  }
  // Upcoming events.
  const lAtt = await register(launchWebinar.id, shuffled(32, 3));
  for (const a of lAtt.slice(0, 11)) await setRsvp(a, "yes");
  await register(breakfast.id, shuffled(18, 4), false); // 15 seats + 3 waitlisted
  await register(appreciationNight.id, shuffled(9, 0), false);

  // ── Booking pages & meetings ───────────────────────────────────────────
  const meetingNotifications: EventNotifications = {
    confirmation: { enabled: true, templateId: null },
    cancellation: { enabled: true, templateId: null },
    reminders: [
      { id: "r24h", minutesBefore: 1440, templateId: null },
      { id: "r1h", minutesBefore: 60, templateId: null },
    ],
    followUps: [{ id: "f1", minutesAfter: 60, audience: "attended", templateId: null }],
    notifyHost: true,
  };
  const [strategy] = await db
    .insert(bookingPages)
    .values({
      slug: "strategy-call",
      title: "Strategy Call",
      description: "A 30-minute call to map out your growth plan and see if our programme is a fit.",
      durationMinutes: 30,
      locationType: "online",
      meetingUrl: "https://meet.example.com/strategy",
      hostIds: [ownerId],
      bufferAfterMinutes: 10,
      minNoticeMinutes: 12 * 60,
      maxDaysAhead: 21,
      questions: [
        { id: "budget", label: "What's your monthly marketing budget?", type: "select", required: true, options: ["Under $1k", "$1k – $5k", "$5k – $20k", "$20k+"], mapTo: null },
        { id: "team", label: "How big is your team?", type: "select", required: true, options: ["Just me", "2–10", "11–50", "50+"], mapTo: null },
        { id: "goal", label: "What would make this call a success for you?", type: "textarea", required: false, mapTo: null },
      ],
      disqualifyRules: [{ id: "g1", combinator: "and", conditions: [{ questionId: "budget", operator: "is", value: "Under $1k" }] }],
      disqualifyMessage: "Thanks! Based on your answers, our free resources are the best next step – we've sent them to your inbox.",
      confirmationMessage: "You're booked! Check your inbox for the details.",
      notifications: meetingNotifications,
      campaignId: launch.id,
      color: "#0ea5e9",
      createdById: ownerId,
    })
    .returning();
  const [discovery] = await db
    .insert(bookingPages)
    .values({
      slug: "discovery-call",
      title: "Discovery Call",
      description: "A quick 15-minute intro call.",
      durationMinutes: 15,
      locationType: "phone",
      hostIds: [ownerId],
      minNoticeMinutes: 4 * 60,
      maxDaysAhead: 14,
      slotIncrementMinutes: 15,
      notifications: meetingNotifications,
      color: "#14b8a6",
      createdById: ownerId,
    })
    .returning();
  track("booking_pages", strategy.id);
  track("booking_pages", discovery.id);

  const meetingPlan: { day: number; hour: number; outcome?: MeetingOutcome; value?: number; objection?: string }[] = [
    { day: -18, hour: 10, outcome: "won", value: 4800 },
    { day: -15, hour: 14, outcome: "lost", objection: "money" },
    { day: -12, hour: 11, outcome: "won", value: 3600 },
    { day: -9, hour: 15, outcome: "no_show" },
    { day: -8, hour: 9, outcome: "follow_up", objection: "partner" },
    { day: -5, hour: 13, outcome: "won", value: 7200 },
    { day: -4, hour: 10, outcome: "no_show" },
    { day: -2, hour: 16, outcome: "follow_up", objection: "timing" },
    { day: -1, hour: 11 }, // needs outcome
    { day: 1, hour: 10 },
    { day: 3, hour: 14 },
    { day: 6, hour: 11 },
  ];
  const meetingContacts = shuffled(meetingPlan.length, 2);
  for (let i = 0; i < meetingPlan.length; i++) {
    const p = meetingPlan[i];
    const page = i % 4 === 3 ? discovery : strategy;
    const [c] = await db.select().from(contacts).where(eq(contacts.id, meetingContacts[i]));
    const start = at(p.day, p.hour);
    const [m] = await db
      .insert(events)
      .values({
        kind: "meeting",
        title: `${page.title} with ${c.firstName} ${c.lastName}`,
        type: "call",
        locationType: page.locationType,
        meetingUrl: page.meetingUrl,
        startsAt: start,
        endsAt: new Date(start.getTime() + page.durationMinutes * 60_000),
        timezone: ws.timezone,
        bookingPageId: page.id,
        campaignId: page.campaignId,
        notifications: page.notifications,
        hostId: ownerId,
        createdById: ownerId,
        status: p.day < 0 ? "completed" : "scheduled",
      })
      .returning();
    track("events", m.id);
    const reg = await registerForEvent({
      eventId: m.id,
      contactId: c.id,
      source: p.day > 0 ? "booking" : "manual",
      silent: true,
      answers: page.id === strategy.id ? { budget: pick(["$1k – $5k", "$5k – $20k", "$20k+"]), team: pick(["Just me", "2–10", "11–50"]) } : {},
    });
    if (p.outcome) {
      await setMeetingOutcome(reg.attendee.id, { outcome: p.outcome, objection: p.objection ?? null, dealValue: p.value ?? null, notes: p.outcome === "won" ? "Signed up for the 6-month programme." : null }, { actorId: ownerId });
      if (p.outcome === "won") await changeStage(c.id, "customer", { actorId: ownerId });
    }
  }

  // Lead captures: potential (abandoned), qualified-not-booked, disqualified.
  const captureContacts = shuffled(11, 3);
  for (let i = 0; i < captureContacts.length; i++) {
    const status = i < 6 ? "partial" : i < 9 ? "qualified" : "disqualified";
    const target = i % 3 === 0 ? launchWebinar.id : strategy.id;
    const [lc] = await db
      .insert(leadCaptures)
      .values({
        contactId: captureContacts[i],
        kind: target === strategy.id ? "booking" : "registration",
        targetId: target,
        status,
        answers: status === "partial" ? {} : { budget: status === "disqualified" ? "Under $1k" : "$5k – $20k", team: "2–10" },
        createdAt: new Date(now - Math.floor(rand() * 14) * DAY - Math.floor(rand() * 10) * HOUR),
      })
      .returning();
    void lc;
    await db
      .update(contacts)
      .set({ leadStatus: status === "partial" ? "potential" : status, initialLeadStatus: "potential", leadStatusChangedAt: new Date(now - 2 * DAY) })
      .where(eq(contacts.id, captureContacts[i]));
  }

  // Page views over the last 30 days for funnel analytics.
  const views: (typeof pageViews.$inferInsert)[] = [];
  const viewTargets: [("event" | "booking"), string, number][] = [
    ["event", masterclass.id, 140],
    ["event", workshop.id, 60],
    ["event", launchWebinar.id, 210],
    ["event", breakfast.id, 70],
    ["event", appreciationNight.id, 35],
    ["booking", strategy.id, 120],
    ["booking", discovery.id, 40],
  ];
  for (const [kind, targetId, n] of viewTargets) {
    for (let i = 0; i < n; i++) {
      views.push({
        kind,
        targetId,
        visitorHash: sha256(`${targetId}-${i}`),
        utm: chance(0.5) ? pick(utmOptions) : {},
        createdAt: new Date(now - Math.floor(rand() * 30 * DAY)),
      });
    }
  }
  await db.insert(pageViews).values(views);

  // ── Broadcasts ──────────────────────────────────────────────────────────
  const [sentBroadcast] = await db
    .insert(broadcasts)
    .values({
      name: "October newsletter",
      subject: "Here's what's new this month",
      contentHtml: newsletterTpl.contentHtml,
      templateId: newsletterTpl.id,
      audience: { type: "tags", tagIds: [tagByName["Newsletter"]], match: "any" },
      status: "sent",
      sentAt: new Date(now - 9 * DAY),
      createdById: ownerId,
    })
    .returning();
  track("broadcasts", sentBroadcast.id);
  const newsletterContacts = await db
    .select()
    .from(contacts)
    .where(sql`${contacts.id} in (select contact_id from contact_tags where tag_id = ${tagByName["Newsletter"]}) and ${contacts.emailStatus} = 'subscribed'`);
  const emailCfg = await getSetting("email");
  let recipients = 0;
  for (const c of newsletterContacts) {
    if (!c.email) continue;
    recipients++;
    const opened = chance(0.48);
    const clicked = opened && chance(0.3);
    const sentAt = new Date(now - 9 * DAY);
    const [msg] = await db
      .insert(messages)
      .values({
        contactId: c.id,
        toEmail: c.email,
        toName: `${c.firstName} ${c.lastName}`,
        fromEmail: emailCfg.fromEmail,
        fromName: emailCfg.fromName,
        subject: "Here's what's new this month",
        html: "<p>(sample message)</p>",
        kind: "broadcast",
        broadcastId: sentBroadcast.id,
        templateId: newsletterTpl.id,
        status: "simulated",
        provider: "outbox",
        sentAt,
        openedAt: opened ? new Date(sentAt.getTime() + rand() * 2 * DAY) : null,
        openCount: opened ? 1 + Math.floor(rand() * 3) : 0,
        clickedAt: clicked ? new Date(sentAt.getTime() + rand() * 2 * DAY) : null,
        clickCount: clicked ? 1 : 0,
        createdAt: sentAt,
      })
      .returning();
    if (opened) await db.insert(emailEvents).values({ messageId: msg.id, type: "open", createdAt: msg.openedAt! });
    if (clicked) await db.insert(emailEvents).values({ messageId: msg.id, type: "click", url: "https://example.com/events", createdAt: msg.clickedAt! });
    await db.insert(activities).values({ contactId: c.id, type: "email_sent", title: "Email: Here's what's new this month", meta: { messageId: msg.id, kind: "broadcast", simulated: true }, createdAt: sentAt });
  }
  await db.update(broadcasts).set({ recipientCount: recipients }).where(eq(broadcasts.id, sentBroadcast.id));
  const [scheduled] = await db
    .insert(broadcasts)
    .values({
      name: "Q4 launch – webinar invite",
      subject: inviteTpl.subject,
      contentHtml: inviteTpl.contentHtml,
      templateId: inviteTpl.id,
      campaignId: launch.id,
      audience: { type: "tags", tagIds: [tagByName["Newsletter"]], match: "any" },
      status: "draft",
      createdById: ownerId,
    })
    .returning();
  track("broadcasts", scheduled.id);

  // ── Automations (drafts – activate them to try) ─────────────────────────
  const auto = async (name: string, description: string, trigger: (typeof automations.$inferInsert)["trigger"], steps: AutomationStep[], status: "draft" | "active" = "draft") => {
    const [a] = await db.insert(automations).values({ name, description, trigger, steps, status, createdById: ownerId }).returning();
    track("automations", a.id);
  };
  await auto(
    "No-show recovery",
    "Email no-shows the recording and create a follow-up task.",
    { type: "event_no_show", config: {} },
    [
      { id: "s1", type: "send_email", templateId: followTpl.id },
      { id: "s2", type: "wait", amount: 2, unit: "days" },
      { id: "s3", type: "create_task", title: "Call no-show to re-book", dueInDays: 1, assigneeId: ownerId },
    ],
  );
  await auto(
    "Hot lead alert",
    "When someone clicks a link in an email, tag them and notify the team.",
    { type: "email_clicked", config: {} },
    [
      { id: "s1", type: "add_tag", tagId: tagByName["Hot lead"] },
      { id: "s2", type: "notify_team", message: "A contact just clicked a link in an email – reach out while they're warm." },
    ],
  );
  await auto(
    "Newsletter welcome",
    "Welcome new newsletter subscribers.",
    { type: "tag_added", config: { tagId: tagByName["Newsletter"] } },
    [{ id: "s1", type: "send_email", templateId: newsletterTpl.id }],
  );

  // ── Tasks ───────────────────────────────────────────────────────────────
  const taskPlan: [string, number | null, boolean, "low" | "normal" | "high"][] = [
    ["Send proposal to Northwind Studio", -2, false, "high"],
    ["Call back about strategy call follow-up", 0, false, "high"],
    ["Prepare slides for Q4 launch webinar", 3, false, "normal"],
    ["Confirm venue catering for Founders Breakfast", 8, false, "normal"],
    ["Share workshop recording with attendees", -5, true, "low"],
    ["Check in with new customer onboarding", 1, false, "normal"],
    ["Update LinkedIn event page", null, false, "low"],
    ["Book photographer for Appreciation Night", 14, false, "normal"],
  ];
  for (const [title, due, done, priority] of taskPlan) {
    const [t] = await db
      .insert(tasks)
      .values({
        title,
        dueAt: due == null ? null : at(due, 15),
        completedAt: done ? new Date(now - 4 * DAY) : null,
        priority,
        contactId: pick(contactIds),
        assigneeId: ownerId,
        createdById: ownerId,
      })
      .returning();
    track("tasks", t.id);
  }

  // ── Smart views ─────────────────────────────────────────────────────────
  const view = async (name: string, filters: (typeof savedViews.$inferInsert)["filters"], description: string) => {
    const [v] = await db.insert(savedViews).values({ name, filters, description, ownerId, visibility: "shared" }).returning();
    track("saved_views", v.id);
  };
  await view("Hot leads", { match: "all", filters: [{ field: "tag", operator: "has", value: [tagByName["Hot lead"]] }] }, "Tagged as hot lead");
  await view("Customers", { match: "all", filters: [{ field: "stage", operator: "is", value: "customer" }] }, "Won contacts");
  await view(
    "Potential leads",
    { match: "any", filters: [{ field: "lead_status", operator: "is", value: "potential" }, { field: "lead_status", operator: "is", value: "qualified" }] },
    "Started a form but never booked or registered",
  );

  // ── Spread timestamps so charts and timelines look natural ──────────────
  const list = (arr: string[] = []) => (arr.length ? sql`(${sql.join(arr.map((v) => sql`${v}::uuid`), sql`, `)})` : sql`(null::uuid)`);
  const cids = list(contactIds);
  const eids = list(ids.events);
  await db.execute(sql`update contacts set created_at = now() - (random() * interval '90 days') where id in ${cids}`);
  await db.execute(sql`
    update event_attendees set registered_at = least(now(), events.starts_at) - (random() * interval '20 days') - interval '1 hour'
    from events where events.id = event_attendees.event_id and events.kind = 'event' and event_attendees.event_id in ${eids}`);
  await db.execute(sql`
    update event_attendees set registered_at = events.starts_at - (random() * interval '6 days') - interval '1 day'
    from events where events.id = event_attendees.event_id and events.kind = 'meeting' and event_attendees.event_id in ${eids}`);
  // Most sign-ups came through the public pages (funnel analytics): mark them as such and
  // record the matching completed lead captures.
  const publicEvents = list([masterclass.id, workshop.id, launchWebinar.id, breakfast.id, appreciationNight.id]);
  await db.execute(sql`update event_attendees set source = 'public' where event_id in ${publicEvents} and random() < 0.8`);
  await db.execute(sql`
    update event_attendees set source = 'booking'
    from events where events.id = event_attendees.event_id and events.kind = 'meeting' and event_attendees.event_id in ${eids}`);
  await db.execute(sql`
    insert into lead_captures (contact_id, kind, target_id, status, answers, completed_at, created_at, updated_at)
    select event_attendees.contact_id,
           case when events.kind = 'meeting' then 'booking' else 'registration' end,
           coalesce(events.booking_page_id, events.id),
           'completed', event_attendees.answers, event_attendees.registered_at,
           event_attendees.registered_at - interval '3 minutes', event_attendees.registered_at
    from event_attendees join events on events.id = event_attendees.event_id
    where event_attendees.source in ('public', 'booking') and event_attendees.event_id in ${eids}`);
  await db.execute(sql`
    update activities set created_at = contacts.created_at
    from contacts where contacts.id = activities.contact_id and activities.type = 'contact_created' and activities.contact_id in ${cids}`);
  await db.execute(sql`
    update activities set created_at = event_attendees.registered_at
    from event_attendees where event_attendees.event_id = activities.event_id and event_attendees.contact_id = activities.contact_id
      and activities.type in ('event_registered', 'meeting_booked') and activities.contact_id in ${cids}`);
  await db.execute(sql`
    update activities set created_at = events.ends_at + interval '30 minutes'
    from events where events.id = activities.event_id and activities.type in ('event_attended', 'event_no_show', 'meeting_outcome') and activities.contact_id in ${cids}`);
  await db.execute(sql`
    update activities set created_at = contacts.created_at + random() * (now() - contacts.created_at)
    from contacts where contacts.id = activities.contact_id
      and activities.type in ('note', 'tag_added', 'stage_changed', 'lead_status_changed', 'rsvp') and activities.contact_id in ${cids}`);
  await db.execute(sql`
    update contacts set last_activity_at = (select max(created_at) from activities where activities.contact_id = contacts.id)
    where contacts.id in ${cids}`);

  // Record what we created so it can be removed later (Settings → Danger zone).
  await db
    .insert(settings)
    .values({ key: "sampleData", value: { ids } })
    .onConflictDoUpdate({ target: settings.key, set: { value: { ids }, updatedAt: new Date() } });
  void users;
}
