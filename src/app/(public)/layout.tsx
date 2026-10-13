// Public pages (no auth): /e, /book, /m, /u. Each page wraps itself in <PublicShell>.
export default function PublicLayout({ children }: LayoutProps<"/">) {
  return children;
}
