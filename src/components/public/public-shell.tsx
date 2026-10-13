import { getSetting } from "@/lib/settings";

/**
 * Branded shell for public pages (registration, booking, manage, preferences).
 * Uses the workspace brand color/logo. `embed` removes header/footer for iframes.
 */
export async function PublicShell({
  children,
  embed = false,
  wide = false,
}: {
  children: React.ReactNode;
  embed?: boolean;
  /** Wider container (e.g. booking calendar). */
  wide?: boolean;
}) {
  const ws = await getSetting("workspace");
  const style = { "--brand": ws.brandColor } as React.CSSProperties;
  if (embed) {
    return (
      <div style={style} className="min-h-svh bg-background p-4 sm:p-6">
        <div className={wide ? "mx-auto max-w-4xl" : "mx-auto max-w-xl"}>{children}</div>
      </div>
    );
  }
  return (
    <div style={style} className="flex min-h-svh flex-col bg-muted/40">
      <div className="h-1.5 w-full" style={{ background: ws.brandColor }} />
      <header className="mx-auto flex w-full max-w-4xl items-center gap-2 px-4 py-5 sm:px-6">
        {ws.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={ws.logoUrl} alt={ws.name} className="h-8 w-auto max-w-48 object-contain" />
        ) : (
          <span className="flex items-center gap-2 font-semibold tracking-tight">
            <span className="grid size-7 place-items-center rounded-lg text-sm font-bold text-white" style={{ background: ws.brandColor }}>
              {ws.name.slice(0, 1).toUpperCase()}
            </span>
            {ws.name}
          </span>
        )}
      </header>
      <main className={`mx-auto w-full flex-1 px-4 pb-10 sm:px-6 ${wide ? "max-w-4xl" : "max-w-2xl"}`}>{children}</main>
      <footer className="py-6 text-center text-xs text-muted-foreground">Powered by Relay</footer>
    </div>
  );
}

/** Card container used inside PublicShell. */
export function PublicCard({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-2xl border bg-card p-6 shadow-sm sm:p-8 ${className}`}>{children}</div>;
}

/** Brand-colored primary button style for public pages (use on <button> or <a>). */
export const brandButtonClass =
  "inline-flex h-10 items-center justify-center gap-2 rounded-lg px-5 text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90 disabled:opacity-60 bg-[var(--brand)]";
