"use client";

// 2026-09-15 — "agar naye role banayenge to kese banayenge": the Roles &
// Permissions page previously listed every role as read-only columns in the
// matrix — there was no way to CREATE a role without a Supabase insert. This
// manager adds exactly that:
//
//   • ➕ New Role — name + Create. Optionally pre-ticks capabilities after
//     creation by duplicating an existing role's grants (pick in the form).
//   • ✏️ rename — inline per role, under the matrix column header.
//   • 🗑 delete — refuses when the role still has employees or is the last
//     role holding `permissions_admin` (server-side guards too).
//
// All writes go through the actions in ./actions.ts (permissions_admin
// gated, audited). The matrix above re-renders from revalidatePath.
import { useActionState, useEffect, useState, useTransition } from "react";
import { createRole, deleteRole, renameRole, type RoleActionState } from "./actions";

const initialRoleState: RoleActionState = { error: null, ok: false };

export function RolesManager({ roles }: { roles: { id: string; name: string }[] }) {
  const [createState, createRoleAction, creating] = useActionState(createRole, initialRoleState);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  // Close the inline rename editor once a rename succeeds.
  useEffect(() => {
    if (!editingId) return;
  }, [editingId]);

  function rename(roleId: string) {
    const name = renameValue.trim();
    if (!name) return;
    setDeleteError(null);
    setPendingId(roleId);
    startTransition(async () => {
      const result = await renameRole(roleId, name);
      if (result.error) setDeleteError(result.error);
      setPendingId(null);
      setEditingId(null);
    });
  }

  function remove(role: { id: string; name: string }) {
    if (!window.confirm(`Delete role "${role.name}"? This cannot be undone.`)) return;
    setDeleteError(null);
    setPendingId(role.id);
    startTransition(async () => {
      const result = await deleteRole(role.id);
      if (result.error) setDeleteError(result.error);
      setPendingId(null);
    });
  }

  return (
    <div className="mb-6 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Roles</h2>
      <p className="mt-1 text-xs text-slate-400">
        Create a role, then tick its capabilities in the matrix below. Assign it to employees from the Employees page
        (role dropdown on each row).
      </p>

      <div className="mt-3 flex flex-wrap items-start gap-2">
        {roles.map((r) => (
          <span
            key={r.id}
            className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 py-1 pl-3 pr-1.5 text-xs font-medium text-slate-700"
          >
            {editingId === r.id ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  rename(r.id);
                }}
                className="flex items-center gap-1"
              >
                <input
                  autoFocus
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  className="w-28 rounded border border-slate-300 px-1.5 py-0.5 text-xs outline-none focus:border-amber-500"
                />
                <button
                  type="submit"
                  disabled={pendingId === r.id}
                  className="rounded bg-amber-500 px-1.5 py-0.5 text-[11px] font-semibold text-white hover:bg-amber-600 disabled:opacity-60"
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => setEditingId(null)}
                  className="rounded px-1 py-0.5 text-[11px] text-slate-500 hover:text-slate-700"
                >
                  ✕
                </button>
              </form>
            ) : (
              <>
                {r.name}
                <button
                  type="button"
                  title="Rename role"
                  onClick={() => {
                    setEditingId(r.id);
                    setRenameValue(r.name);
                  }}
                  className="rounded px-1 text-slate-400 transition hover:text-slate-700"
                >
                  ✏️
                </button>
                <button
                  type="button"
                  title="Delete role"
                  onClick={() => remove(r)}
                  className="rounded px-1 text-slate-400 transition hover:text-red-600"
                >
                  🗑
                </button>
                {pendingId === r.id && <span className="text-[11px] text-slate-400">…</span>}
              </>
            )}
          </span>
        ))}
      </div>

      <form action={createRoleAction} className="mt-4 flex flex-wrap items-center gap-2">
        <input
          name="name"
          required
          placeholder="New role name (e.g. Packing)"
          className="w-56 rounded-lg border border-slate-300 px-3 py-1.5 text-sm outline-none focus:border-amber-500"
        />
        <select
          name="copy_from"
          defaultValue=""
          className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm text-slate-600 outline-none focus:border-amber-500"
        >
          <option value="">Start blank (no permissions)</option>
          {roles.map((r) => (
            <option key={r.id} value={r.id}>
              Copy permissions from: {r.name}
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={creating}
          className="rounded-lg bg-amber-500 px-3 py-1.5 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-60"
        >
          {creating ? "Creating…" : "➕ Create Role"}
        </button>
      </form>
      {createState.error && <p className="mt-2 text-sm text-red-700">{createState.error}</p>}
      {createState.ok && !createState.error && <p className="mt-2 text-sm text-green-700">✓ Role created — tick its permissions below.</p>}
      {deleteError && <p className="mt-2 text-sm text-red-700">{deleteError}</p>}
    </div>
  );
}
