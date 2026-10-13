import { describe, expect, it } from "vitest";
import { applyMergeTags, sampleMergeContext } from "./merge-tags";
import { inlineEmailStyles } from "./layout";

describe("applyMergeTags", () => {
  it("replaces nested keys and escapes html", () => {
    const out = applyMergeTags("Hi {{contact.first_name}}!", { contact: { first_name: "<Ada>" } });
    expect(out).toBe("Hi &lt;Ada&gt;!");
  });
  it("uses fallbacks for empty values", () => {
    expect(applyMergeTags(`Hi {{contact.first_name | "there"}}`, { contact: { first_name: "" } })).toBe("Hi there");
    expect(applyMergeTags(`Hi {{ contact.first_name | &quot;friend&quot; }}`, {})).toBe("Hi friend");
  });
  it("leaves plain text mode unescaped", () => {
    expect(applyMergeTags("{{contact.company}}", { contact: { company: "A & B" } }, { html: false })).toBe("A & B");
  });
  it("sample context covers every tag", () => {
    const ctx = sampleMergeContext();
    expect(applyMergeTags("{{event.title}} {{attendee.manage_url}} {{unsubscribe_url}}", ctx, { html: false })).not.toContain("{{");
  });
});

describe("inlineEmailStyles", () => {
  it("styles buttons and keeps existing styles", () => {
    const html = inlineEmailStyles('<p style="text-align: center"><a data-button href="https://x.y">Go</a></p>', "#123456");
    expect(html).toContain("background:#123456");
    expect(html).toContain("text-align: center");
  });
});
