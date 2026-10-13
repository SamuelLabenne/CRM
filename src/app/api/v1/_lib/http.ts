import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { authenticateApiRequest } from "@/lib/api-keys";
import type { ApiKey } from "@/lib/db/schema";

// Shared plumbing for the REST API v1: bearer-key auth, JSON errors, zod parsing.

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

const NO_STORE = { "cache-control": "no-store" };

export function jsonError(status: number, code: string, message: string, details?: unknown) {
  return NextResponse.json({ error: { code, message, ...(details === undefined ? {} : { details }) } }, { status, headers: NO_STORE });
}

export function jsonOk(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

export function zodDetails(error: z.ZodError) {
  return error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
}

/** Parse the JSON body with a zod schema (400 on bad JSON / validation errors). */
export async function parseBody<T extends z.ZodType>(req: Request, schema: T): Promise<z.infer<T>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new ApiError(400, "invalid_json", "The request body must be valid JSON.");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new ApiError(400, "invalid_request", parsed.error.issues[0]?.message ?? "Invalid request body.", zodDetails(parsed.error));
  return parsed.data;
}

export function parseQuery<T extends z.ZodType>(req: NextRequest, schema: T): z.infer<T> {
  const parsed = schema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) throw new ApiError(400, "invalid_request", parsed.error.issues[0]?.message ?? "Invalid query parameters.", zodDetails(parsed.error));
  return parsed.data;
}

/**
 * Wrap a route handler: requires `Authorization: Bearer <api key>` (updates the key's last-used
 * time) and turns thrown ApiErrors / unexpected failures into JSON error responses.
 */
export function withApiKey<C>(handler: (req: NextRequest, ctx: C, key: ApiKey) => Promise<Response>) {
  return async (req: NextRequest, ctx: C): Promise<Response> => {
    try {
      const key = await authenticateApiRequest(req);
      if (!key) {
        const res = jsonError(401, "unauthorized", "Missing or invalid API key. Send it as 'Authorization: Bearer <key>'.");
        res.headers.set("www-authenticate", 'Bearer realm="relay"');
        return res;
      }
      return await handler(req, ctx, key);
    } catch (err) {
      if (err instanceof ApiError) return jsonError(err.status, err.code, err.message, err.details);
      console.error("[api/v1] unexpected error", err);
      return jsonError(500, "internal_error", "Something went wrong on our side.");
    }
  };
}
