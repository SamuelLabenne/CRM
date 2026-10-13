// Embeddable (iframe) variants of public pages: /embed/e/[slug], /embed/book/[slug].
// Pages use <PublicShell embed>.
export default function EmbedLayout({ children }: LayoutProps<"/">) {
  return children;
}
