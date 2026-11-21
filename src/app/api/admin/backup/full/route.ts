// One-click full OMS backup download (2026-11-21) —
// GET /api/admin/backup/full
//
// Every table the database exposes, as Excel workbooks inside ONE ZIP. This is
// deliberately independent of the Cloudflare R2 configuration the weekly
// snapshot needs: it only uses the Supabase keys the app already runs on, so
// the button works on a fresh deployment. Both paths read the same
// collectSnapshot(), so the tables covered are identical.
//
// Access: the same `data_export_admin` capability as the rest of the Backup
// page (Admin/MD by default). Checked server-side here; the page's button is
// never the gate. Read-only — nothing is written anywhere.
import { NextResponse } from "next/server";
import { getAuthedEmployee, UnauthorizedError } from "@/lib/auth/require-capability";
import { collectSnapshot } from "@/lib/backup/snapshot";
import { buildFullBackupZip } from "@/lib/backup/full-export";

export const runtime = "nodejs";
// The whole table set is read and zipped in one request; same ceiling as the
// other heavy admin/cron routes in this project.
export const maxDuration = 60;

export async function GET() {
  let employee;
  try {
    employee = await getAuthedEmployee();
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ ok: false, error: "Sign in first." }, { status: 401 });
    }
    throw err;
  }
  if (!employee.capabilities.includes("data_export_admin")) {
    return NextResponse.json({ ok: false, error: "Not authorized to download backups." }, { status: 403 });
  }

  try {
    const snapshot = await collectSnapshot();
    const { fileName, buffer } = buildFullBackupZip(snapshot);
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Content-Length": String(buffer.byteLength),
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Could not build the backup." },
      { status: 500 }
    );
  }
}
