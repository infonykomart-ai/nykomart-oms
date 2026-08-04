import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "OMS — Nyko Mart / Rugara / CASA ARRA",
  description: "Order Management System",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col font-sans">{children}</body>
    </html>
  );
}
