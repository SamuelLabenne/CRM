import { describe, expect, it } from "vitest";
import type { WeeklyAvailability } from "@/lib/types";
import {
  addDaysToKey,
  addMonthsToKey,
  computeSlots,
  formatSlotTime,
  groupSlotsByDate,
  hostSlotStarts,
  hostsFreeAt,
  localDateKey,
  monthRange,
  parseHm,
  pickRoundRobinHost,
  resolveTimezone,
  weekdayOfKey,
  windowsForDate,
  zonedInstant,
  type BusyInterval,
  type SlotConfig,
  type SlotHost,
} from "./slots-core";

const baseConfig: SlotConfig = {
  durationMinutes: 30,
  bufferBeforeMinutes: 0,
  bufferAfterMinutes: 0,
  minNoticeMinutes: 0,
  maxDaysAhead: 7,
  slotIncrementMinutes: 30,
  dailyLimit: null,
};

const cfg = (o: Partial<SlotConfig> = {}): SlotConfig => ({ ...baseConfig, ...o });
const host = (o: Partial<SlotHost> = {}): SlotHost => ({
  id: "h1",
  timezone: "UTC",
  availability: null,
  dateOverrides: [],
  ...o,
});
const weekly = (partial: Partial<WeeklyAvailability>): WeeklyAvailability => ({
  "0": [],
  "1": [],
  "2": [],
  "3": [],
  "4": [],
  "5": [],
  "6": [],
  ...partial,
});
const at = (iso: string) => new Date(iso);
const busy = (hostId: string, start: string, end: string, isMeeting = true): BusyInterval => ({
  hostId,
  start: at(start),
  end: at(end),
  isMeeting,
});
const starts = (cfgIn: SlotConfig, h: SlotHost, b: BusyInterval[], now: string, range = {}) =>
  hostSlotStarts(cfgIn, h, b, at(now), range).map((ms) => new Date(ms).toISOString());
const times = (isoList: string[], tz: string) => isoList.map((s) => formatSlotTime(s, tz, false));

describe("helpers", () => {
  it("parses HH:mm", () => {
    expect(parseHm("09:30")).toBe(570);
    expect(parseHm("9:05")).toBe(545);
    expect(parseHm("24:00")).toBe(1440);
    expect(parseHm("24:30")).toBeNull();
    expect(parseHm("25:00")).toBeNull();
    expect(parseHm("12:60")).toBeNull();
    expect(parseHm("nope")).toBeNull();
  });

  it("does calendar arithmetic on date keys", () => {
    expect(addDaysToKey("2026-02-27", 2)).toBe("2026-03-01");
    expect(addDaysToKey("2026-12-31", 1)).toBe("2027-01-01");
    expect(weekdayOfKey("2026-10-04")).toBe(0); // Sunday
    expect(weekdayOfKey("2026-10-05")).toBe(1);
    expect(addMonthsToKey("2026-12", 1)).toBe("2027-01");
    expect(addMonthsToKey("2026-01", -1)).toBe("2025-12");
  });

  it("converts local wall-clock time to instants with DST", () => {
    // Sydney: AEST +10 before 2026-10-04, AEDT +11 after
    expect(new Date(zonedInstant("2026-10-03", 9 * 60, "Australia/Sydney")).toISOString()).toBe("2026-10-02T23:00:00.000Z");
    expect(new Date(zonedInstant("2026-10-05", 9 * 60, "Australia/Sydney")).toISOString()).toBe("2026-10-04T22:00:00.000Z");
    expect(new Date(zonedInstant("2026-10-25", 24 * 60, "Europe/Brussels")).toISOString()).toBe("2026-10-25T23:00:00.000Z");
    expect(localDateKey(at("2026-10-04T15:00:00Z"), "Australia/Sydney")).toBe("2026-10-05");
    expect(localDateKey(at("2026-10-04T15:00:00Z"), "America/Los_Angeles")).toBe("2026-10-04");
  });

  it("falls back to a valid timezone", () => {
    expect(resolveTimezone(null, "Nope/Zone", "Europe/Brussels", "UTC")).toBe("Europe/Brussels");
    expect(resolveTimezone(undefined, null)).toBe("UTC");
  });

  it("builds windows from weekly hours, overrides and ignores invalid ones", () => {
    const h = host({
      availability: weekly({ "1": [{ start: "13:00", end: "14:00" }, { start: "09:00", end: "10:00" }, { start: "bad", end: "11:00" }, { start: "12:00", end: "12:00" }] }),
      dateOverrides: [{ date: "2026-10-19", slots: [] }],
    });
    expect(windowsForDate(h, "2026-10-12")).toEqual([
      [540, 600],
      [780, 840],
    ]);
    expect(windowsForDate(h, "2026-10-19")).toEqual([]); // override: unavailable
    expect(windowsForDate(h, "2026-10-13")).toEqual([]); // Tuesday not configured
  });
});

