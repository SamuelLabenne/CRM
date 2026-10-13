import { Extension } from "@tiptap/core";
import Link from "@tiptap/extension-link";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

const HEX = /^#[0-9a-f]{3,8}$/i;

/** Only allow plain hex colors in the `color` attribute (it ends up in an inline style). */
export function safeColor(value: unknown): string | null {
  return typeof value === "string" && HEX.test(value.trim()) ? value.trim() : null;
}

/**
 * Link mark extended so that "buttons" survive the editor round trip:
 * `<a data-button data-color="#hex" href="…">Label</a>`. `inlineEmailStyles` turns links carrying
 * `data-button` into bulletproof buttons when the email is rendered.
 *
 * `renderHTML` also emits `style="--btn-color:#hex"` so the editor can paint the button;
 * normalizeEditorHtml() strips it again from the saved HTML.
 */
export const EmailLink = Link.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      button: {
        default: false,
        parseHTML: (el: HTMLElement) => el.hasAttribute("data-button"),
        renderHTML: (attrs: Record<string, unknown>) => (attrs.button ? { "data-button": "" } : {}),
      },
      color: {
        default: null,
        parseHTML: (el: HTMLElement) => safeColor(el.getAttribute("data-color")),
        renderHTML: (attrs: Record<string, unknown>) => {
          const c = safeColor(attrs.color);
          return c ? { "data-color": c, style: `--btn-color:${c}` } : {};
        },
      },
    };
  },
});

/** Highlights {{merge tags}} as chips without changing the document. */
export const MergeTagHighlight = Extension.create({
  name: "mergeTagHighlight",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("mergeTagHighlight"),
        props: {
          decorations(state) {
            const decorations: Decoration[] = [];
            state.doc.descendants((node, pos) => {
              if (!node.isText || !node.text) return;
              for (const m of node.text.matchAll(/\{\{[^{}\n]*\}\}/g)) {
                const from = pos + (m.index ?? 0);
                decorations.push(Decoration.inline(from, from + m[0].length, { class: "merge-tag" }));
              }
            });
            return DecorationSet.create(state.doc, decorations);
          },
        },
      }),
    ];
  },
});
