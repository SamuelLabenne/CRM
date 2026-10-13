import { describe, expect, it } from "vitest";
import { htmlExcerpt, isEmailBodyEmpty, normalizeEditorHtml, prepareForPreviewFrame, stripTrackingFromHtml } from "./html";
import { parseZonedLocal, toZonedLocalInput } from "./schedule";
import { audienceSchema, broadcastInputSchema } from "./schemas";

describe("normalizeEditorHtml", () => {
  it("flattens single-paragraph list items but keeps multi-paragraph ones", () => {
    expect(normalizeEditorHtml("<ul><li><p>One</p></li><li><p>Two <strong>b</strong></p></li></ul>")).toBe("<ul><li>One</li><li>Two <strong>b</strong></li></ul>");
    const multi = "<ul><li><p>a</p><p>b</p></li></ul>";
    expect(normalizeEditorHtml(multi)).toBe(multi);
  });
  it("treats an empty document as empty", () => {
    expect(normalizeEditorHtml("<p></p>")).toBe("");
    expect(normalizeEditorHtml("<p><br></p>")).toBe("");
    expect(normalizeEditorHtml("<p>Hi</p>")).toBe("<p>Hi</p>");
  });
});

describe("isEmailBodyEmpty", () => {
  it("detects visible content", () => {
    expect(isEmailBodyEmpty("")).toBe(true);
    expect(isEmailBodyEmpty("<p> &nbsp; </p>")).toBe(true);
    expect(isEmailBodyEmpty("<p>Hello</p>")).toBe(false);
    expect(isEmailBodyEmpty('<p><img src="https://x.y/a.png"></p>')).toBe(false);
    expect(isEmailBodyEmpty("<hr>")).toBe(false);
  });
});

describe("stripTrackingFromHtml", () => {
  const id = "11111111-2222-4333-8444-555555555555";
  it("removes the open pixel and unwraps click links", () => {
    const html =
      `<a style="x" href="http://localhost:3000/api/t/c/${id}?u=${encodeURIComponent("https://example.com/a?x=1&y=2")}&amp;s=abc123">Go</a>` +
      `<img src="http://localhost:3000/api/t/o/${id}" width="1" height="1" alt="" style="display:block;">`;
    const out = stripTrackingFromHtml(html);
    expect(out).not.toContain("/api/t/");
    expect(out).toContain('href="https://example.com/a?x=1&amp;y=2"');
    expect(out).toContain(">Go</a>");
  });
  it("leaves other links and images alone", () => {
    const html = '<a href="https://example.com">x</a><img src="https://example.com/logo.png">';
    expect(stripTrackingFromHtml(html)).toBe(html);
  });
});

describe("prepareForPreviewFrame / htmlExcerpt", () => {
  it("adds a base target", () => {
    expect(prepareForPreviewFrame("<html><head><title>x</title></head></html>")).toContain('<head><base target="_blank">');
    expect(prepareForPreviewFrame("<p>x</p>").startsWith('<base target="_blank">')).toBe(true);
  });
  it("makes a short plain-text excerpt", () => {
    expect(htmlExcerpt("<h1>Hello</h1><p>World &amp; more</p>")).toBe("Hello World & more");
    expect(htmlExcerpt("<p>" + "a".repeat(300) + "</p>", 20)).toHaveLength(20);
  });
});

describe("schedule helpers", () => {
  it("converts wall-clock time in a timezone to an instant and back", () => {
    const d = parseZonedLocal("2026-10-20T09:30", "Australia/Perth")!;
    expect(d.toISOString()).toBe("2026-10-20T01:30:00.000Z");
    expect(toZonedLocalInput(d, "Australia/Perth")).toBe("2026-10-20T09:30");
    expect(parseZonedLocal("2026-01-15T12:00", "America/New_York")!.toISOString()).toBe("2026-01-15T17:00:00.000Z");
  });
  it("rejects invalid input", () => {
    expect(parseZonedLocal("", "UTC")).toBeNull();
    expect(parseZonedLocal("tomorrow", "UTC")).toBeNull();
    expect(parseZonedLocal("2026-02-31T10:00", "UTC")).toBeNull();
  });
});

describe("audience schema", () => {
  const id = "3f6c2d0e-8b8a-4c3e-9d57-0a1b2c3d4e5f";
  it("accepts every audience variant", () => {
    const variants = [
      { type: "all" },
      { type: "view", viewId: id },
      { type: "tags", tagIds: [id], match: "all" },
      { type: "event", eventId: id, statuses: ["attended", "no_show"] },
      { type: "campaign", campaignId: id },
      { type: "contacts", contactIds: [id] },
      { type: "filter", filter: { match: "any", filters: [{ field: "stage", operator: "is", value: "new" }, { field: "tag", operator: "has", value: [id] }] } },
    ];
    for (const v of variants) expect(audienceSchema.safeParse(v).success).toBe(true);
  });
  it("rejects malformed audiences", () => {
    expect(audienceSchema.safeParse({ type: "view", viewId: "nope" }).success).toBe(false);
    expect(audienceSchema.safeParse({ type: "wat" }).success).toBe(false);
    expect(audienceSchema.safeParse({ type: "tags", tagIds: [id], match: "some" }).success).toBe(false);
  });
  it("validates broadcast input", () => {
    const base = { name: "x", audience: { type: "all" } };
    expect(broadcastInputSchema.safeParse(base).success).toBe(true);
    expect(broadcastInputSchema.safeParse({ ...base, name: "  " }).success).toBe(false);
  });
});
