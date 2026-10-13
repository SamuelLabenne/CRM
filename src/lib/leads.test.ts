import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));

const { isDisqualified, validateAnswers } = await import("./leads");

describe("isDisqualified", () => {
  const rules = [
    {
      id: "g1",
      combinator: "and" as const,
      conditions: [
        { questionId: "budget", operator: "is" as const, value: "< $1k" },
        { questionId: "timeline", operator: "is" as const, value: ["Later"] },
      ],
    },
    { id: "g2", combinator: "or" as const, conditions: [{ questionId: "seats", operator: "lt" as const, value: 2 }] },
  ];
  it("matches AND groups only when all conditions hit", () => {
    expect(isDisqualified(rules, { budget: "< $1k", timeline: "Now", seats: 5 }).disqualified).toBe(false);
    expect(isDisqualified(rules, { budget: "< $1k", timeline: "Later", seats: 5 })).toEqual({ disqualified: true, groupId: "g1" });
  });
  it("ORs groups together", () => {
    expect(isDisqualified(rules, { budget: "$10k+", timeline: "Now", seats: 1 }).groupId).toBe("g2");
  });
});

describe("validateAnswers", () => {
  it("validates required, options and numbers", () => {
    const qs = [
      { id: "a", label: "A", type: "select" as const, required: true, options: ["x", "y"] },
      { id: "b", label: "B", type: "number" as const, required: false },
      { id: "c", label: "C", type: "multiselect" as const, required: true, options: ["1", "2"] },
    ];
    const res = validateAnswers(qs, { a: "z", b: "abc", c: [] });
    expect(res.valid).toBe(false);
    expect(Object.keys(res.errors).sort()).toEqual(["a", "b", "c"]);
    expect(validateAnswers(qs, { a: "x", b: "3", c: ["2", "9"] }).answers).toEqual({ a: "x", b: 3, c: ["2"] });
  });
});
