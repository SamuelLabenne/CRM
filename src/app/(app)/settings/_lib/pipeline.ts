import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { activities, automations, contacts, savedViews } from "@/lib/db/schema";
import { getSetting, setSetting } from "@/lib/settings";
import { slugify } from "@/lib/format";
import type { AutomationStep, ContactFilter, Stage, StageCategory } from "@/lib/types";

// ---------------------------------------------------------------------------
// Pipeline stage editing. Stage keys are stable slugs stored on contacts, so they
// never change when a stage is renamed. Deleting a stage that contacts are in moves
// those contacts to another stage first.
// ---------------------------------------------------------------------------

export class PipelineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PipelineError";
  }
}

/** Contacts (and the schema default) start in this stage, so it can be renamed but not deleted. */
export const PROTECTED_STAGE_KEY = "new";
export const STAGE_CATEGORIES: StageCategory[] = ["active", "won", "lost"];
const HEX = /^#[0-9a-fA-F]{6}$/;
const CHUNK = 1000;

export type StageInput = { key?: string | null; label: string; color: string; category: StageCategory };

export function stageKeyFromLabel(label: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const base = slugify(label).replace(/-/g, "_") || "stage";
  let key = base;
  for (let i = 2; used.has(key); i++) key = `${base}_${i}`;
  return key;
}

/** Number of contacts in each stage key. */
export async function getStageUsage(): Promise<Record<string, number>> {
  const rows = await db
    .select({ stage: contacts.stage, n: sql<number>`count(*)::int` })
    .from(contacts)
    .groupBy(contacts.stage);
  return Object.fromEntries(rows.map((r) => [r.stage, r.n]));
}

function remapFilterValue(value: ContactFilter["value"], map: Map<string, string>): ContactFilter["value"] {
  if (typeof value === "string") return map.get(value) ?? value;
  if (Array.isArray(value)) return value.map((v) => map.get(v) ?? v);
  return value;
}

/** Point automations and smart views that mention a removed stage at its replacement. */
async function remapStageReferences(map: Map<string, string>) {
  if (!map.size) return;
  const autos = await db.select({ id: automations.id, trigger: automations.trigger, steps: automations.steps }).from(automations);
  for (const a of autos) {
    let changed = false;
    const trigger = { ...a.trigger, config: { ...a.trigger.config } };
    if (trigger.config.stage && map.has(trigger.config.stage)) {
      trigger.config.stage = map.get(trigger.config.stage)!;
      changed = true;
    }
    const steps = a.steps.map((s): AutomationStep => {
      if (s.type === "set_stage" && map.has(s.stage)) {
        changed = true;
        return { ...s, stage: map.get(s.stage)! };
      }
      return s;
    });
    if (changed) await db.update(automations).set({ trigger, steps }).where(eq(automations.id, a.id));
  }
  const views = await db.select({ id: savedViews.id, filters: savedViews.filters }).from(savedViews);
  for (const v of views) {
    let changed = false;
    const filters = (v.filters?.filters ?? []).map((f) => {
      if (f.field !== "stage") return f;
      const value = remapFilterValue(f.value, map);
      if (JSON.stringify(value) !== JSON.stringify(f.value)) changed = true;
      return { ...f, value };
    });
    if (changed) await db.update(savedViews).set({ filters: { ...v.filters, filters } }).where(eq(savedViews.id, v.id));
  }
}

/** Validate and normalise the submitted stage list (assigns keys to new stages). */
export function normalizeStages(input: StageInput[], currentKeys: string[]): Stage[] {
  if (!input.length) throw new PipelineError("You need at least one stage.");
  if (input.length > 30) throw new PipelineError("A pipeline can have at most 30 stages.");
  const seenLabels = new Set<string>();
  const seenKeys = new Set<string>();
  const taken = new Set<string>([...currentKeys, ...input.map((s) => s.key).filter((k): k is string => !!k)]);
  const out: Stage[] = [];
  for (const s of input) {
    const label = s.label.trim();
    if (!label) throw new PipelineError("Every stage needs a name.");
    if (label.length > 40) throw new PipelineError(`“${label.slice(0, 20)}…” is too long (max 40 characters).`);
    if (!HEX.test(s.color)) throw new PipelineError(`Pick a valid color for “${label}”.`);
    if (!STAGE_CATEGORIES.includes(s.category)) throw new PipelineError(`Pick a category for “${label}”.`);
    const lower = label.toLowerCase();
    if (seenLabels.has(lower)) throw new PipelineError(`Two stages are called “${label}”. Stage names must be unique.`);
    seenLabels.add(lower);
    let key = s.key && currentKeys.includes(s.key) ? s.key : null;
    if (!key) {
      key = stageKeyFromLabel(label, taken);
      taken.add(key);
    }
    if (seenKeys.has(key)) throw new PipelineError("Duplicate stage key.");
    seenKeys.add(key);
    out.push({ key, label, color: s.color.toLowerCase(), category: s.category });
  }
  if (!out.some((s) => s.category === "active")) throw new PipelineError("At least one stage must be in the “Active” category.");
  return out;
}

/**
 * Persist the stage list. `moves` says where contacts of each removed stage go
 * (required when a removed stage still has contacts).
 */
export async function savePipelineStages(input: {
  stages: StageInput[];
  moves?: Record<string, string>;
  actorId?: string | null;
}): Promise<{ stages: Stage[]; moved: number }> {
  const current = await getSetting("stages");
  const currentKeys = current.map((s) => s.key);
  const next = normalizeStages(input.stages, currentKeys);
  const nextKeys = new Set(next.map((s) => s.key));
  const removed = current.filter((s) => !nextKeys.has(s.key));

  if (removed.some((s) => s.key === PROTECTED_STAGE_KEY)) {
    throw new PipelineError("“New lead” is where new contacts start, so it can’t be deleted. You can rename it.");
  }

  const usage = await getStageUsage();
  const redirects = new Map<string, string>();
  for (const r of removed) {
    const requested = input.moves?.[r.key];
    if (requested && nextKeys.has(requested)) {
      redirects.set(r.key, requested);
    } else if ((usage[r.key] ?? 0) > 0) {
      throw new PipelineError(`Choose where to move the ${usage[r.key]} contact(s) in “${r.label}”.`);
    } else {
      // Unused stage: still repoint automations/views at something sensible.
      redirects.set(r.key, (next.find((s) => s.category === r.category) ?? next[0]).key);
    }
  }

  let moved = 0;
  for (const r of removed) {
    const target = redirects.get(r.key)!;
    if (!(usage[r.key] ?? 0)) continue;
    const targetLabel = next.find((s) => s.key === target)?.label ?? target;
    await db.transaction(async (tx) => {
      const ids = (await tx.select({ id: contacts.id }).from(contacts).where(eq(contacts.stage, r.key))).map((c) => c.id);
      await tx.update(contacts).set({ stage: target, lastActivityAt: new Date() }).where(eq(contacts.stage, r.key));
      for (let i = 0; i < ids.length; i += CHUNK) {
        await tx.insert(activities).values(
          ids.slice(i, i + CHUNK).map((contactId) => ({
            contactId,
            type: "stage_changed" as const,
            title: `Stage changed to ${targetLabel}`,
            body: `The “${r.label}” stage was deleted.`,
            meta: { from: r.key, to: target, reason: "stage_deleted" },
            actorId: input.actorId ?? null,
          })),
        );
      }
      moved += ids.length;
    });
  }
  await remapStageReferences(redirects);
  await setSetting("stages", next);
  return { stages: next, moved };
}
