// 2026-10-03 — one nav strip for the whole attendance reporting suite,
// mounted at the segment level so EVERY /dashboard/attendance/admin/*
// sub-report (Daily, Monthly, Periodic, Yearly, Import, Month Summary,
// Location, GPS, Leave, COFF, Salary, Salary Details, Other, GPS
// Approvals) can jump between siblings — previously the nav cluster lived
// only inside the suite root page's header, so every sub-report was a
// dead end. The component hides itself on the suite root (the root page
// renders the same cluster inline inside its own header), so nothing is
// ever shown twice.
import { AttendanceAdminNav } from "./admin-nav";

export default function AttendanceAdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <AttendanceAdminNav variant="strip" />
      {children}
    </div>
  );
}
