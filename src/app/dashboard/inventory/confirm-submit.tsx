"use client";

// 2026-11-20 — the only client component in the Inventory module. Deletes and
// photo removals are irreversible from the operator's point of view, so the
// button asks once before the server action runs. Everything else in this
// module stays server-rendered; the action still re-checks the capability and
// decides whether the row is deleted or only deactivated.
import type { ReactNode } from "react";

export function ConfirmSubmitButton({
  message,
  children,
  className,
  title,
}: {
  message: string;
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <button
      type="submit"
      title={title}
      className={className}
      onClick={(event) => {
        if (!window.confirm(message)) event.preventDefault();
      }}
    >
      {children}
    </button>
  );
}
