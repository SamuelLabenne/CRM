import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { setupTestDb } from "@/test/setup-db";

const { db } = await setupTestDb();
const s = await import("@/lib/db/schema");
const f = await import("./fields");

describe("custom fields", () => {
  it("derives unique snake_case keys from labels", async () => {
    const a = await f.createFieldDef({ label: "Lead score", type: "number" });
    const b = await f.createFieldDef({ label: "LEAD   score", type: "text" }).catch((e: Error) => e);
    expect(a.key).toBe("lead_score");
    expect(b).toBeInstanceOf(f.FieldError); // same label ignoring case and spacing
    const c = await f.createFieldDef({ label: "Lead score?", type: "text" });
    expect(c.key).toBe("lead_score_2");
    const email = await f.createFieldDef({ label: "Email", type: "text" });
    expect(email.key).toBe("email_2"); // reserved
    const numeric = await f.createFieldDef({ label: "2025 budget", type: "number" });
    expect(numeric.key).toMatch(/^[a-z][a-z0-9_]*$/);
  });

  it("requires options for choice fields and keeps the key when editing", async () => {
    await expect(f.createFieldDef({ label: "Plan", type: "select", options: ["Only one"] })).rejects.toThrow(/two options/);
    const p = await f.createFieldDef({ label: "Plan", type: "select", options: ["Free", " Pro ", "Free"] });
    expect(p.options).toEqual(["Free", "Pro"]);
    const edited = await f.updateFieldDef(p.id, { label: "Pricing plan", type: "select", options: ["Free", "Pro", "Team"] });
    expect(edited.key).toBe("plan");
    expect(edited.options).toHaveLength(3);
  });

  it("reorders via position and deletes values from contacts", async () => {
    const defs = await f.listFieldDefs();
    const first = defs[0];
    await f.moveFieldDef(defs[1].id, -1);
    const after = await f.listFieldDefs();
    expect(after[0].id).toBe(defs[1].id);
    expect(after[1].id).toBe(first.id);
    expect(after.map((d) => d.position)).toEqual(after.map((_, i) => i));
    await f.moveFieldDef(after[0].id, -1); // already first: no-op
    expect((await f.listFieldDefs())[0].id).toBe(defs[1].id);

    const [c] = await db
      .insert(s.contacts)
      .values({ email: "cf@x.io", customFields: { lead_score: 7, other: "keep" } })
      .returning();
    const scoreDef = (await f.listFieldDefs()).find((d) => d.key === "lead_score")!;
    expect(scoreDef.usage).toBe(1);
    await f.deleteFieldDef(scoreDef.id);
    const [row] = await db.select().from(s.contacts).where(eq(s.contacts.id, c.id));
    expect(row.customFields).toEqual({ other: "keep" });
    await expect(f.deleteFieldDef(scoreDef.id)).rejects.toThrow();
  });
});
