// One-click full OMS backup: every table in the database as Excel workbooks,
// packed into a single ZIP (2026-11-21).
//
// This is the R2-free twin of the weekly snapshot (run.ts): the weekly job
// needs Cloudflare credentials configured before its button does anything,
// while this download has to work with just the Supabase keys the app already
// needs. Both read the SAME snapshot (snapshot.ts), so the two can never cover
// different tables.
//
// WHY SEVERAL WORKBOOKS INSTEAD OF ONE: an .xlsx workbook with 130+ sheets and
// six figures of rows is slow to open and easy to break; splitting by domain
// keeps each file usable on its own (Orders.xlsx, Inventory.xlsx, …) while the
// ZIP is still one download. Grouping is by table-name pattern, and any table
// the patterns don't recognise lands in Other.xlsx — a new module can never be
// left out of a backup, only filed under "Other" until a pattern is added.
// 00-Summary.xlsx lists every table, its workbook and its row count, so the
// receipt is readable without unzipping anything.
import * as XLSX from "xlsx";
import { cellValue, sanitizeSheetName, tableColumns, type SnapshotData, type SnapshotTable } from "./snapshot";
import { buildZip, type ZipEntry } from "./zip";

export type BackupGroup = {
  /** Fixed, safe file name inside the ZIP. */
  fileName: string;
  title: string;
  tables: SnapshotTable[];
};

type GroupRule = { fileName: string; title: string; patterns: RegExp[] };

// Order matters: the first matching rule files the table. Every rule is a
// prefix/whole-name pattern on the table name so it stays valid when new
// columns are added, and a wholly new table simply falls through to Other.
const GROUP_RULES: GroupRule[] = [
  {
    fileName: "Orders.xlsx",
    title: "Orders & Dispatch",
    patterns: [/^orders?$/, /^order_/, /_orders$/, /^dispatch_invoices$/, /^finished_stock$/, /^reservations?$/],
  },
  {
    fileName: "Invoices.xlsx",
    title: "Invoices & CSB",
    patterns: [/invoice/, /^csb_/],
  },
  {
    fileName: "Inventory.xlsx",
    title: "Inventory & Master SKUs",
    patterns: [/^inventory_/],
  },
  {
    fileName: "People & Payroll.xlsx",
    title: "People, Attendance & Payroll",
    patterns: [/^employees?$/, /^employee_/, /attend/, /^salary/, /^payroll/, /^leave/, /^departments?$/, /^holidays?$/, /^worklog/, /^onboarding/],
  },
  {
    fileName: "Parties & Accounts.xlsx",
    title: "Parties, Bills & Payments",
    patterns: [/^part(y|ies)/, /^bills?$/, /^bill_/, /^payment/, /^ledger/, /^advances?$/, /expense/, /^credit_notes?$/, /^debit_notes?$/],
  },
  {
    fileName: "Ads & Marketplaces.xlsx",
    title: "Ad Spend, Marketplaces & Customs",
    patterns: [/ad_spend/, /^etsy_/, /^amazon_/, /^ebay_/, /^customs_/, /^fx_/],
  },
  {
    fileName: "Messages & CRM.xlsx",
    title: "Messages, Documents & CRM",
    patterns: [/^messages?$/, /^crm_/, /whatsapp/, /^telegram_/, /^documents?$/, /^notification/],
  },
  {
    fileName: "System & Settings.xlsx",
    title: "Companies, Stores, Roles & Settings",
    patterns: [
      /^companies$/,
      /^stores?$/,
      /^roles?$/,
      /^capabilit/,
      /^role_/,
      /^settings?$/,
      /^audit/,
      /^item_categories$/,
      /^sizes?$/,
      /^currencies$/,
      /^partners?$/,
    ],
  },
];

const OTHER_FILE_NAME = "Other.xlsx";

/** Files every table into exactly one workbook. Pure — unit tested. */
export function groupTablesForBackup(tables: SnapshotTable[]): BackupGroup[] {
  const groups = new Map<string, BackupGroup>();
  const ensure = (rule: GroupRule | { fileName: string; title: string }) => {
    const existing = groups.get(rule.fileName);
    if (existing) return existing;
    const created: BackupGroup = { fileName: rule.fileName, title: rule.title, tables: [] };
    groups.set(rule.fileName, created);
    return created;
  };

  for (const table of tables) {
    const rule = GROUP_RULES.find((candidate) => candidate.patterns.some((pattern) => pattern.test(table.name)));
    const group = ensure(rule ?? { fileName: OTHER_FILE_NAME, title: "Other Tables" });
    group.tables.push(table);
  }

  // Deterministic order in the archive: the fixed rule order, Other last.
  const ordered: BackupGroup[] = [];
  for (const rule of GROUP_RULES) {
    const group = groups.get(rule.fileName);
    if (group && group.tables.length > 0) ordered.push(group);
  }
  const other = groups.get(OTHER_FILE_NAME);
  if (other && other.tables.length > 0) ordered.push(other);
  return ordered;
}

