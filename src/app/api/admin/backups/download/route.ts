// Download one stored backup file (2026-10-23) —
// GET /api/admin/backups/download?key=<object key>
//
// Restore is download-only by design: this endpoint and the admin page are the
// ONLY way data leaves the bucket. Nothing here (or anywhere else in the app)
// writes a backup back into the database, so a bad or tampered backup can never
// overwrite live records.
//
// Access: the same `data_export_admin` capability the whole-business Backup
// Export already requires (Admin/MD). Checked server-side here — the page's
// hidden button is never the gate. The requested key must live under the
// configured backup prefix, so this can't be used to read unrelated objects
// from the bucket.
import { NextResponse } from "next/server";
import { getAuthedEmployee, UnauthorizedError } from "@/lib/auth/require-capability";
import { r2ConfigFromEnv, r2GetObject } from "@/lib/backup/r2";

export const maxDuration = 60;

function contentTypeFor(key: string): string {
  if (key.endsWith(".pdf")) return "application/pdf";
  if (key.endsWith(".xlsx")) return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (key.endsWith(".json")) return "application/json";
  return "application/octet-stream";
}

export async function GET(request: Request) {
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

  const config = r2ConfigFromEnv();
  if (!config) {
    return NextResponse.json({ ok: false, error: "Backup storage is not configured." }, { status: 503 });
  }

  const key = new URL(request.url).searchParams.get("key") ?? "";
  if (!key.startsWith(`${config.prefix}/`) || key.includes("..")) {
    return NextResponse.json({ ok: false, error: "Invalid backup key." }, { status: 400 });
  }

  try {
    const buffer = await r2GetObject(config, key);
    const filename = key.split("/").pop() || "backup";
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": contentTypeFor(key),
        "Content-Disposition": `attachment; filename="${filename.replace(/[^\w.-]+/g, "_")}"`,
        "Content-Length": String(buffer.byteLength),
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Could not download that backup." },
      { status: 502 }
    );
  }
}
