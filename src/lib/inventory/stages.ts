// Stock stages for finished-goods inventory. The database enforces this list
// in inventory_balances.stage's CHECK constraint — keep the two in sync.
export const INVENTORY_STAGES = [
  "RAW",
  "PRINTING",
  "WASHING",
  "MANUFACTURING",
  "QC",
  "READY",
  "REJECTED",
  "DISPATCHED",
] as const;

export type InventoryStage = (typeof INVENTORY_STAGES)[number];

export const STAGE_LABELS: Record<InventoryStage, string> = {
  RAW: "Raw stock",
  PRINTING: "Printing WIP",
  WASHING: "Washing WIP",
  MANUFACTURING: "Manufacturing WIP",
  QC: "Quality check",
  READY: "Ready to dispatch",
  REJECTED: "QC rejected",
  DISPATCHED: "Dispatched",
};

// Stages a user can bring stock INTO through the inward screen. PRINTING /
// WASHING / MANUFACTURING / DISPATCHED are only reachable through their own
// workflows, never by a manual inward.
export const INWARD_STAGES: InventoryStage[] = ["RAW", "QC", "READY"];

export type StockSource =
  | "PURCHASE_RECEIPT"
  | "MANUAL"
  | "OPENING"
  | "MANUFACTURING"
  | "CUSTOMER_RETURN"
  | "TRANSFER";

export const STOCK_SOURCES: { value: StockSource; label: string }[] = [
  { value: "PURCHASE_RECEIPT", label: "Purchase receipt" },
  { value: "MANUAL", label: "Manual stock inward" },
  { value: "OPENING", label: "Opening stock" },
  { value: "MANUFACTURING", label: "Manufacturing completion" },
  { value: "CUSTOMER_RETURN", label: "Customer return (after QC)" },
  { value: "TRANSFER", label: "Stock transfer" },
];

export const SOURCE_TX_TYPE: Record<StockSource, string> = {
  PURCHASE_RECEIPT: "PURCHASE_RECEIPT",
  MANUAL: "MANUAL_INWARD",
  OPENING: "OPENING_STOCK",
  MANUFACTURING: "MANUFACTURING_IN",
  CUSTOMER_RETURN: "CUSTOMER_RETURN",
  TRANSFER: "STOCK_TRANSFER_IN",
};

export const TX_TYPE_LABELS: Record<string, string> = {
  PURCHASE_RECEIPT: "Purchase receipt",
  MANUAL_INWARD: "Manual inward",
  OPENING_STOCK: "Opening stock",
  MANUFACTURING_IN: "Manufacturing completion",
  CUSTOMER_RETURN: "Customer return",
  STOCK_TRANSFER_IN: "Stock transfer in",
  PROCESSING_SEND: "Sent to processing",
  PROCESSING_COMPLETE: "Processing completed",
  QC_IN: "Moved to QC",
  QC_ACCEPT: "QC accepted",
  QC_REJECT: "QC rejected",
  CHALLAN_ISSUE: "Challan issued",
  CHALLAN_CANCEL: "Challan cancelled",
  ADJUSTMENT: "Adjustment",
  STAGE_TRANSFER: "Stage transfer",
};

export function stageLabel(stage: string): string {
  return STAGE_LABELS[stage as InventoryStage] ?? stage;
}

export function txTypeLabel(tx: string): string {
  return TX_TYPE_LABELS[tx] ?? tx.replaceAll("_", " ").toLowerCase();
}
