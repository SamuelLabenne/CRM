// Embed snippets for the Share tab (client-safe, pure).

const attr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
const js = (s: string) => JSON.stringify(s).replace(/</g, "\\u003c");

/** Inline iframe that grows with the booking widget (the embed page posts its height). */
export function inlineEmbedSnippet(embedUrl: string): string {
  return `<iframe
  src="${attr(embedUrl)}"
  title="Book a meeting"
  style="width:100%;min-height:720px;border:0;border-radius:12px"
  loading="lazy"
></iframe>
<script>
  window.addEventListener("message", function (e) {
    if (!e.data || e.data.type !== "relay:booking-height") return;
    var frames = document.getElementsByTagName("iframe");
    for (var i = 0; i < frames.length; i++) {
      if (frames[i].contentWindow === e.source) frames[i].style.height = e.data.height + "px";
    }
  });
</script>`;
}

/** A button that opens the booking widget in an overlay. */
export function popupEmbedSnippet(embedUrl: string, opts: { label?: string; color?: string } = {}): string {
  const label = opts.label ?? "Book a call";
  const color = /^#[0-9a-f]{3,8}$/i.test(opts.color ?? "") ? opts.color! : "#4f46e5";
  return `<button type="button" id="relay-book-btn" style="background:${color};color:#fff;border:0;border-radius:8px;padding:12px 20px;font:600 15px system-ui,sans-serif;cursor:pointer">${attr(label)}</button>
<script>
(function () {
  var url = ${js(embedUrl)};
  document.getElementById("relay-book-btn").addEventListener("click", function () {
    var overlay = document.createElement("div");
    overlay.style.cssText = "position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;padding:16px";
    var frame = document.createElement("iframe");
    frame.src = url;
    frame.title = "Book a meeting";
    frame.style.cssText = "width:100%;max-width:960px;height:min(92vh,760px);border:0;border-radius:16px;background:#fff;box-shadow:0 20px 60px rgba(0,0,0,.35)";
    var close = document.createElement("button");
    close.type = "button";
    close.textContent = "\\u00d7";
    close.setAttribute("aria-label", "Close");
    close.style.cssText = "position:absolute;top:10px;right:18px;background:none;border:0;color:#fff;font-size:34px;line-height:1;cursor:pointer";
    function done() { document.body.removeChild(overlay); document.removeEventListener("keydown", onKey); }
    function onKey(e) { if (e.key === "Escape") done(); }
    close.addEventListener("click", done);
    overlay.addEventListener("click", function (e) { if (e.target === overlay) done(); });
    document.addEventListener("keydown", onKey);
    overlay.appendChild(frame);
    overlay.appendChild(close);
    document.body.appendChild(overlay);
  });
})();
</script>`;
}