describe("weekly availability & timezones", () => {
  it("defaults to Mon–Fri 09:00–17:00 in the host timezone", () => {
    // Sunday 2026-10-11 00:00 UTC; the next Monday is 2026-10-12
    const s = starts(cfg(), host(), [], "2026-10-11T00:00:00Z");
    const days = new Set(s.map((x) => x.slice(0, 10)));
    expect([...days]).toEqual(["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16"]); // today + 7 = Sunday 18th
    const monday = s.filter((x) => x.startsWith("2026-10-12"));
    expect(monday).toHaveLength(16);
    expect(monday[0]).toBe("2026-10-12T09:00:00.000Z");
    expect(monday[15]).toBe("2026-10-12T16:30:00.000Z");
  });

  it("interprets hours in the host timezone (Sydney, AEDT +11)", () => {
    const h = host({ timezone: "Australia/Sydney" });
    const s = starts(cfg({ maxDaysAhead: 7 }), h, [], "2026-10-10T00:00:00Z"); // Saturday
    expect(s[0]).toBe("2026-10-11T22:00:00.000Z"); // Mon 09:00 AEDT
    expect(s).toHaveLength(5 * 16); // Mon–Fri
    expect(times(s.slice(0, 16), "Australia/Sydney")[15]).toBe("16:30");
  });

  it("handles the Sydney DST start (02:00 → 03:00 is skipped)", () => {
    const h = host({ timezone: "Australia/Sydney", dateOverrides: [{ date: "2026-10-04", slots: [{ start: "00:00", end: "06:00" }] }] });
    const s = starts(cfg(), h, [], "2026-10-01T00:00:00Z").filter((x) => x < "2026-10-04T20:00:00Z" && x > "2026-10-03T00:00:00Z");
    expect(times(s, "Australia/Sydney")).toEqual(["00:00", "00:30", "01:00", "01:30", "03:00", "03:30", "04:00", "04:30", "05:00", "05:30"]);
    expect(s[0]).toBe("2026-10-03T14:00:00.000Z"); // 00:00 AEST (+10)
    expect(s[9]).toBe("2026-10-03T18:30:00.000Z"); // 05:30 AEDT (+11)
  });

  it("handles the Sydney DST end (02:00–03:00 happens twice)", () => {
    const h = host({ timezone: "Australia/Sydney", dateOverrides: [{ date: "2026-04-05", slots: [{ start: "01:00", end: "05:00" }] }] });
    const s = starts(cfg({ maxDaysAhead: 10 }), h, [], "2026-04-01T00:00:00Z").filter((x) => x >= "2026-04-04T00:00:00Z" && x < "2026-04-05T00:00:00Z");
    expect(s).toHaveLength(10); // 4 wall-clock hours + the repeated hour
    expect(s[0]).toBe("2026-04-04T14:00:00.000Z"); // 01:00 AEDT (+11)
    expect(s[9]).toBe("2026-04-04T18:30:00.000Z"); // 04:30 AEST (+10)
    const gaps = s.slice(1).map((x, i) => new Date(x).getTime() - new Date(s[i]).getTime());
    expect(new Set(gaps)).toEqual(new Set([30 * 60_000]));
  });

  it("handles the Brussels DST start (2026-03-29) and end (2026-10-25)", () => {
    const spring = host({ timezone: "Europe/Brussels", dateOverrides: [{ date: "2026-03-29", slots: [{ start: "01:00", end: "04:00" }] }] });
    const a = starts(cfg({ maxDaysAhead: 10 }), spring, [], "2026-03-27T00:00:00Z").filter((x) => x >= "2026-03-28T23:00:00Z" && x < "2026-03-30T00:00:00Z");
    expect(times(a, "Europe/Brussels")).toEqual(["01:00", "01:30", "03:00", "03:30"]);

    const autumn = host({ timezone: "Europe/Brussels", dateOverrides: [{ date: "2026-10-25", slots: [{ start: "01:00", end: "04:00" }] }] });
    const b = starts(cfg({ maxDaysAhead: 10 }), autumn, [], "2026-10-23T00:00:00Z").filter((x) => x >= "2026-10-24T22:00:00Z" && x < "2026-10-25T04:00:00Z");
    expect(b).toHaveLength(8); // 3 wall-clock hours + the repeated hour
    expect(b[0]).toBe("2026-10-24T23:00:00.000Z");
    expect(b[7]).toBe("2026-10-25T02:30:00.000Z");
  });

  it("keeps 09:00 local across a DST change (Brussels workday offsets)", () => {
    const h = host({ timezone: "Europe/Brussels" });
    const s = starts(cfg({ maxDaysAhead: 10 }), h, [], "2026-03-26T00:00:00Z");
    expect(s.find((x) => x.startsWith("2026-03-27"))).toBe("2026-03-27T08:00:00.000Z"); // CET +1
    expect(s.find((x) => x.startsWith("2026-03-30"))).toBe("2026-03-30T07:00:00.000Z"); // CEST +2
  });

  it("supports visitor timezones different from the host's (grouping by visitor date)", () => {
    const h = host({ timezone: "America/Los_Angeles" }); // PDT -7 in October
    const slots = computeSlots({ config: cfg({ maxDaysAhead: 3 }), hosts: [h], busy: [], now: at("2026-10-04T12:00:00Z") });
    const iso = slots.map((x) => x.start);
    const la = groupSlotsByDate(iso, "America/Los_Angeles");
    expect(Object.keys(la)).toEqual(["2026-10-05", "2026-10-06", "2026-10-07"]);
    // Sydney is +11: Monday 09:00–17:00 PDT is Tuesday 03:00–11:00 AEDT
    const syd = groupSlotsByDate(iso, "Australia/Sydney");
    expect(Object.keys(syd)).toEqual(["2026-10-06", "2026-10-07", "2026-10-08"]);
    expect(formatSlotTime(syd["2026-10-06"][0], "Australia/Sydney", false)).toBe("03:00");
    expect(formatSlotTime(syd["2026-10-06"][0], "Australia/Sydney", true)).toBe("3:00am");
    expect(formatSlotTime(la["2026-10-05"][8], "America/Los_Angeles", true)).toBe("1:00pm");
  });

  it("splits one host day across two visitor dates when it straddles the visitor's midnight", () => {
    const h = host({ timezone: "UTC", dateOverrides: [{ date: "2026-10-05", slots: [{ start: "12:00", end: "14:00" }] }] });
    const s = starts(cfg({ maxDaysAhead: 3 }), h, [], "2026-10-04T00:00:00Z").filter((x) => x.startsWith("2026-10-05"));
    const grouped = groupSlotsByDate(s, "Australia/Sydney"); // UTC+11 → 12:00Z is 23:00
    expect(Object.keys(grouped)).toEqual(["2026-10-05", "2026-10-06"]);
    expect(grouped["2026-10-05"]).toHaveLength(2);
    expect(grouped["2026-10-06"]).toHaveLength(2);
  });

  it("computes month ranges in the visitor timezone", () => {
    const r = monthRange("2026-10", "Australia/Sydney");
    expect(r.from.toISOString()).toBe("2026-09-30T14:00:00.000Z"); // 1 Oct 00:00 AEST (+10)
    expect(r.to.toISOString()).toBe("2026-10-31T13:00:00.000Z"); // 1 Nov 00:00 AEDT (+11)
  });
});

