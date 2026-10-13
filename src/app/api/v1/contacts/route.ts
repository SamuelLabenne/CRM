import { desc, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { contacts } from "@/lib/db/schema";
import { contactSearchWhere } from "@/lib/contacts/filters";
import { ensureTag, publicContact, upsertContact } from "@/lib/contacts";
import { kickJobs } from "@/lib/jobs/kick";
import { getSetting } from "@/lib/settings";
import { ApiError, jsonOk, parseBody, parseQuery, withApiKey } from "../_lib/http";

const listQuery = z.object({
  q: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
});

/** GET /api/v1/contacts?q=&limit=&offset= */
export const GET = withApiKey(async (req) => {
  const { q, limit, offset } = parseQuery(req, listQuery);
  const where = contactSearchWhere(q);
  const [rows, [count]] = await Promise.all([
    db.select().from(contacts).where(where).orderBy(desc(contacts.createdAt), desc(contacts.id)).limit(limit).offset(offset),
    db.select({ n: sql<number>`count(*)::int` }).from(contacts).where(where),
  ]);
  return jsonOk({ data: rows.map(publicContact), total: count?.n ?? 0, limit, offset });
});

const text = (max = 200) => z.string().trim().max(max).nullish();
const createBody = z.object({
  email: z.string().trim().max(254).nullish(),
  phone: text(40),
  firstName: text(100),
  lastName: text(100),
  company: text(200),
  jobTitle: text(200),
  website: text(300),
  city: text(100),
  country: text(100),
  stage: text(60),
  notes: text(5000),
  tags: z.array(z.string().trim().min(1).max(40)).max(25).optional(),
  customFields: z.record(z.string().max(60), z.union([z.string().max(2000), z.number(), z.boolean(), z.array(z.string().max(200)).max(50), z.null()])).optional(),
  utm: z
    .object({
      source: z.string().max(200).optional(),
      medium: z.string().max(200).optional(),
      campaign: z.string().max(200).optional(),
      term: z.string().max(200).optional(),
      content: z.string().max(200).optional(),
    })
    .optional(),
  /** Replace existing non-empty values instead of only filling blanks. */
  overwrite: z.boolean().optional(),
});

/** POST /api/v1/contacts – create or update (matched by email, then phone). */
export const POST = withApiKey(async (req) => {
  const body = await parseBody(req, createBody);
  const email = body.email?.trim().toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ApiError(400, "invalid_request", "email is not a valid email address.");
  if (body.stage) {
    const stages = await getSetting("stages");
    if (!stages.some((s) => s.key === body.stage)) {
      throw new ApiError(422, "invalid_stage", `Unknown stage "${body.stage}". Valid stages: ${stages.map((s) => s.key).join(", ")}.`);
    }
  }
  if (!email && !body.phone && !body.firstName && !body.lastName) {
    throw new ApiError(400, "invalid_request", "Provide at least an email, phone or name.");
  }
  const tagIds: string[] = [];
  for (const name of body.tags ?? []) {
    const tag = await ensureTag(name);
    if (tag) tagIds.push(tag.id);
  }
  const { contact, created } = await upsertContact(
    {
      email,
      phone: body.phone,
      firstName: body.firstName,
      lastName: body.lastName,
      company: body.company,
      jobTitle: body.jobTitle,
      website: body.website,
      city: body.city,
      country: body.country,
      stage: body.stage ?? undefined,
      notes: body.notes,
      customFields: body.customFields,
      utm: body.utm,
      tagIds,
    },
    { source: "api", overwrite: body.overwrite },
  );
  kickJobs();
  return jsonOk({ data: publicContact(contact), created }, created ? 201 : 200);
});
