// Automation rules engine — v1, 2026-08-24. See
// db/2026-08-24-automation-rules.sql for the full design rationale
// (scope decision: internal-only actions, no customer messaging).

export type ConditionOperator = "eq" | "neq" | "contains";

export type Condition = {
  field: string;
  operator: ConditionOperator;
  value: string;
};

/** Internal-only actions — no customer messaging (see migration header). */
export type ActionType = "add_remark" | "set_tag";

export type ActionSpec = {
  type: ActionType;
  value: string;
};

/** v1 has exactly one trigger type; more can be added without a schema change. */
export type TriggerType = "order.status_changed";

export type OrderStatusChangedEvent = {
  orderId: string;
  companyId: string;
  refNo: string;
  oldStatus: string;
  newStatus: string;
};

export const CONDITION_FIELDS_BY_TRIGGER: Record<TriggerType, { value: string; label: string }[]> = {
  "order.status_changed": [
    { value: "newStatus", label: "New status" },
    { value: "oldStatus", label: "Previous status" },
    { value: "refNo", label: "Ref No. (PO/RF/RG)" },
  ],
};

export const ACTION_TYPE_LABELS: Record<ActionType, string> = {
  add_remark: "Add a note to the order's Remark",
  set_tag: "Set an internal tag on the order",
};

export const CONDITION_OPERATOR_LABELS: Record<ConditionOperator, string> = {
  eq: "is exactly",
  neq: "is not",
  contains: "contains",
};
