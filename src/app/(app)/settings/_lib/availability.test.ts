import { describe, expect, it } from "vitest";
import { AvailabilityError, defaultAvailability, normalizeAvailability, normalizeOverrides, normalizeRanges, orderedDays } from "./availability";

describe("availability helpers", () => {
  it("default is Mon–Fri 09:00–17:00", () => {
    const d = defaultAvailability();
    expect(d["0"]).toEqual([]);
    expect(d["6"]).toEqual([]);
    for (const k of ["1", "2", "3", "4", "5"] as const) expect(d[k]).toEqual([{ start: "09:00", end: "17:00" }]);
  });

  it("orders days by week start", () => {
    expect(orderedDays(1)).toEqual(["1", "2", "3", "4", "5", "6", "0"]);
    expect(orderedDays(0)[0]).toBe("0");
  });

  it("sorts, merges touching ranges and rejects overlaps / inverted ranges", () => {
    expect(normalizeRanges([{ start: "13:00", end: "17:00" }, { start: "09:00", end: "12:00" }], "Mon")).toEqual([
      { start: "09:00", end: "12:00" },
      { start: "13:00", end: "17:00" },
    ]);
    expect(normalizeRanges([{ start: "09:00", end: "12:00" }, { start: "12:00", end: "15:00" }], "Mon")).toEqual([{ start: "09:00", end: "15:00" }]);
    expect(() => normalizeRanges([{ start: "09:00", end: "12:00" }, { start: "11:00", end: "13:00" }], "Mon")).toThrow(/overlaps/);
    expect(() => normalizeRanges([{ start: "12:00", end: "09:00" }], "Mon")).toThrow(AvailabilityError);
    expect(() => normalizeRanges([{ start: "9:00", end: "10:00" }], "Mon")).toThrow(/times/);
  });

  it("fills missing days with no availability", () => {
    const w = normalizeAvailability({ "1": [{ start: "08:00", end: "10:00" }] });
    expect(w["1"]).toHaveLength(1);
    expect(w["2"]).toEqual([]);
  });

  it("normalises overrides: sorted, unique, past dates dropped", () => {
    const out = normalizeOverrides(
      [
        { date: "2026-12-24", slots: [] },
        { date: "2026-12-01", slots: [{ start: "10:00", end: "12:00" }] },
        { date: "2020-01-01", slots: [] },
      ],
      "2026-11-01",
    );
    expect(out.map((o) => o.date)).toEqual(["2026-12-01", "2026-12-24"]);
    expect(() => normalizeOverrides([{ date: "2026-12-01", slots: [] }, { date: "2026-12-01", slots: [] }], "2026-11-01")).toThrow(/twice/);
    expect(() => normalizeOverrides([{ date: "nope", slots: [] }], "2026-11-01")).toThrow(/valid date/);
  });
});
