import { describe, expect, it } from "vitest";
import { bucketByDay, capacityUsage, formatOffset, registrationState, splitDuration, summarizeStatuses } from "./utils";

const base = {
  status: "scheduled" as const,
  endsAt: new Date(Date.now() + 86_400_000),
  registrationOpen: true,
  capacity: null as number | null,
  waitlistEnabled: false,
};

describe("registrationState", () => {
  it("is open for a normal upcoming event", () => {
    expect(registrationState(base, 0)).toBe("open");
  });
  it("reports cancelled / past / closed in priority order", () => {
    expect(registrationState({ ...base, status: "cancelled" }, 0)).toBe("cancelled");
    expect(registrationState({ ...base, endsAt: new Date(Date.now() - 1000) }, 0)).toBe("past");
    expect(registrationState({ ...base, status: "completed" }, 0)).toBe("past");
    expect(registrationState({ ...base, registrationOpen: false }, 0)).toBe("closed");
  });
  it("handles capacity with and without a waitlist", () => {
    expect(registrationState({ ...base, capacity: 5 }, 4)).toBe("open");
    expect(registrationState({ ...base, capacity: 5 }, 5)).toBe("full");
    expect(registrationState({ ...base, capacity: 5, waitlistEnabled: true }, 7)).toBe("waitlist");
  });
});

describe("summarizeStatuses", () => {
  it("computes seats, attendance and show-up rates", () => {
    const s = summarizeStatuses({ registered: 2, confirmed: 1, waitlisted: 2, attended: 3, no_show: 1, cancelled: 4 });
    expect(s.seatsTaken).toBe(7);
    expect(s.nonCancelled).toBe(9);
    expect(s.attendanceRate).toBeCloseTo(3 / 9);
    expect(s.showUpRate).toBeCloseTo(3 / 4);
  });
  it("returns null rates for empty events", () => {
    const s = summarizeStatuses({});
    expect(s.attendanceRate).toBeNull();
    expect(s.showUpRate).toBeNull();
  });
});

describe("durations", () => {
  it("formats offsets", () => {
    expect(formatOffset(1440)).toBe("1 day");
    expect(formatOffset(60)).toBe("1 hour");
    expect(formatOffset(90)).toBe("1 hour 30 minutes");
    expect(formatOffset(2 * 1440 + 120)).toBe("2 days 2 hours");
    expect(formatOffset(0)).toBe("at the start");
  });
  it("picks the largest even unit", () => {
    expect(splitDuration(2880)).toEqual({ amount: 2, unit: "days" });
    expect(splitDuration(120)).toEqual({ amount: 2, unit: "hours" });
    expect(splitDuration(45)).toEqual({ amount: 45, unit: "minutes" });
  });
});

describe("capacityUsage", () => {
  it("is null without a capacity and flags over-booking", () => {
    expect(capacityUsage(3, null)).toBeNull();
    expect(capacityUsage(5, 10)).toMatchObject({ ratio: 0.5, over: false, full: false, left: 5 });
    expect(capacityUsage(12, 10)).toMatchObject({ ratio: 1, over: true, full: true, left: 0 });
  });
});

describe("bucketByDay", () => {
  it("fills gaps and accumulates totals", () => {
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    const out = bucketByDay(
      [new Date("2030-01-01T10:00:00Z"), new Date("2030-01-01T11:00:00Z"), new Date("2030-01-03T09:00:00Z")],
      fmt,
      new Date("2030-01-01T10:00:00Z"),
      new Date("2030-01-04T00:00:00Z"),
    );
    expect(out).toEqual([
      { date: "2030-01-01", count: 2, total: 2 },
      { date: "2030-01-02", count: 0, total: 2 },
      { date: "2030-01-03", count: 1, total: 3 },
      { date: "2030-01-04", count: 0, total: 3 },
    ]);
  });
});
