"use client";

// Messenger popup — "start something new" view: either open a 1:1 thread
// with someone (no separate action needed, direct_messages threads are
// implicit — picking a person just opens/creates the thread view, same as
// clicking a name in the full messages page's sidebar) or create a new
// group ("massaging group banane ka option hona chahiye").
import { useMemo, useState, useTransition } from "react";
import { createGroupConversation } from "@/app/dashboard/messages/group-actions";
import { Avatar } from "./messenger-shared";

export function MessengerNewConversation({
  meId,
  employeesById,
  onBack,
  onOpenDirect,
  onGroupCreated,
}: {
  meId: string;
  employeesById: Record<string, { name: string; photo_url: string | null }>;
  onBack: () => void;
  onOpenDirect: (employeeId: string, name: string) => void;
  onGroupCreated: (conversationId: string, name: string) => void;
}) {
  const [tab, setTab] = useState<"direct" | "group">("direct");
  const [search, setSearch] = useState("");
  const [groupName, setGroupName] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const employees = useMemo(
    () =>
      Object.entries(employeesById)
        .filter(([id]) => id !== meId)
        .map(([id, e]) => ({ id, name: e.name, photo_url: e.photo_url }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [employeesById, meId]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? employees.filter((e) => e.name.toLowerCase().includes(q)) : employees;
  }, [employees, search]);

  function handleCreateGroup() {
    setError(null);
    const name = groupName.trim();
    if (!name) {
      setError("Give the group a name.");
      return;
    }
    if (picked.size < 1) {
      setError("Pick at least 1 other person for a group.");
      return;
    }
    startTransition(async () => {
      const result = await createGroupConversation(name, Array.from(picked));
      if (result.error || !result.conversationId) {
        setError(result.error ?? "Could not create group.");
        return;
      }
      onGroupCreated(result.conversationId, name);
    });
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2.5">
        <button type="button" onClick={onBack} className="shrink-0 rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="Back">
          ←
        </button>
        <span className="text-sm font-semibold text-slate-800">New message</span>
      </div>

      <div className="flex border-b border-slate-100 text-sm">
        <button
          type="button"
          onClick={() => setTab("direct")}
          className={`flex-1 py-2 font-medium transition ${tab === "direct" ? "border-b-2 border-amber-500 text-amber-600" : "text-slate-400 hover:text-slate-600"}`}
        >
          Message someone
        </button>
        <button
          type="button"
          onClick={() => setTab("group")}
          className={`flex-1 py-2 font-medium transition ${tab === "group" ? "border-b-2 border-amber-500 text-amber-600" : "text-slate-400 hover:text-slate-600"}`}
        >
          Create group
        </button>
      </div>

      {tab === "direct" ? (
        <div className="flex flex-1 flex-col overflow-hidden">
          <div className="p-2.5">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search people..."
              className="w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-1.5 text-sm outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
            />
          </div>
          <div className="flex-1 overflow-y-auto">
            {filtered.map((e) => (
              <button
                key={e.id}
                type="button"
                onClick={() => onOpenDirect(e.id, e.name)}
                className="flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-slate-50"
              >
                <Avatar name={e.name} photoUrl={e.photo_url} size={8} />
                <span className="truncate text-sm text-slate-800">{e.name}</span>
              </button>
            ))}
            {filtered.length === 0 && <p className="px-3 py-6 text-center text-sm text-slate-400">No one found.</p>}
          </div>
        </div>
      ) : (
        <div className="flex flex-1 flex-col overflow-hidden">
          <div className="space-y-2 p-2.5">
            <input
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              placeholder="Group name..."
              maxLength={80}
              className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
            />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search people to add..."
              className="w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-1.5 text-sm outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
            />
          </div>
          <div className="flex-1 overflow-y-auto px-1">
            {filtered.map((e) => (
              <label key={e.id} className="flex items-center gap-2.5 px-2.5 py-1.5 hover:bg-slate-50">
                <input
                  type="checkbox"
                  checked={picked.has(e.id)}
                  onChange={(ev) =>
                    setPicked((prev) => {
                      const next = new Set(prev);
                      if (ev.target.checked) next.add(e.id);
                      else next.delete(e.id);
                      return next;
                    })
                  }
                />
                <Avatar name={e.name} photoUrl={e.photo_url} size={7} />
                <span className="truncate text-sm text-slate-800">{e.name}</span>
              </label>
            ))}
          </div>
          <div className="border-t border-slate-100 p-2.5">
            {error && <p className="mb-1.5 text-xs text-red-600">{error}</p>}
            <button
              type="button"
              onClick={handleCreateGroup}
              disabled={isPending}
              className="w-full rounded-lg bg-amber-500 px-3 py-2 text-sm font-semibold text-white transition hover:bg-amber-600 disabled:opacity-50"
            >
              Create group{picked.size > 0 ? ` (${picked.size + 1})` : ""}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