describe("page limits", () => {
  it("respects minimum notice", () => {
    const now = "2026-10-12T09:10:00Z"; // Monday
    expect(starts(cfg({ minNoticeMinutes: 0 }), host(), [], now)[0]).toBe("2026-10-12T09:30:00.000Z");
    expect(starts(cfg({ minNoticeMinutes: 60 }), host(), [], now)[0]).toBe("2026-10-12T10:30:00.000Z");
    expect(starts(cfg({ minNoticeMinutes: 60 * 24 }), host(), [], now)[0]).toBe("2026-10-13T09:30:00.000Z");
  });

  it("respects max days ahead (calendar days in the host timezone)", () => {
    const now = "2026-10-12T08:00:00Z"; // Monday
    const days = (n: number) => [...new Set(starts(cfg({ maxDaysAhead: n }), host(), [], now).map((x) => x.slice(0, 10)))];
    expect(days(0)).toEqual(["2026-10-12"]);
    expect(days(2)).toEqual(["2026-10-12", "2026-10-13", "2026-10-14"]);
    expect(days(7)).toContain("2026-10-19");
    expect(days(7)).not.toContain("2026-10-20");
  });

  it("supports different increments and durations", () => {
    const h = host({ dateOverrides: [{ date: "2026-10-12", slots: [{ start: "09:00", end: "11:00" }] }] });
    const one = (o: Partial<SlotConfig>) => starts(cfg({ maxDaysAhead: 0, ...o }), h, [], "2026-10-12T00:00:00Z");
    expect(one({ durationMinutes: 60, slotIncrementMinutes: 15 }).map((x) => x.slice(11, 16))).toEqual(["09:00", "09:15", "09:30", "09:45", "10:00"]);
    expect(one({ durationMinutes: 30, slotIncrementMinutes: 60 }).map((x) => x.slice(11, 16))).toEqual(["09:00", "10:00"]);
    expect(one({ durationMinutes: 45, slotIncrementMinutes: 45 }).map((x) => x.slice(11, 16))).toEqual(["09:00", "09:45"]);
    expect(one({ durationMinutes: 150 })).toEqual([]); // longer than the window
  });

  it("never offers a slot that runs past the end of the window", () => {
    const h = host();
    const monday = starts(cfg({ durationMinutes: 60, slotIncrementMinutes: 30, maxDaysAhead: 0 }), h, [], "2026-10-12T00:00:00Z");
    expect(monday[monday.length - 1]).toBe("2026-10-12T16:00:00.000Z");
  });

  it("applies buffers before and after existing events", () => {
    const b = [busy("h1", "2026-10-12T10:00:00Z", "2026-10-12T10:30:00Z")];
    const day = (o: Partial<SlotConfig>) =>
      starts(cfg({ maxDaysAhead: 0, ...o }), host({ dateOverrides: [{ date: "2026-10-12", slots: [{ start: "09:00", end: "12:00" }] }] }), b, "2026-10-12T00:00:00Z").map((x) => x.slice(11, 16));
    expect(day({})).toEqual(["09:00", "09:30", "10:30", "11:00", "11:30"]);
    // 15 min buffers on each side: 09:30–10:00 would touch 10:00 → blocked; 10:30 starts at 10:15 → blocked
    expect(day({ bufferBeforeMinutes: 15, bufferAfterMinutes: 15 })).toEqual(["09:00", "11:00", "11:30"]);
    // only a buffer before: 09:30 is fine (it ends when the busy block starts) but 10:30 needs 15 free minutes first
    expect(day({ bufferBeforeMinutes: 15 })).toEqual(["09:00", "09:30", "11:00", "11:30"]);
    // only a buffer after: 09:30 ends 10:00 + 15 → blocked
    expect(day({ bufferAfterMinutes: 15 })).toEqual(["09:00", "10:30", "11:00", "11:30"]);
  });

  it("ignores other hosts' busy time", () => {
    const b = [busy("someone-else", "2026-10-12T09:00:00Z", "2026-10-12T17:00:00Z")];
    expect(starts(cfg({ maxDaysAhead: 0 }), host(), b, "2026-10-12T00:00:00Z")).toHaveLength(16);
  });

  it("blocks overlapping events of any kind (and treats back-to-back as free)", () => {
    const b = [busy("h1", "2026-10-12T09:15:00Z", "2026-10-12T10:15:00Z", false)];
    const s = starts(cfg({ maxDaysAhead: 0 }), host(), b, "2026-10-12T00:00:00Z").map((x) => x.slice(11, 16));
    expect(s.slice(0, 3)).toEqual(["10:30", "11:00", "11:30"]);
    const exact = [busy("h1", "2026-10-12T09:00:00Z", "2026-10-12T10:00:00Z")];
    expect(starts(cfg({ maxDaysAhead: 0 }), host(), exact, "2026-10-12T00:00:00Z")[0]).toBe("2026-10-12T10:00:00.000Z");
  });

  it("enforces the daily limit per host using the host's local day", () => {
    const h = host({ timezone: "Australia/Sydney" });
    const now = "2026-10-10T00:00:00Z";
    // Tuesday 2026-10-13 09:30 AEDT = Monday 22:30Z; Tuesday has 2 meetings → full. Wednesday has 1.
    const b = [
      busy("h1", "2026-10-12T22:30:00Z", "2026-10-12T23:00:00Z"),
      busy("h1", "2026-10-13T03:00:00Z", "2026-10-13T03:30:00Z"),
      busy("h1", "2026-10-14T03:00:00Z", "2026-10-14T03:30:00Z"),
    ];
    const s = starts(cfg({ dailyLimit: 2, maxDaysAhead: 7 }), h, b, now);
    const localDays = new Set(s.map((x) => localDateKey(at(x), "Australia/Sydney")));
    expect(localDays.has("2026-10-12")).toBe(true);
    expect(localDays.has("2026-10-13")).toBe(false); // limit reached
    expect(localDays.has("2026-10-14")).toBe(true); // 1 of 2
    // non-meeting events do not count towards the limit
    const evts = [busy("h1", "2026-10-12T22:30:00Z", "2026-10-12T23:00:00Z", false), busy("h1", "2026-10-13T00:00:00Z", "2026-10-13T00:30:00Z", false)];
    const s2 = starts(cfg({ dailyLimit: 2, maxDaysAhead: 7 }), h, evts, now);
    expect(new Set(s2.map((x) => localDateKey(at(x), "Australia/Sydney"))).has("2026-10-13")).toBe(true);
    // without a limit nothing changes
    expect(starts(cfg({ dailyLimit: null, maxDaysAhead: 7 }), h, b, now).length).toBeGreaterThan(s.length);
  });

  it("limits slots to the requested range", () => {
    const s = starts(cfg({ maxDaysAhead: 14 }), host(), [], "2026-10-12T00:00:00Z", {
      from: at("2026-10-13T10:00:00Z"),
      to: at("2026-10-13T11:00:00Z"),
    });
    expect(s).toEqual(["2026-10-13T10:00:00.000Z", "2026-10-13T10:30:00.000Z"]);
    expect(starts(cfg(), host(), [], "2026-10-12T00:00:00Z", { from: at("2026-10-13T11:00:00Z"), to: at("2026-10-13T11:00:00Z") })).toEqual([]);
  });
});

