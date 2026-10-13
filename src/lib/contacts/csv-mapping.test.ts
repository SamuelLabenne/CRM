import { describe, expect, it } from "vitest";
import { guessMapping, mapCsvRow, type ImportField, type MapContext } from "./csv-mapping";
import { coerceCustomValue, parseDateOnly } from "./custom-values";
import { normalizeEmailLoose, normalizePhoneLoose, splitNameLoose } from "./normalize";
import { normalizeEmail, normalizePhone, splitName } from "./index";

const ctx: MapContext = {
  stages: [
    { key: "new", label: "New lead" },
    { key: "customer", label: "Customer" },
  ],
  customFields: [
    { key: "plan", label: "Plan", type: "select", options: ["Free", "Pro"] },
    { key: "seats", label: "Seats", type: "number" },
    { key: "newsletter", label: "Newsletter", type: "checkbox" },
    { key: "interests", label: "Interests", type: "multiselect", options: ["Events", "Email", "Sales"] },
    { key: "renewal", label: "Renewal date", type: "date" },
  ],
};

describe("normalisation parity with the server helpers", () => {
  it("matches normalizeEmail / normalizePhone / splitName", () => {
    for (const e of [" Ada@Example.COM ", "bad", "", null, "a@b.c"]) expect(normalizeEmailLoose(e)).toBe(normalizeEmail(e));
    for (const p of ["+61 400 123 456", "(08) 9000-1234", "123", "", null]) expect(normalizePhoneLoose(p)).toBe(normalizePhone(p));
    for (const n of ["Ada Lovelace", "Madonna", "  ", "Jan van der Berg", null]) expect(splitNameLoose(n)).toEqual(splitName(n));
  });
});

describe("guessMapping", () => {
  it("auto-maps common header names", () => {
    const headers = ["Full Name", "E-mail", "Mobile", "Company Name", "Job Title", "Tags", "Plan", "Something else", "Notes"];
    expect(guessMapping(headers, ctx.customFields)).toEqual([
      "full_name",
      "email",
      "phone",
      "company",
      "job_title",
      "tags",
      "custom:plan",
      "skip",
      "notes",
    ]);
  });

  it("uses each field at most once and handles first/last name", () => {
    const m = guessMapping(["First Name", "Last Name", "Email", "Email address", "Last activity date"]);
    expect(m).toEqual(["first_name", "last_name", "email", "skip", "skip"]);
  });

  it("matches whole words inside longer headers", () => {
    expect(guessMapping(["Billing email address"])).toEqual(["email"]);
  });
});

describe("mapCsvRow", () => {
  const mapping: ImportField[] = ["full_name", "email", "phone", "company", "tags", "stage", "deal_value", "custom:plan", "custom:seats", "custom:newsletter", "custom:interests", "custom:renewal"];

  it("normalises a complete row", () => {
    const res = mapCsvRow(
      ["Ada King Lovelace", " ADA@Example.com ", "+61 400 111 222", "Analytical Engines", "vip; speaker,vip", "customer", "$12,500", "pro", "5", "yes", "events|sales", "5/3/2024"],
      mapping,
      ctx,
      2,
    );
    expect(res.error).toBeUndefined();
    expect(res.input).toEqual({
      line: 2,
      firstName: "Ada",
      lastName: "King Lovelace",
      email: "ada@example.com",
      phone: "+61400111222",
      company: "Analytical Engines",
      tags: ["vip", "speaker"],
      stage: "customer",
      dealValue: 12500,
      customFields: { plan: "Pro", seats: 5, newsletter: true, interests: ["Events", "Sales"], renewal: "2024-03-05" },
    });
  });

  it("reports invalid emails and rows without any identity", () => {
    expect(mapCsvRow(["Bob", "not-an-email"], ["full_name", "email"], ctx, 3).error).toMatch(/Invalid email/);
    expect(mapCsvRow(["", "", "Acme"], ["email", "phone", "company"], ctx, 4).error).toMatch(/no name, email or phone/);
  });

  it("warns (but keeps the row) for unknown stages, bad numbers and invalid custom values", () => {
    const res = mapCsvRow(["a@b.co", "mystery", "abc", "gold", "maybe"], ["email", "stage", "deal_value", "custom:plan", "custom:newsletter"], ctx, 5);
    expect(res.input).toEqual({ line: 5, email: "a@b.co" });
    expect(res.warnings).toHaveLength(4);
  });

  it("prefers explicit first/last over full name and concatenates multiple notes columns", () => {
    const res = mapCsvRow(["Jo Bloggs", "Jane", "Doe", "line 1", "line 2"], ["full_name", "first_name", "last_name", "notes", "notes"], ctx, 6);
    expect(res.input).toMatchObject({ firstName: "Jane", lastName: "Doe", notes: "line 1\nline 2" });
  });
});

describe("custom values", () => {
  it("parses day-first dates and rejects impossible ones", () => {
    expect(parseDateOnly("31/12/2024")).toBe("2024-12-31");
    expect(parseDateOnly("2024-02-30")).toBeNull();
    expect(parseDateOnly("2024-03-05T10:00:00Z")).toBe("2024-03-05");
  });
  it("coerces by field type", () => {
    expect(coerceCustomValue({ key: "n", label: "N", type: "number" }, "1,200")).toEqual({ ok: true, value: 1200 });
    expect(coerceCustomValue({ key: "c", label: "C", type: "checkbox" }, "No")).toEqual({ ok: true, value: false });
    expect(coerceCustomValue({ key: "t", label: "T", type: "text" }, "   ")).toEqual({ ok: true, value: null });
  });
});
