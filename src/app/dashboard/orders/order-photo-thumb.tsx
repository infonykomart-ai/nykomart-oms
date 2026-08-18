"use client";

// 2026-08-18 — "order preview bhi to dikhana chahiye": a small photo
// thumbnail per row on the Orders list (order-list-table.tsx), so the
// photo is visible at a glance without opening Edit on every single order.
// Renders nothing (not even a placeholder box) when there's no photo_url,
// so orders without a photo don't get an empty gray square cluttering the
// list — and silently collapses to nothing on a broken/non-image link too
// (the list is a scan-many-rows view; the "broken link" message belongs on
// the Edit form's PhotoUrlField, not repeated 300 times here).
import { useState } from "react";

export function OrderPhotoThumb({ photoUrl, className = "" }: { photoUrl: string | null; className?: string }) {
  const [broken, setBroken] = useState(false);

  if (!photoUrl || broken) return null;

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={photoUrl}
      alt=""
      onError={() => setBroken(true)}
      className={`h-14 w-14 shrink-0 rounded-lg border border-slate-200 object-cover ${className}`}
    />
  );
}
