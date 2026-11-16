// Auth + JSON helpers for the /api/inventory routes. Route handlers are a
// second front door to the same server-side operations the dashboard uses, so
// they re-check the capability themselves — a hidden button is not a
// permission, and neither is a URL.
import { NextResponse } from "next/server";
import { getAuthedEmployee, type AuthedEmployee } from "@/lib/auth/require-capability";

export type ApiAuthResult = { employee: AuthedEmployee | null; errorResponse: NextResponse | null };

export async function inventoryApiAuth(capability: string): Promise<ApiAuthResult> {
  try {
    const employee = await getAuthedEmployee();
    if (!employee.capabilities.includes(capability)) {
      return {
        employee: null,
        errorResponse: NextResponse.json({ error: `Missing capability: ${capability}` }, { status: 403 }),
      };
    }
    return { employee, errorResponse: null };
  } catch {
    return { employee: null, errorResponse: NextResponse.json({ error: "Not signed in." }, { status: 401 }) };
  }
}

export function ok(data: unknown, status = 200) {
  return NextResponse.json({ data }, { status });
}

export function badRequest(error: string) {
  return NextResponse.json({ error }, { status: 400 });
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const parsed = await request.json();
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function bodyStr(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  return value === null || value === undefined ? "" : String(value).trim();
}

export function bodyNum(body: Record<string, unknown>, key: string): number {
  const value = body[key];
  if (value === null || value === undefined || value === "") return 0;
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

export function bodyNumOrNull(body: Record<string, unknown>, key: string): number | null {
  const value = body[key];
  if (value === null || value === undefined || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

export function searchParam(url: URL, key: string): string {
  return (url.searchParams.get(key) ?? "").trim();
}
