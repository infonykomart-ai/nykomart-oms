// 2026-11-25 — Store Ad Spend Daily Entry export (CSV + real .xlsx).
//
// The rows come from listAdSpendEntries — the SAME function the entry list
// uses — with the same store/date/search filters, so the file always matches
// what is on screen. Exports are scoped by storesForAdSpend, so a restricted
// login cannot export another store's days by editing the URL.
//
// xlsx uses the SheetJS package already in package.json (used by the backup
// export); no new dependency.

import { NextRequest, NextResponse } from "next/server";
import { requireCapability, UnauthorizedError, ForbiddenError } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { storesForAdSpend } from "@/app/dashboard/ad-spend/store-scope";
import { amazonCountryLabel } from "@/app/dashboard/ad-spend/amazon-countries";
import {
  EXPORT_COLUMNS,
  MAX_SELECTED_IDS,
  listAdSpendEntries,
  parseEntryFilters,
  parseSelectedIds,
  toExportRow,
} from "@/lib/ad-spend/entries";
import * as XLSX from "xlsx";

export const runtime = "nodejs";

function csvCell(value: string | number): string {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export async function GET(request: NextRequest) {
  let employee;
  try {
    employee = await requireCapability("ad_spend_entry");
  } catch (error) {
    if (error instanceof UnauthorizedError) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
    if (error instanceof ForbiddenError) return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    throw error;
  }

  const supabase = createServiceRoleClient();
  const url = new URL(request.url);
  const sp = Object.fromEntries(url.searchParams.entries()) as Record<string, string>;

  const canSeeAllStores = employee.capabilities.includes("ad_spend_report_all");
  const [{ data: allStores }, { data: companies }] = await Promise.all([
    supabase.from("stores").select("id, name, company_id").in("company_id", employee.companyIds).order("name"),
    supabase.from("companies").select("id, name").in("id", employee.companyIds),
  ]);
  const stores = storesForAdSpend(allStores ?? [], {
    companyIds: employee.companyIds,
    assignedStoreIds: employee.storeIds,
    canSeeAllStores,
  });
  const storeName = new Map((allStores ?? []).map((s) => [s.id, s.name]));
  const companyName = new Map((companies ?? []).map((c) => [c.id, c.name]));
  const storeCompany = new Map((allStores ?? []).map((s) => [s.id, s.company_id]));

  const filters = parseEntryFilters(sp, stores.map((s) => s.id));
  // The export honours "all deleted rows" only for an admin, and never for a
  // restricted login.
  filters.includeDeleted = filters.includeDeleted && canSeeAllStores;

  // "Export selected": the ticked rows of the entry list. Store scope and the
  // soft-delete rule still apply, so a stale/hand-edited id cannot reach a
  // store the login cannot see.
  const ids = parseSelectedIds(sp.ids);
  const { rows } = await listAdSpendEntries(supabase, {
    ...filters,
    ids,
    page: 1,
    pageSize: ids.length > 0 ? MAX_SELECTED_IDS : 5000,
    storeName: (id) => storeName.get(id) ?? "",
  });

  const exportRows = rows.map((row) =>
    toExportRow(row, {
      store: storeName.get(row.store_id) ?? "",
      company: companyName.get(storeCompany.get(row.store_id) ?? "") ?? "",
      countryLabel: (code) => amazonCountryLabel(code) || code,
    })
  );

  const label = filters.storeId ? (storeName.get(filters.storeId) ?? "store") : "all-stores";
  const range = filters.from || filters.to ? `${filters.from || "start"}_${filters.to || "today"}` : "all-dates";
  const base =
    ids.length > 0
      ? `ad-spend-selected-${ids.length}`
      : `ad-spend-${label.replace(/[^a-z0-9]+/gi, "-")}-${range}`;
  const format = (sp.format ?? "csv").toLowerCase();

  if (format === "xlsx") {
    const sheetRows = exportRows.map((row) => {
      const out: Record<string, string | number> = {};
      for (const column of EXPORT_COLUMNS) out[column.label] = column.value(row);
      return out;
    });
    const worksheet = XLSX.utils.json_to_sheet(sheetRows, { header: EXPORT_COLUMNS.map((c) => c.label) });
    worksheet["!cols"] = EXPORT_COLUMNS.map((c) => ({ wch: Math.max(12, Math.min(32, c.label.length + 4)) }));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Ad Spend Entries");
    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${base}.xlsx"`,
        "Cache-Control": "no-store",
      },
    });
  }

  const lines = [EXPORT_COLUMNS.map((c) => csvCell(c.label)).join(",")];
  for (const row of exportRows) {
    lines.push(EXPORT_COLUMNS.map((c) => csvCell(c.value(row))).join(","));
  }
  // BOM so Excel opens UTF-8 store names correctly.
  const csv = `\uFEFF${lines.join("\r\n")}`;
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${base}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
