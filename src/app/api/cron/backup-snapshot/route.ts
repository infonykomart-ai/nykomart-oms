// Weekly full data snapshot -> Cloudflare R2 (2026-10-23).
//
//   GET /api/cron/backup-snapshot
//   Authorization: Bearer $CRON_SECRET
//
// Writes, under R2_PREFIX (default "backups"):
//   <prefix>/<runId>/snapshot-<runId>.xlsx   every table, every row
//   <prefix>/<runId>/snapshot-<runId>.pdf    readable report + core records
//   <prefix>/<runId>/manifest.json           receipt: counts + SHA-256 hashes
//
// SCHEDULING: deliberately NOT in vercel.json — this project's Hobby plan is
// already at its hard cap of two cron entries (see the note at the top of
// api/cron/poll-fedex-tracking/route.ts; exceeding the cap silently blocks
// every future deployment). The committed schedule is
// .github/workflows/weekly-backup.yml (Sundays, 02:00 IST), which simply calls
// this route with the same bearer token the other cron routes use.
//
// `?dry=1` collects and reports what WOULD be backed up (table/row counts)
// without touching R2 — the way to prove discovery + database access work
// before the first real upload.
//
// The same code path is also run manually from Admin -> Backup Export
// (see src/app/dashboard/admin/backup), so a missed week is one button away.
import { NextRequest, NextResponse } from "next/server";
import { collectSnapshot } from "@/lib/backup/snapshot";
import { runSnapshotBackup } from "@/lib/backup/run";

export const maxDuration = 60;

async function run(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (req.nextUrl.searchParams.get("dry") === "1") {
    try {
      const snapshot = await collectSnapshot();
      return NextResponse.json({
        ok: true,
        dry: true,
        tables: snapshot.tables.length,
        rows: snapshot.totalRows,
        skipped: snapshot.skipped,
        perTable: snapshot.tables.map((t) => ({ table: t.name, rows: t.rows.length, truncated: t.truncated })),
      });
    } catch (err) {
      return NextResponse.json(
        { ok: false, stage: "snapshot", error: err instanceof Error ? err.message : String(err) },
        { status: 500 }
      );
    }
  }

  const result = await runSnapshotBackup({ trigger: "cron" });
  if (!result.ok) {
    return NextResponse.json(result, { status: 500 });
  }
  return NextResponse.json({
    ok: true,
    runId: result.runId,
    manifestKey: result.manifestKey,
    tables: result.manifest.tables.length,
    rows: result.manifest.totalRows,
    skipped: result.manifest.skipped.length,
    durationMs: result.manifest.durationMs,
  });
}

export async function GET(req: NextRequest) {
  return run(req);
}

// Some schedulers (and GitHub's `curl -X POST` habit) use POST; identical
// behavior either way — this route only ever READS the database and WRITES
// new, uniquely-named objects, so it is safely repeatable.
export async function POST(req: NextRequest) {
  return run(req);
}
