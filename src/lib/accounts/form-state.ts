// Shared form-state types for the Purchase & Accounts module.
// Kept out of actions.ts because a "use server" file may only export async
// functions.

export type ExpenseFormState = {
  error: string | null;
  fieldErrors: string[];
  success: boolean;
  voucherId: string | null;
};

export const emptyExpenseFormState: ExpenseFormState = {
  error: null,
  fieldErrors: [],
  success: false,
  voucherId: null,
};

export type SimpleActionState = { error: string | null; success?: boolean };