function workbookForTables(title: string, tables: SnapshotTable[]): Buffer {
  const wb = XLSX.utils.book_new();
  const used = new Set<string>();
  for (const table of tables) {
    const columns = tableColumns(table.rows);
    let sheet: XLSX.WorkSheet;
    if (columns.length === 0) {
      sheet = XLSX.utils.aoa_to_sheet([["(no rows)"]]);
    } else {
      const aoa: Array<Array<string | number | boolean>> = [columns];
      for (const row of table.rows) aoa.push(columns.map((column) => cellValue(row[column])));
      sheet = XLSX.utils.aoa_to_sheet(aoa);
      sheet["!cols"] = columns.map((column) => ({ wch: Math.min(60, Math.max(column.length + 2, 12)) }));
    }
    XLSX.utils.book_append_sheet(wb, sheet, sanitizeSheetName(table.name, used));
  }
  // The workbook's first sheet is its own index, so a file pulled out of the
  // ZIP on its own still says what it contains.
  const index: Array<Array<string | number | boolean>> = [[title], [], ["Sheet (table)", "Rows", "Status"]];
  for (const table of tables) {
    index.push([table.name, table.rows.length, table.truncated ? "Capped at the row-safety limit" : "Complete"]);
  }
  const indexSheet = XLSX.utils.aoa_to_sheet(index);
  indexSheet["!cols"] = [{ wch: 40 }, { wch: 12 }, { wch: 34 }];
  XLSX.utils.book_append_sheet(wb, indexSheet, sanitizeSheetName("Index", used));
  // SheetJS writes sheets in append order — move the index to the front.
  const sheets = wb.SheetNames;
  const indexName = sheets.pop();
  if (indexName) sheets.unshift(indexName);
  wb.SheetNames = sheets;

  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

function summaryWorkbook(snapshot: SnapshotData, groups: BackupGroup[]): Buffer {
  const groupByTable = new Map<string, string>();
  for (const group of groups) {
    for (const table of group.tables) groupByTable.set(table.name, group.fileName);
  }

  const rows: Array<Array<string | number | boolean>> = [
    ["NYKO MART OMS — Full Data Backup"],
    ["Generated (UTC)", snapshot.generatedAt],
    ["Tables in this backup", snapshot.tables.length],
    ["Rows in this backup", snapshot.totalRows],
    ["Skipped / uncaptured", snapshot.skipped.length],
    [],
    ["Table", "Workbook", "Rows", "Status"],
  ];
  for (const table of snapshot.tables) {
    rows.push([
      table.name,
      groupByTable.get(table.name) ?? "—",
      table.rows.length,
      table.truncated ? "Capped at the row-safety limit" : "Complete",
    ]);
  }
  for (const skip of snapshot.skipped) {
    rows.push([skip.name, "—", 0, `Skipped: ${skip.reason}`]);
  }

  const wb = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet["!cols"] = [{ wch: 46 }, { wch: 26 }, { wch: 14 }, { wch: 46 }];
  XLSX.utils.book_append_sheet(wb, sheet, "Summary");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

export type FullBackupBuild = {
  fileName: string;
  buffer: Buffer;
  /** What the page shows back to the admin without unzipping anything. */
  receipt: { tables: number; rows: number; workbooks: number; skipped: number; bytes: number };
};

/**
 * Builds the complete archive. Every table is included; a table that could not
 * be read is not silently dropped — it stays in the summary with its reason
 * (that is what `skipped` is for), exactly like the weekly snapshot.
 */
export function buildFullBackupZip(snapshot: SnapshotData, now = new Date()): FullBackupBuild {
  const groups = groupTablesForBackup(snapshot.tables);
  const entries: ZipEntry[] = [{ name: "00-Summary.xlsx", data: summaryWorkbook(snapshot, groups) }];
  for (const group of groups) {
    entries.push({ name: group.fileName, data: workbookForTables(group.title, group.tables) });
  }
  entries.push({
    name: "MANIFEST.json",
    data: Buffer.from(
      `${JSON.stringify(
        {
          generatedAt: snapshot.generatedAt,
          totalRows: snapshot.totalRows,
          tables: snapshot.tables.map((table) => ({ name: table.name, rows: table.rows.length, truncated: table.truncated })),
          workbooks: groups.map((group) => ({
            file: group.fileName,
            title: group.title,
            tables: group.tables.map((table) => table.name),
          })),
          skipped: snapshot.skipped,
        },
        null,
        2
      )}\n`,
      "utf8"
    ),
  });

  const buffer = buildZip(entries, now);
  const stamp = now.toISOString().slice(0, 10);
  return {
    fileName: `nyko-oms-full-backup-${stamp}.zip`,
    buffer,
    receipt: {
      tables: snapshot.tables.length,
      rows: snapshot.totalRows,
      workbooks: groups.length,
      skipped: snapshot.skipped.length,
      bytes: buffer.byteLength,
    },
  };
}