describe("date overrides", () => {
  const w = weekly({ "3": [{ start: "09:00", end: "17:00" }] }); // Wednesdays only
  const run = (overrides: SlotHost["dateOverrides"]) =>
    starts(cfg({ maxDaysAhead: 13 }), host({ availability: w, dateOverrides: overrides }), [], "2026-10-12T00:00:00Z");

  it("uses weekly hours without overrides", () => {
    const s = run([]);
    expect(new Set(s.map((x) => x.slice(0, 10)))).toEqual(new Set(["2026-10-14", "2026-10-21"]));
  });

  it("replaces a day's hours with custom hours", () => {
    const s = run([{ date: "2026-10-14", slots: [{ start: "10:00", end: "11:00" }] }]);
    expect(s.filter((x) => x.startsWith("2026-10-14")).map((x) => x.slice(11, 16))).toEqual(["10:00", "10:30"]);
    expect(s.filter((x) => x.startsWith("2026-10-21"))).toHaveLength(16);
  });

  it("marks a day as unavailable with an empty slots array", () => {
    const s = run([{ date: "2026-10-14", slots: [] }]);
    expect(s.some((x) => x.startsWith("2026-10-14"))).toBe(false);
    expect(s.some((x) => x.startsWith("2026-10-21"))).toBe(true);
  });

  it("can open a day that is normally off, with several windows", () => {
    const s = run([
      {
        date: "2026-10-18", // Sunday
        slots: [
          { start: "09:00", end: "10:00" },
          { start: "13:00", end: "14:00" },
        ],
      },
    ]);
    expect(s.filter((x) => x.startsWith("2026-10-18")).map((x) => x.slice(11, 16))).toEqual(["09:00", "09:30", "13:00", "13:30"]);
  });

  it("de-duplicates overlapping windows", () => {
    const s = run([
      {
        date: "2026-10-18",
        slots: [
          { start: "09:00", end: "11:00" },
          { start: "10:00", end: "12:00" },
        ],
      },
    ]).filter((x) => x.startsWith("2026-10-18"));
    expect(s.map((x) => x.slice(11, 16))).toEqual(["09:00", "09:30", "10:00", "10:30", "11:00", "11:30"]);
  });
});

