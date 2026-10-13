import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { setupTestDb } from "@/test/setup-db";

const { db } = await setupTestDb();
const s = await import("@/lib/db/schema");
const { getSetting, DEFAULT_STAGES } = await import("@/lib/settings");
const { savePipelineStages, getStageUsage, stageKeyFromLabel, normalizeStages, PipelineError } = await import("./pipeline");

const base = DEFAULT_STAGES.map((st) => ({ ...st }));

describe("pipeline stages", () => {
  it("keeps keys stable on rename and generates unique keys for new stages", async () => {
    const renamed = base.map((st) => (st.key === "contacted" ? { ...st, label: "Reached out" } : st));
    renamed.push({ key: "", label: "Follow up", color: "#111111", category: "active" } as never); // clashes with existing "follow_up"
    renamed.push({ key: null, label: "Proposal sent!", color: "#222222", category: "active" } as never);
    const { stages } = await savePipelineStages({ stages: renamed });
    expect(stages.find((x) => x.label === "Reached out")?.key).toBe("contacted");
    expect(stages.find((x) => x.label === "Proposal sent!")?.key).toBe("proposal_sent");
    const keys = stages.map((x) => x.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect((await getSetting("stages")).map((x) => x.key)).toEqual(keys);
  });

  it("validates input", () => {
    const keys = base.map((x) => x.key);
    expect(() => normalizeStages([], keys)).toThrow(PipelineError);
    expect(() => normalizeStages([{ label: " ", color: "#ffffff", category: "active" }], keys)).toThrow(/name/i);
    expect(() => normalizeStages([{ label: "A", color: "red", category: "active" }], keys)).toThrow(/color/i);
    expect(() =>
      normalizeStages([{ label: "A", color: "#ffffff", category: "active" }, { label: "a", color: "#ffffff", category: "won" }], keys),
    ).toThrow(/unique/i);
    expect(() => normalizeStages([{ label: "Won", color: "#ffffff", category: "won" }], keys)).toThrow(/Active/);
    expect(stageKeyFromLabel("Hot lead", ["hot_lead"])).toBe("hot_lead_2");
  });

  it("requires a destination for contacts of a deleted stage and moves them (with timeline + references)", async () => {
    await savePipelineStages({ stages: base });
    const [a, b, c] = await db
      .insert(s.contacts)
      .values([
        { email: "a@x.io", stage: "lost" },
        { email: "b@x.io", stage: "lost" },
        { email: "c@x.io", stage: "customer" },
      ])
      .returning();
    const [automation] = await db
      .insert(s.automations)
      .values({
        name: "Stage auto",
        trigger: { type: "stage_changed", config: { stage: "lost" } },
        steps: [{ id: "1", type: "set_stage", stage: "lost" }],
      })
      .returning();
    const [view] = await db
      .insert(s.savedViews)
      .values({ name: "Lost", filters: { match: "all", filters: [{ field: "stage", operator: "is", value: "lost" }] } })
      .returning();
    expect((await getStageUsage()).lost).toBe(2);

    const without = base.filter((st) => st.key !== "lost");
    await expect(savePipelineStages({ stages: without })).rejects.toThrow(/2 contact/);
    await expect(savePipelineStages({ stages: without, moves: { lost: "does_not_exist" } })).rejects.toThrow(PipelineError);
    // nothing changed yet
    expect((await getSetting("stages")).some((x) => x.key === "lost")).toBe(true);

    const res = await savePipelineStages({ stages: without, moves: { lost: "contacted" }, actorId: null });
    expect(res.moved).toBe(2);
    const rows = await db.select().from(s.contacts);
    expect(rows.find((r) => r.id === a.id)?.stage).toBe("contacted");
    expect(rows.find((r) => r.id === b.id)?.stage).toBe("contacted");
    expect(rows.find((r) => r.id === c.id)?.stage).toBe("customer");
    const acts = await db.select().from(s.activities).where(eq(s.activities.contactId, a.id));
    expect(acts[0].type).toBe("stage_changed");
    expect(acts[0].meta).toMatchObject({ from: "lost", to: "contacted", reason: "stage_deleted" });

    const [auto] = await db.select().from(s.automations).where(eq(s.automations.id, automation.id));
    expect(auto.trigger.config.stage).toBe("contacted");
    expect(auto.steps[0]).toMatchObject({ type: "set_stage", stage: "contacted" });
    const [v] = await db.select().from(s.savedViews).where(eq(s.savedViews.id, view.id));
    expect(v.filters.filters[0].value).toBe("contacted");
  });

  it("follows move chains when the destination is also deleted", async () => {
    await savePipelineStages({ stages: base });
    const [x] = await db.insert(s.contacts).values({ email: "chain@x.io", stage: "engaged" }).returning();
    const without = base.filter((st) => st.key !== "engaged" && st.key !== "contacted");
    const res = await savePipelineStages({ stages: without, moves: { engaged: "contacted", contacted: "follow_up" } });
    expect(res.moved).toBeGreaterThanOrEqual(1);
    const [row] = await db.select().from(s.contacts).where(eq(s.contacts.id, x.id));
    expect(row.stage).toBe("follow_up");
  });

  it("deletes an unused stage without a destination, but never the default 'new' stage", async () => {
    const current = await getSetting("stages");
    const added = (await savePipelineStages({ stages: [...current, { label: "Temp", color: "#abcdef", category: "active" }] })).stages;
    expect(added.some((x) => x.key === "temp")).toBe(true);
    const res = await savePipelineStages({ stages: added.filter((x) => x.key !== "temp") });
    expect(res.moved).toBe(0);
    await expect(savePipelineStages({ stages: added.filter((x) => x.key !== "new" && x.key !== "temp"), moves: { new: "contacted" } })).rejects.toThrow(/can’t be deleted/);
  });
});
