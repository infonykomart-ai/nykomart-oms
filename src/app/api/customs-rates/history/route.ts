// GET /api/customs-rates/history?currency=USD&from=2026-08-01&to=2026-11-14&status=verified
//
// CSV export of the customs rate register for the dashboard's Export button.
// Same authentication and capability gate as /api/customs-rates; the file is
// generated server-side so a large history is not sent to the browser first.
import { NextRequest, NextResponse } from "next/server";
import { getAuthedEmployee, UnauthorizedError } from "@/lib/auth/require-capability";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { getRateHistoryForExport } from "@/lib/customs/data";
import { isSupportedCurrency } from "@/lib/customs/currencies";
import { isValidIsoDate } from "@/lib/customs/lookup";

export const dynamic = "force-dynamic";

const ALLOWED_CAPABILITIES = ["customs_rate_view", "customs_rate_admin"];

function csvCell(value: string | number | null): string {
  if (value === null) return "";
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export async function GET(req: NextRequest) {
  const sessionClient = await createClient();
  const {
    data: { user },
  } = await sessionClient.auth.getUser();
  if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });

  let employee;
  try {
    employee = await getAuthedEmployee();
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }
  if (!ALLOWED_CAPABILITIES.some((c) => employee.capabilities.includes(c))) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const params = req.nextUrl.searchParams;
  const currency = (params.get("currency") ?? "").toUpperCase();
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  const status = params.get("status") ?? "";

  if (currency && !isSupportedCurrency(currency)) {
    return NextResponse.json({ error: "Unsupported currency." }, { status: 400 });
  }
  if (from && !isValidIsoDate(from)) {
    return NextResponse.json({ error: "Invalid 'from' date." }, { status: 400 });
  }
  if (to && !isValidIsoDate(to)) {
    return NextResponse.json({ error: "Invalid 'to' date." }, { status: 400 });
  }

  try {
    const rows = await getRateHistoryForExport(createServiceRoleClient(), {
      currency: currency || undefined,
      from: from || undefined,
      to: to || undefined,
      status: status || undefined,
    });

    const header = [
      "currency_code",
      "currency_name",
      "currency_unit",
      "import_rate",
      "export_rate",
      "effective_start_date",
      "effective_end_date",
      "notification_no",
      "notification_date",
      "verification_status",
      "source",
      "source_document_reference",
      "source_url",
      "confidence",
      "verified_at",
      "verified_by",
      "validation_notes",
    ];

    const lines = [header.join(",")];
    for (const r of rows) {
      lines.push(
        [
          r.currencyCode,
          r.currencyName,
          r.currencyUnit,
          r.importRate,
          r.exportRate,
          r.effectiveStartDate,
          r.effectiveEndDate,
          r.notificationNo,
          r.notificationDate,
          r.status,
          r.source,
          r.sourceDocumentRef,
          r.sourceUrl,
          r.confidence,
          r.verifiedAt,
          r.verifiedByName,
          r.validationNotes,
        ]
          .map(csvCell)
          .join(",")
      );
    }

    const filename = `customs-exchange-rates-${new Date().toISOString().slice(0, 10)}.csv`;
    return new NextResponse(lines.join("\n"), {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: "Could not export the rate history.", detail: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