describe("multiple hosts", () => {
  const a = host({ id: "A", availability: weekly({ "1": [{ start: "09:00", end: "12:00" }] }) });
  const b = host({ id: "B", availability: weekly({ "1": [{ start: "11:00", end: "14:00" }] }) });
  const input = { config: cfg({ maxDaysAhead: 0 }), hosts: [a, b], busy: [] as BusyInterval[], now: at("2026-10-12T00:00:00Z") };

  it("returns the union of the hosts' slots with the hosts free for each", () => {
    const slots = computeSlots(input);
    expect(slots.map((s) => s.start.slice(11, 16))).toEqual(["09:00", "09:30", "10:00", "10:30", "11:00", "11:30", "12:00", "12:30", "13:00", "13:30"]);
    const byTime = Object.fromEntries(slots.map((s) => [s.start.slice(11, 16), s.hostIds]));
    expect(byTime["09:00"]).toEqual(["A"]);
    expect(byTime["11:00"]).toEqual(["A", "B"]);
    expect(byTime["13:30"]).toEqual(["B"]);
    expect(slots[0].end).toBe("2026-10-12T09:30:00.000Z");
  });

  it("drops a host from a slot when that host is busy", () => {
    const slots = computeSlots({ ...input, busy: [busy("A", "2026-10-12T11:00:00Z", "2026-10-12T11:30:00Z")] });
    const at11 = slots.find((s) => s.start.endsWith("11:00:00.000Z"));
    expect(at11?.hostIds).toEqual(["B"]);
  });

  it("supports hosts in different timezones", () => {
    const sydney = host({ id: "S", timezone: "Australia/Sydney", availability: weekly({ "1": [{ start: "09:00", end: "10:00" }] }) });
    const utc = host({ id: "U", timezone: "UTC", availability: weekly({ "1": [{ start: "22:00", end: "23:00" }] }) });
    // Monday 2026-10-12 09:00 AEDT = Sunday 22:00Z; UTC host works Monday 22:00Z
    const slots = computeSlots({ config: cfg({ maxDaysAhead: 2 }), hosts: [sydney, utc], busy: [], now: at("2026-10-11T00:00:00Z") });
    expect(slots.map((s) => `${s.start}:${s.hostIds.join("")}`)).toEqual([
      "2026-10-11T22:00:00.000Z:S",
      "2026-10-11T22:30:00.000Z:S",
      "2026-10-12T22:00:00.000Z:U",
      "2026-10-12T22:30:00.000Z:U",
    ]);
  });

  it("reports which hosts are free at an exact time", () => {
    const base = { config: input.config, hosts: input.hosts, busy: [busy("B", "2026-10-12T11:30:00Z", "2026-10-12T12:00:00Z")], now: input.now };
    expect(hostsFreeAt(base, at("2026-10-12T11:00:00Z"))).toEqual(["A", "B"]);
    expect(hostsFreeAt(base, at("2026-10-12T11:30:00Z"))).toEqual(["A"]);
    expect(hostsFreeAt(base, at("2026-10-12T12:00:00Z"))).toEqual(["B"]);
    expect(hostsFreeAt(base, at("2026-10-12T09:10:00Z"))).toEqual([]); // off the slot grid
    expect(hostsFreeAt(base, at("2026-10-12T15:00:00Z"))).toEqual([]); // outside the hours
    expect(hostsFreeAt(base, at("invalid"))).toEqual([]);
  });
});

