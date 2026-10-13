export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { usingPglite } = await import("./lib/db");
  if (usingPglite) {
    // Local development: embedded Postgres – apply migrations on startup.
    const { runMigrations } = await import("./lib/db/migrate");
    await runMigrations();
  }
  try {
    const { ensureSystemData } = await import("./lib/system");
    await ensureSystemData();
  } catch (err) {
    console.error("[startup] ensureSystemData failed", err);
  }

  // Without an external cron (local dev / self-hosting), process jobs on a timer.
  if (usingPglite || process.env.JOB_TICKER === "1") {
    const { processDueJobs } = await import("./lib/jobs/runner");
    const g = globalThis as unknown as { __relayTicker?: NodeJS.Timeout };
    if (!g.__relayTicker) {
      g.__relayTicker = setInterval(() => {
        processDueJobs().catch((err) => console.error("[jobs] tick failed", err));
      }, 20_000);
    }
  }
}
