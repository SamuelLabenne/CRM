import { describe, expect, it } from "vitest";
import { decodeFilter, encodeFilter, isEmptyFilter, isFilterComplete, sanitizeFilterGroup } from "./filter-codec";
import { buildFieldList, describeFilter, operatorsFor, type FilterOptions } from "./filter-fields";
import type { FilterGroup } from "@/lib/types";

const options: FilterOptions = {
  tags: [{ id: "t1", name: "VIP" }],
  users: [{ id: "u1", name: "Sam" }],
  stages: [{ key: "new", label: "New lead", color: "#000" }],
  customFields: [
    { key: "budget", label: "Budget", type: "number" },
    { key: "plan", label: "Plan", type: "select", options: ["Free", "Pro"] },
  ],
  events: [{ id: "e1", title: "Launch webinar" }],
};

describe("filter codec", () => {
  it("round-trips a filter group through base64url, including unicode", () => {
    const group: FilterGroup = {
      match: "any",
      filters: [
        { field: "company", operator: "contains", value: "Zoë & Søn" },
        { field: "tag", operator: "has", value: "t1" },
        { field: "deal_value", operator: "gt", value: 1000 },
        { field: "stage", operator: "is", value: ["new", "lost"] },
      ],
    };
    const encoded = encodeFilter(group);
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeFilter(encoded)).toEqual(group);
  });

  it("returns an empty string for empty filters and null for garbage", () => {
    expect(encodeFilter({ match: "all", filters: [] })).toBe("");
    expect(encodeFilter(null)).toBe("");
    expect(decodeFilter("")).toBeNull();
    expect(decodeFilter("not-base64!!")).toBeNull();
    expect(decodeFilter(btoa("{\"match\":\"nope\"}"))).toBeNull();
  });

  it("drops incomplete rows but keeps is_empty style operators", () => {
    const g = sanitizeFilterGroup({
      match: "all",
      filters: [
        { field: "company", operator: "contains", value: "  " },
        { field: "email", operator: "is_empty" },
        { field: "tag", operator: "has", value: [] },
        { field: "city", operator: "is", value: "Perth" },
      ],
    });
    expect(g.filters.map((f) => f.field)).toEqual(["email", "city"]);
    expect(isFilterComplete({ field: "deal_value", operator: "gt", value: 0 })).toBe(true);
    expect(isEmptyFilter({ match: "all", filters: [{ field: "x", operator: "is", value: "" }] })).toBe(true);
  });
});

describe("filter fields", () => {
  it("builds fields for static columns, tags/events and custom fields", () => {
    const fields = buildFieldList(options);
    const keys = fields.map((f) => f.key);
    expect(keys).toContain("stage");
    expect(keys).toContain("custom:budget");
    expect(fields.find((f) => f.key === "custom:budget")?.kind).toBe("number");
    expect(fields.find((f) => f.key === "custom:plan")?.options?.map((o) => o.value)).toEqual(["Free", "Pro"]);
    expect(operatorsFor({ key: "tag", kind: "tag" })).toEqual(["has", "has_not"]);
  });

  it("describes filters in plain words", () => {
    expect(describeFilter({ field: "stage", operator: "is", value: "new" }, options)).toBe("Stage is New lead");
    expect(describeFilter({ field: "tag", operator: "has", value: "t1" }, options)).toBe("Tag has tag VIP");
    expect(describeFilter({ field: "event", operator: "has", value: "e1" }, options)).toBe("Registered for event registered for Launch webinar");
    expect(describeFilter({ field: "email", operator: "is_empty" }, options)).toBe("Email is empty");
    expect(describeFilter({ field: "created_at", operator: "in_last_days", value: 7 }, options)).toBe("Created is in the last (days) 7");
  });
});
