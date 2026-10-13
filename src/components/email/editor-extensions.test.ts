import { describe, expect, it } from "vitest";
import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import TextAlign from "@tiptap/extension-text-align";
import { EmailLink, safeColor } from "./editor-extensions";
import { normalizeEditorHtml } from "@/lib/email/html";
import { inlineEmailStyles } from "@/lib/email/layout";

const schema = getSchema([
  StarterKit.configure({ link: false }),
  EmailLink.configure({ openOnClick: false, HTMLAttributes: { target: "_blank", rel: "noopener noreferrer", class: null } }),
  Image,
  TextAlign.configure({ types: ["heading", "paragraph"] }),
]);

/** Render a mark to an HTML string via its toDOM spec (no DOM needed). */
function renderMark(attrs: Record<string, unknown>) {
  const mark = schema.marks.link.create(attrs);
  const spec = mark.type.spec.toDOM!(mark, true) as [string, Record<string, string>, number];
  const attrString = Object.entries(spec[1])
    .map(([k, v]) => `${k}="${v}"`)
    .join(" ");
  return `<${spec[0]} ${attrString}>Label</${spec[0]}>`;
}

describe("EmailLink (button support)", () => {
  it("renders buttons with data-button and data-color so inlineEmailStyles can style them", () => {
    const html = renderMark({ href: "https://example.com/go", button: true, color: "#ff0000" });
    expect(html).toContain('data-button=""');
    expect(html).toContain('data-color="#ff0000"');
    const cleaned = normalizeEditorHtml(`<p>${html}</p>`);
    expect(cleaned).not.toContain("--btn-color");
    const styled = inlineEmailStyles(cleaned, "#4f46e5");
    expect(styled).toContain("display:inline-block;background:#ff0000");
  });

  it("falls back to the brand color and plain links stay plain", () => {
    const button = inlineEmailStyles(normalizeEditorHtml(`<p>${renderMark({ href: "{{attendee.manage_url}}", button: true })}</p>`), "#123456");
    expect(button).toContain("background:#123456");
    expect(button).toContain('href="{{attendee.manage_url}}"');
    const plain = renderMark({ href: "https://example.com" });
    expect(plain).not.toContain("data-button");
    expect(plain).not.toContain("data-color");
  });

  it("parses buttons from stored HTML (system templates only have HTML)", () => {
    const rule = schema.marks.link.spec.parseDOM!.find((r) => r.tag === "a[href]")!;
    const el = (attrs: Record<string, string>) =>
      ({ getAttribute: (n: string) => attrs[n] ?? null, hasAttribute: (n: string) => n in attrs }) as unknown as HTMLElement;
    const getAttrs = rule.getAttrs as (dom: HTMLElement) => false | Record<string, unknown> | null;
    const button = getAttrs(el({ href: "{{attendee.calendar_url}}", "data-button": "", "data-color": "#10b981" })) as Record<string, unknown>;
    expect(button).toMatchObject({ href: "{{attendee.calendar_url}}", button: true, color: "#10b981" });
    const plain = getAttrs(el({ href: "https://example.com" })) as Record<string, unknown>;
    expect(plain).toMatchObject({ href: "https://example.com", button: false, color: null });
    // javascript: links are rejected outright
    expect(getAttrs(el({ href: "javascript:alert(1)" }))).toBe(false);
  });

  it("only accepts hex colors", () => {
    expect(safeColor("#abc")).toBe("#abc");
    expect(safeColor("#4f46e5")).toBe("#4f46e5");
    expect(safeColor("red; background:url(x)")).toBeNull();
    expect(safeColor(null)).toBeNull();
    const html = renderMark({ href: "https://x.y", button: true, color: "javascript:alert(1)" });
    expect(html).not.toContain("javascript");
  });

  it("knows the nodes and marks the toolbar relies on", () => {
    for (const n of ["paragraph", "heading", "bulletList", "orderedList", "blockquote", "horizontalRule", "image"]) expect(schema.nodes[n]).toBeTruthy();
    for (const m of ["bold", "italic", "underline", "strike", "link"]) expect(schema.marks[m]).toBeTruthy();
  });
});
