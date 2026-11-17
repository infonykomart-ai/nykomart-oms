import { NextResponse } from "next/server";
import { createServiceRoleClientUnchecked } from "@/lib/supabase/server";
import { jsonError, requireEtsySeoEmployee } from "@/lib/etsy/api";

// 2026-11-18 — AI Usage & Costs. Paginated, company-scoped, no secrets.
// Cost is NULL when the model's price is unknown — the UI shows "—" rather
// than inventing a number.
export const maxDuration = 30;

export async function GET(request: Request) {
  const auth = await requireEtsySeoEmployee();
  if ("response" in auth) return auth.response;
  const me = auth.employee;

  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get("page") ?? 1) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get("pageSize") ?? 25) || 25));
  const projectId = url.searchParams.get("projectId");
  const supabase = createServiceRoleClientUnchecked();

  const since = new Date();
  since.setUTCDate(1);
  since.setUTCHours(0, 0, 0, 0);

  let logsQuery = supabase
    .from("etsy_seo_usage_logs")
    .select("*", { count: "exact" })
    .eq("company_id", me.currentCompanyId)
    .order("created_at", { ascending: false })
    .range((page - 1) * pageSize, page * pageSize - 1);
  if (projectId) logsQuery = logsQuery.eq("project_id", projectId);

  const [{ data: logs, count, error }, { data: monthRows }] = await Promise.all([
    logsQuery,
    supabase.from("etsy_seo_usage_logs").select("provider, model, input_tokens, output_tokens, estimated_cost_usd, status").eq("company_id", me.currentCompanyId).gte("created_at", since.toISOString()),
  ]);
  if (error) return jsonError(error.message, 500);

  const month = monthRows ?? [];
  const byProvider = new Map<string, { requests: number; cost: number; unknownCost: number }>();
  for (const row of month) {
    const key = row.provider as string;
    const entry = byProvider.get(key) ?? { requests: 0, cost: 0, unknownCost: 0 };
    entry.requests += 1;
    if (row.estimated_cost_usd === null || row.estimated_cost_usd === undefined) entry.unknownCost += 1;
    else entry.cost += Number(row.estimated_cost_usd);
    byProvider.set(key, entry);
  }

  return NextResponse.json({
    ok: true,
    page,
    pageSize,
    total: count ?? 0,
    logs: logs ?? [],
    monthToDate: {
      requests: month.length,
      failures: month.filter((r) => r.status === "error").length,
      inputTokens: month.reduce((sum, r) => sum + (r.input_tokens ?? 0), 0),
      outputTokens: month.reduce((sum, r) => sum + (r.output_tokens ?? 0), 0),
      estimatedCostUsd: Math.round(month.reduce((sum, r) => sum + (Number(r.estimated_cost_usd) || 0), 0) * 1_000_000) / 1_000_000,
      unknownCostRequests: month.filter((r) => r.estimated_cost_usd === null || r.estimated_cost_usd === undefined).length,
      byProvider: [...byProvider.entries()].map(([provider, value]) => ({ provider, ...value })),
    },
  });
}