describe("round robin", () => {
  const d = (s: string) => new Date(s);
  it("picks a host that has never been assigned first", () => {
    expect(pickRoundRobinHost(["A", "B"], { A: { lastAssignedAt: d("2026-10-01T00:00:00Z"), upcoming: 0 }, B: { lastAssignedAt: null, upcoming: 5 } })).toBe("B");
  });

  it("picks the host whose last meeting from the page is oldest", () => {
    const loads = {
      A: { lastAssignedAt: d("2026-10-03T00:00:00Z"), upcoming: 0 },
      B: { lastAssignedAt: d("2026-10-01T00:00:00Z"), upcoming: 9 },
      C: { lastAssignedAt: d("2026-10-02T00:00:00Z"), upcoming: 0 },
    };
    expect(pickRoundRobinHost(["A", "B", "C"], loads)).toBe("B");
    expect(pickRoundRobinHost(["A", "C"], loads)).toBe("C");
  });

  it("breaks ties by fewest upcoming meetings, then by order", () => {
    const same = d("2026-10-01T00:00:00Z");
    expect(pickRoundRobinHost(["A", "B", "C"], { A: { lastAssignedAt: same, upcoming: 3 }, B: { lastAssignedAt: same, upcoming: 1 }, C: { lastAssignedAt: same, upcoming: 2 } })).toBe("B");
    expect(pickRoundRobinHost(["A", "B"], { A: { lastAssignedAt: null, upcoming: 0 }, B: { lastAssignedAt: null, upcoming: 0 } })).toBe("A");
    expect(pickRoundRobinHost(["B", "A"], {})).toBe("B");
  });

  it("returns null without candidates", () => {
    expect(pickRoundRobinHost([], {})).toBeNull();
  });
});
