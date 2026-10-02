"use client";

// One row's controls on the Department master: rename (inline, toggled)
// + Activate/Deactivate. The server actions are called directly inside a
// transition (instead of useActionState) so a successful rename can close
// the inline box from the action's continuation — no setState-in-effect.
import { useTransition, useState } from "react";
import { renameDepartment, setDepartmentActive, type SimpleActionState } from "./actions";

const initialState: SimpleActionState = { error: null, success: false };
const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500";
const btnClass =
  "rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60";

export function DepartmentRowActions({ id, name, active }: { id: string; name: string; active: boolean }) {
  const [editing, setEditing] = useState(false);
  const [renameState, setRenameState] = useState<SimpleActionState>(initialState);
  const [toggleState, setToggleState] = useState<SimpleActionState>(initialState);
  const [pending, startTransition] = useTransition();

  const submitRename = (formData: FormData) => {
    startTransition(async () => {
      const result = await renameDepartment(initialState, formData);
      setRenameState(result);
      if (result.success) setEditing(false);
    });
  };

  const submitToggle = (formData: FormData) => {
    startTransition(async () => {
      setToggleState(await setDepartmentActive(initialState, formData));
    });
  };

  const error = renameState.error ?? toggleState.error;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {editing ? (
        <form action={submitRename} className="flex items-center gap-2">
          <input type="hidden" name="id" value={id} />
          <input name="name" defaultValue={name} required className={inputClass} />
          <button type="submit" disabled={pending} className={btnClass}>
            {pending ? "Saving…" : "Save"}
          </button>
          <button type="button" onClick={() => setEditing(false)} className={btnClass}>
            Cancel
          </button>
        </form>
      ) : (
        <>
          <span className="text-sm text-slate-800">{name}</span>
          <button type="button" onClick={() => setEditing(true)} className={btnClass}>
            ✏️ Rename
          </button>
          <form action={submitToggle}>
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="active" value={active ? "false" : "true"} />
            <button type="submit" disabled={pending} className={btnClass}>
              {pending ? "…" : active ? "Deactivate" : "Reactivate"}
            </button>
          </form>
        </>
      )}
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}
