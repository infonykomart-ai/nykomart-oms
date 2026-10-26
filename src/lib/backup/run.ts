// One weekly snapshot = three objects in Cloudflare R2, under a
// date-stamped run folder (2026-10-23):
//
//   <prefix>/<runId>/snapshot.xlsx    every table, every row
//   <prefix>/<runId>/snapshot.pdf     human-readable report + core records
//   <prefix>/<runId>/manifest.json    what was captured, sizes, SHA-256
//
// The manifest is the run's receipt: the admin page and any future automation
// read it to know exactly which tables/rows a given backup contains, without
// downloading the workbook. Restore is intentionally DOWNLOAD-ONLY (the scope
// chosen for this feature) — nothing in the app can overwrite live data from a
// backup, so a compromised or buggy backup can never corrupt the database.
import { createHash } from "node:crypto";
import { collectSnapshot, buildSnapshotWorkbook, type SnapshotData } from "@/lib/backup/snapshot";
import { renderSnapshotReportPdf } from "@/lib/backup/report-pdf";
import {
  missingR2EnvVars,
  r2ConfigFromEnv,
  r2ListObjects,
  r2PutObject,
  type R2Config,
} from "@/lib/backup/r2";

export type BackupManifest = {
  version: 1;
  runId: string;
  trigger: "cron" | "manual";
  generatedAt: string;
  durationMs: number;
  totalRows: number;
  tables: Array<{ name: string; rows: number; truncated: boolean }>;
  skipped: Array<{ name: string; reason: string }>;
  /** The two data files. Their hashes are what a restore can verify against. */
  files: Record<"xlsx" | "pdf", { key: string; bytes: number; sha256: string }>;
  /** Where this receipt lives (a manifest cannot hash itself). */
  manifestKey: string;
};

export type BackupRunResult =
  | { ok: true; runId: string; manifestKey: string; manifest: BackupManifest }
  | { ok: false; stage: "config" | "snapshot" | "render" | "upload"; error: string };

function runIdFor(now: Date): string {
  // UTC-based and sortable: 2026-10-25_023015. The PDF/XLSX carry the exact
  // UTC timestamp too; the admin page shows it in IST.
  const iso = now.toISOString();
  return `${iso.slice(0, 10)}_${iso.slice(11, 19).replace(/:/g, "")}`;
}

function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Builds and uploads one complete snapshot. Never throws — the route reports `ok:false`. */
export async function runSnapshotBackup(options?: { trigger?: "cron" | "manual" }): Promise<BackupRunResult> {
  const config = r2ConfigFromEnv();
  if (!config) {
    return {
      ok: false,
      stage: "config",
      error: `Backup storage is not configured. Add ${missingR2EnvVars().join(", ") || "R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET"} in Settings -> Environment.`,
    };
  }

  const startedAt = Date.now();
  const now = new Date();
  const runId = runIdFor(now);

  let snapshot: SnapshotData;
  try {
    snapshot = await collectSnapshot();
  } catch (err) {
    return { ok: false, stage: "snapshot", error: describeError(err) };
  }

  const companies = (snapshot.tables.find((t) => t.name === "companies")?.rows ?? [])
    .map((row) => (typeof row.name === "string" ? row.name : ""))
    .filter(Boolean);

  const files = {
    xlsx: `snapshot-${runId}.xlsx`,
    pdf: `snapshot-${runId}.pdf`,
  };

  let xlsx: Buffer;
  let pdf: Buffer;
  try {
    xlsx = buildSnapshotWorkbook(snapshot, { generatedAt: snapshot.generatedAt, files });
    pdf = await renderSnapshotReportPdf({ snapshot, companies, files });
  } catch (err) {
    return { ok: false, stage: "render", error: describeError(err) };
  }

  const base = `${config.prefix}/${runId}`;
  const keys = {
    xlsx: `${base}/${files.xlsx}`,
    pdf: `${base}/${files.pdf}`,
    manifest: `${base}/manifest.json`,
  };

  const manifest: BackupManifest = {
    version: 1,
    runId,
    trigger: options?.trigger ?? "cron",
    generatedAt: snapshot.generatedAt,
    durationMs: Date.now() - startedAt,
    totalRows: snapshot.totalRows,
    tables: snapshot.tables.map((t) => ({ name: t.name, rows: t.rows.length, truncated: t.truncated })),
    skipped: snapshot.skipped,
    files: {
      xlsx: { key: keys.xlsx, bytes: xlsx.byteLength, sha256: sha256(xlsx) },
      pdf: { key: keys.pdf, bytes: pdf.byteLength, sha256: sha256(pdf) },
    },
    manifestKey: keys.manifest,
  };
  const manifestBuffer = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  try {
    // xlsx/pdf first, manifest LAST: a listed run without a manifest is a
    // visible partial upload, while a manifest without files would claim a
    // backup that isn't actually there.
    await r2PutObject(
      config,
      keys.xlsx,
      xlsx,
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    await r2PutObject(config, keys.pdf, pdf, "application/pdf");
    await r2PutObject(config, keys.manifest, manifestBuffer, "application/json");
  } catch (err) {
    return { ok: false, stage: "upload", error: describeError(err) };
  }

  return { ok: true, runId, manifestKey: keys.manifest, manifest };
}

// ---------------------------------------------------------------------------
// Admin page listing
// ---------------------------------------------------------------------------

export type BackupRunFile = { name: string; key: string; size: number; lastModified: string | null };
export type BackupRun = { runId: string; files: BackupRunFile[] };

export type BackupRunList =
  | { configured: false; missing: string[]; runs: [] }
  | { configured: true; error: string; runs: [] }
  | { configured: true; error: null; runs: BackupRun[] };

/** Groups the stored objects by run folder. Newest run first. */
export async function listBackupRuns(config: R2Config | null = r2ConfigFromEnv()): Promise<BackupRunList> {
  if (!config) {
    return { configured: false, missing: missingR2EnvVars(), runs: [] };
  }
  try {
    const objects = await r2ListObjects(config, `${config.prefix}/`);
    const byRun = new Map<string, BackupRunFile[]>();
    for (const object of objects) {
      const rest = object.key.slice(config.prefix.length + 1);
      const [runId, ...fileParts] = rest.split("/");
      if (!runId || fileParts.length === 0) continue;
      const files = byRun.get(runId) ?? [];
      files.push({
        name: fileParts.join("/"),
        key: object.key,
        size: object.size,
        lastModified: object.lastModified,
      });
      byRun.set(runId, files);
    }
    const runs: BackupRun[] = Array.from(byRun.entries())
      .map(([runId, files]) => ({
        runId,
        files: files.sort((a, b) => a.name.localeCompare(b.name)),
      }))
      .sort((a, b) => b.runId.localeCompare(a.runId));
    return { configured: true, error: null, runs };
  } catch (err) {
    return { configured: true, error: describeError(err), runs: [] };
  }
}
