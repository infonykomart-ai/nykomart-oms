"use client";

import { useTransition } from "react";
import { removeHoliday } from "./actions";

export function RemoveHolidayButton({ id }: { id: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await removeHoliday(id);
        })
      }
      className="text-rose-600 hover:underline disabled:opacity-50"
    >
      {pending ? "Removing..." : "Remove"}
    </button>
  );
}
