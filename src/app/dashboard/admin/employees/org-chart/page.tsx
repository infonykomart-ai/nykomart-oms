import { requireCapability } from "@/lib/auth/require-capability";
import { createClient } from "@/lib/supabase/server";

// 2026-09-11 (Payroll Phase 3) — a simple nested tree view of
// employees.reports_to_employee_id, grouped by company (an org chart
// spanning companies isn't meaningful for this business). Deliberately a
// plain nested list, not a drag-and-drop diagram builder — "Reports To" is
// edited from the Employees admin page's Edit Details panel, this page is
// read-only.
type EmployeeNode = {
  id: string;
  name: string;
  designation: string | null;
  active: boolean;
  children: EmployeeNode[];
};

export default async function OrgChartPage() {
  const admin = await requireCapability("employee_admin");
  const supabase = await createClient();

  const [{ data: companies }, { data: employees }] = await Promise.all([
    supabase.from("companies").select("id, name").in("id", admin.companyIds).order("name"),
    supabase
      .from("employees")
      .select("id, name, designation, active, company_id, reports_to_employee_id")
      .in("company_id", admin.companyIds)
      .order("name"),
  ]);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-900">🌳 Org Chart</h1>
        <p className="mt-1 text-sm text-slate-500">
          Built from each employee&apos;s &quot;Reports To&quot; field (set from Employees → Edit Details). An
          employee with nobody set shows as a top-level node.
        </p>
      </div>

      <div className="space-y-6">
        {(companies ?? []).map((c) => {
          const companyEmployees = (employees ?? []).filter((e) => e.company_id === c.id);
          const byId = new Map(companyEmployees.map((e) => [e.id, e]));
          const childrenOf = new Map<string, string[]>();
          const topLevel: string[] = [];
          for (const e of companyEmployees) {
            // A reports_to pointing outside this company's own employee set
            // (shouldn't happen — Edit Details only ever offers same-company
            // options — but a stale/edited-elsewhere row is still rendered
            // sanely) falls back to top-level rather than being dropped.
            if (e.reports_to_employee_id && byId.has(e.reports_to_employee_id)) {
              const list = childrenOf.get(e.reports_to_employee_id) ?? [];
              list.push(e.id);
              childrenOf.set(e.reports_to_employee_id, list);
            } else {
              topLevel.push(e.id);
            }
          }

          function buildNode(id: string, seen: Set<string>): EmployeeNode | null {
            // A cycle (A reports to B, B reports to A) can only happen from
            // data edited directly in Supabase, not through this app's own
            // form — guard against it anyway so the tree can never recurse
            // forever.
            if (seen.has(id)) return null;
            const e = byId.get(id);
            if (!e) return null;
            const nextSeen = new Set(seen).add(id);
            return {
              id: e.id,
              name: e.name,
              designation: e.designation,
              active: e.active,
              children: (childrenOf.get(id) ?? [])
                .map((childId) => buildNode(childId, nextSeen))
                .filter((n): n is EmployeeNode => n !== null),
            };
          }

          const tree = topLevel.map((id) => buildNode(id, new Set())).filter((n): n is EmployeeNode => n !== null);

          return (
            <div key={c.id} className="rounded-xl border border-slate-200 bg-white p-4">
              <p className="mb-3 text-sm font-semibold text-slate-700">{c.name}</p>
              {tree.length > 0 ? (
                <ul className="space-y-1">
                  {tree.map((node) => (
                    <TreeNode key={node.id} node={node} depth={0} />
                  ))}
                </ul>
              ) : (
                <p className="py-2 text-center text-xs text-slate-400">No employees in this company yet.</p>
              )}
            </div>
          );
        })}
        {(companies ?? []).length === 0 && (
          <p className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-400">No companies to show.</p>
        )}
      </div>
    </div>
  );
}

function TreeNode({ node, depth }: { node: EmployeeNode; depth: number }) {
  return (
    <li>
      <div className="flex items-center gap-2 py-1" style={{ paddingLeft: `${depth * 1.5}rem` }}>
        {depth > 0 && <span className="text-slate-300">└</span>}
        <span className={`text-sm font-medium ${node.active ? "text-slate-800" : "text-slate-400 line-through"}`}>{node.name}</span>
        {node.designation && <span className="text-xs text-slate-400">— {node.designation}</span>}
        {!node.active && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">Inactive</span>}
      </div>
      {node.children.length > 0 && (
        <ul>
          {node.children.map((child) => (
            <TreeNode key={child.id} node={child} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}
