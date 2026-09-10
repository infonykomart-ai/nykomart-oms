"use client";

import { openLabelUrl } from "@/lib/couriers/open-label-url";

// Small shared client component so a label link can be embedded from a
// Server Component (shipments-tracking.tsx) without that file needing its
// own "use client" — see open-label-url.ts's header comment for why a
// plain <a href target="_blank"> isn't safe once a courier's label can be
// a data: URI (FedEx, since the 2026-09-10 round-2 label fix).
export function LabelLinkButton({ url, label, className }: { url: string; label: string; className?: string }) {
  return (
    <button type="button" onClick={() => openLabelUrl(url)} className={className}>
      {label}
    </button>
  );
}
