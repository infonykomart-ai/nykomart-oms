import type { ReactNode } from "react";
import { getAuthedEmployee } from "@/lib/auth/require-capability";
import { createClient } from "@/lib/supabase/server";
import { DashboardHeader } from "@/components/dashboard-header";
import { DashboardSidebar } from "@/components/dashboard-sidebar";
import { redirect } from "next/navigation";

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  let employee;
  try {
    employee = await getAuthedEmployee();
  } catch {
    redirect("/login");
  }

  const supabase = await createClient();
  const { data: company } = await supabase
    .from("companies")
    .select("id, name, logo_url")
    .eq("id", employee.companyId)
    .single();

  return (
    <div className="flex min-h-screen bg-slate-100">
      <DashboardSidebar capabilities={employee.capabilities} />
      <div className="flex flex-1 flex-col">
        <DashboardHeader
          companyName={company?.name ?? ""}
          logoUrl={company?.logo_url ?? null}
          employeeName={employee.name}
          roleName={employee.roleName}
        />
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
