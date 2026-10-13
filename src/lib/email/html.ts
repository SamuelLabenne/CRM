// Pure HTML helpers for the email editor & outbox viewer. Safe to import on the client.

const EMPTY_BLOCK = /^<p(?:\s[^>]*)?>\s*(?:<br\s*\/?>)?\s*<\/p>$/i;

/**
 * Clean up the HTML produced by the TipTap editor so it renders well in email clients:
 *  - single-paragraph list items are flattened (`<li><p>x</p></li>` → `<li>x</li>`), otherwise the
 *    paragraph margin from `inlineEmailStyles` adds big gaps between bullets;
 *  - a document that only contains empty paragraphs becomes "".
 */
export function normalizeEditorHtml(html: string): string {
  const flat = html.replace(
    /<li(\s[^>]*)?>\s*<p(?:\s[^>]*)?>((?:(?!<p[\s>]|<\/p>)[\s\S])*)<\/p>\s*<\/li>/gi,
    (_m, attrs: string | undefined, inner: string) => `<li${attrs ?? ""}>${inner}</li>`,
  );
  const trimmed = flat.trim();
  if (!trimmed || EMPTY_BLOCK.test(trimmed)) return "";
  return flat;
}

/** True when an email body has no visible content (no text, images or dividers). */
export function isEmailBodyEmpty(html: string | null | undefined): boolean {
  if (!html) return true;
  if (/<(img|hr)\b/i.test(html)) return false;
  const text = html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;|&#160;/g, " ")
    .trim();
  return text.length === 0;
}

const OPEN_PIXEL = /<img\b[^>]*\/api\/t\/o\/[0-9a-f-]{36}[^>]*>/gi;
const CLICK_HREF = /href="[^"]*\/api\/t\/c\/[0-9a-f-]{36}\?u=([^&"]+)(?:&amp;|&)s=[^"]*"/gi;

/**
 * Remove open-tracking pixels and unwrap click-tracking links in a stored message so that
 * viewing it in the outbox never records an open/click and links show their real destination.
 */
export function stripTrackingFromHtml(html: string): string {
  return html.replace(OPEN_PIXEL, "").replace(CLICK_HREF, (_m, encoded: string) => {
    let url = encoded;
    try {
      url = decodeURIComponent(encoded);
    } catch {
      // keep the raw value
    }
    return `href="${url.replace(/&/g, "&amp;").replace(/"/g, "%22")}"`;
  });
}

/**
 * Prepare an HTML document for display in a sandboxed preview iframe:
 * links open in a new context (and are inert when the iframe has no `allow-popups`).
 */
export function prepareForPreviewFrame(html: string): string {
  const base = `<base target="_blank">`;
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head([^>]*)>/i, `<head$1>${base}`);
  return `${base}${html}`;
}

/** Plain-text excerpt of an HTML snippet (for list rows and previews). */
export function htmlExcerpt(html: string, max = 140): string {
  const text = html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
