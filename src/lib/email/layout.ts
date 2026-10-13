// Turns editor HTML into email-client-safe HTML: inline styles + a responsive
// table layout with header and footer. Safe to import on the client (previews).

import { escapeHtml } from "./merge-tags";

const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

function baseStyles(brandColor: string): Record<string, string> {
  return {
    p: "margin:0 0 16px;font-size:16px;line-height:1.6;color:#1f2937;",
    h1: "margin:0 0 16px;font-size:28px;line-height:1.25;font-weight:700;color:#111827;",
    h2: "margin:24px 0 12px;font-size:22px;line-height:1.3;font-weight:700;color:#111827;",
    h3: "margin:20px 0 8px;font-size:18px;line-height:1.35;font-weight:600;color:#111827;",
    a: `color:${brandColor};text-decoration:underline;`,
    ul: "margin:0 0 16px;padding-left:24px;color:#1f2937;",
    ol: "margin:0 0 16px;padding-left:24px;color:#1f2937;",
    li: "margin:0 0 6px;font-size:16px;line-height:1.6;",
    blockquote: "margin:0 0 16px;padding:8px 16px;border-left:4px solid #e5e7eb;color:#4b5563;",
    hr: "border:none;border-top:1px solid #e5e7eb;margin:24px 0;",
    img: "max-width:100%;height:auto;border:0;display:block;margin:0 auto 16px;border-radius:8px;",
    code: "font-family:Menlo,Consolas,monospace;font-size:14px;background:#f3f4f6;padding:2px 4px;border-radius:4px;",
  };
}

function buttonStyle(color: string) {
  return `display:inline-block;background:${color};color:#ffffff;text-decoration:none;font-weight:600;font-size:16px;line-height:1;padding:14px 24px;border-radius:8px;`;
}

/**
 * Add inline styles to tags produced by the editor. Existing inline styles
 * (e.g. text-align) are kept and win over the defaults.
 * Buttons are links with `data-button` (optionally `data-color="#hex"`).
 */
export function inlineEmailStyles(html: string, brandColor: string): string {
  const styles = baseStyles(brandColor);
  return html.replace(/<(p|h1|h2|h3|a|ul|ol|li|blockquote|hr|img|code)(\s[^>]*)?(\/?)>/gi, (_m, tag: string, attrs = "", selfClose: string) => {
    const t = tag.toLowerCase();
    let base = styles[t] ?? "";
    if (t === "a" && /\bdata-button\b/i.test(attrs)) {
      const color = /data-color="([^"]+)"/i.exec(attrs)?.[1] ?? brandColor;
      base = buttonStyle(color);
    }
    const styleMatch = /\sstyle="([^"]*)"/i.exec(attrs);
    let newAttrs: string;
    if (styleMatch) {
      newAttrs = attrs.replace(styleMatch[0], ` style="${base}${styleMatch[1]}"`);
    } else {
      newAttrs = `${attrs} style="${base}"`;
    }
    return `<${tag}${newAttrs}${selfClose}>`;
  });
}

export type LayoutOptions = {
  bodyHtml: string;
  preheader?: string | null;
  brandColor: string;
  workspaceName: string;
  logoUrl?: string | null;
  address?: string | null;
  /** Shown in the footer for marketing emails. */
  unsubscribeUrl?: string | null;
};

/** Wrap styled body HTML in a complete, responsive email document. */
export function renderEmailLayout(o: LayoutOptions): string {
  const header = o.logoUrl
    ? `<img src="${escapeHtml(o.logoUrl)}" alt="${escapeHtml(o.workspaceName)}" style="max-height:40px;max-width:200px;border:0;display:inline-block;">`
    : `<span style="font-size:18px;font-weight:700;color:#111827;letter-spacing:-0.01em;">${escapeHtml(o.workspaceName)}</span>`;
  const footerLines = [
    escapeHtml(o.workspaceName),
    o.address ? escapeHtml(o.address) : null,
    o.unsubscribeUrl
      ? `<a href="${escapeHtml(o.unsubscribeUrl)}" style="color:#6b7280;text-decoration:underline;">Unsubscribe</a> from these emails`
      : null,
  ].filter(Boolean);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<title>${escapeHtml(o.workspaceName)}</title>
<style>
  @media (max-width: 620px) { .container { width: 100% !important; } .card { padding: 24px !important; } }
</style>
</head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:${FONT};">
${o.preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(o.preheader)}&#8203;&nbsp;&#8203;&nbsp;&#8203;&nbsp;</div>` : ""}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f4f5;">
  <tr><td align="center" style="padding:32px 12px;">
    <table role="presentation" class="container" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;">
      <tr><td style="height:4px;background:${o.brandColor};border-radius:12px 12px 0 0;font-size:0;line-height:0;">&nbsp;</td></tr>
      <tr><td class="card" style="background:#ffffff;padding:32px 40px;border-radius:0 0 12px 12px;font-family:${FONT};">
        <div style="margin-bottom:24px;">${header}</div>
        ${o.bodyHtml}
      </td></tr>
      <tr><td align="center" style="padding:24px 12px;font-family:${FONT};font-size:12px;line-height:1.6;color:#6b7280;">
        ${footerLines.join("<br>")}
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}

/** Very small HTML → plain text conversion for the text/plain part. */
export function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<div style="display:none[\s\S]*?<\/div>/i, "")
    .replace(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, text: string) => {
      const t = text.replace(/<[^>]+>/g, "").trim();
      return t && t !== href ? `${t} (${href})` : href;
    })
    .replace(/<(br|\/p|\/h[1-6]|\/li|\/tr|hr)[^>]*>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#8203;/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
