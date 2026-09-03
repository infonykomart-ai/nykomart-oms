// Delhivery Packing Slip / Label — a SEPARATE API call from
// createDelhiveryShipment (delhivery-ship.ts), which — per that file's own
// header comment — never gets a label back from create.json. This file
// covers the follow-up call, built from Delhivery's publicly documented
// "Packing Slip" endpoint (track.delhivery.com/api/p/packing_slip), the
// same "One Point" API family create.json belongs to.
//
// 2026-09-03: added at the owner's explicit request ("label generation
// bhi is round me try karo") — flagged the same way delhivery-ship.ts
// itself already is: UNCONFIRMED against a real Delhivery account, no
// sample response was available to build against, only public
// docs/integration write-ups. The response field names below
// (`pdf_download_link` primarily, with a couple of documented variants
// defensively checked) should be re-verified against a real waybill the
// first time this is actually used with live credentials — see this
// file's own error message if the expected field truly isn't there, it
// surfaces the raw response so the real shape can be read off it.
//
// Deliberately a plain GET, not folded into delhivery-ship.ts's
// createDelhiveryShipment — a label can be (re-)generated for a waybill
// well after the shipment was originally booked (e.g. if the first
// generation attempt failed, or the label was lost), so this needs to be
// independently callable from an existing AWB alone.

const DELHIVERY_API_BASE = process.env.DELHIVERY_API_BASE_URL || "https://track.delhivery.com";

export type DelhiveryLabelResult = {
  success: boolean;
  labelUrl: string | null;
  raw: unknown;
};

export async function getDelhiveryLabel(waybill: string, credentials?: { api_token?: string }): Promise<DelhiveryLabelResult> {
  const token = credentials?.api_token || process.env.DELHIVERY_API_TOKEN;
  if (!token) throw new Error("DELHIVERY_API_TOKEN is not set (env var or Account Setup).");

  const url = `${DELHIVERY_API_BASE}/api/p/packing_slip?wbns=${encodeURIComponent(waybill)}&pdf=true`;
  const res = await fetch(url, {
    method: "GET",
    headers: { Authorization: `Token ${token}`, Accept: "application/json" },
  });
  const text = await res.text();
  let parsed: {
    packages_found_count?: number;
    packages?: Array<{
      wbn?: string;
      // Documented/observed field name varies across Delhivery integration
      // write-ups — check the most-cited name first, then fall back to the
      // others rather than assuming exactly one is right.
      pdf_download_link?: string;
      pdf_link?: string;
      label?: string;
    }>;
  };
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`Delhivery packing_slip returned non-JSON response (${res.status}): ${text.slice(0, 500)}`);
  }
  if (!res.ok) {
    throw new Error(`Delhivery packing_slip request failed ${res.status}: ${text.slice(0, 500)}`);
  }

  const pkg = parsed.packages?.find((p) => p.wbn === waybill) ?? parsed.packages?.[0];
  const labelUrl = pkg?.pdf_download_link ?? pkg?.pdf_link ?? pkg?.label ?? null;

  if (!labelUrl) {
    throw new Error(
      `Delhivery packing_slip succeeded but no label URL was found in the response under any of the expected field names (pdf_download_link/pdf_link/label) — the real response shape may differ from what this was built against. Raw response: ${text.slice(0, 800)}`
    );
  }

  return { success: true, labelUrl, raw: parsed };
}
