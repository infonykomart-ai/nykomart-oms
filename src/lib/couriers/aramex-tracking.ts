// Aramex Shipment Tracking — SOAP/XML API, not REST/JSON like the other
// couriers in this app. Built from Aramex's own official kit the user
// uploaded directly (shipmentstrackingapiwsdl.wsdl — the TrackShipments
// operation this file implements — plus the sibling Rate Calculator,
// Location Services, and Shipping Services WSDLs and C#/PHP/VB client SDK
// zips for context/convention, and a createShipmentsPHP.txt sample showing
// the ClientInfo/Address/Party shapes other Aramex operations share).
//
// POLLING, not a webhook — nothing in the uploaded kit describes a
// push/callback mechanism, only request/response SOAP calls. This shares
// ONE Vercel Cron job with FedEx polling (see
// src/app/api/cron/poll-fedex-tracking/route.ts's header comment) rather
// than getting its own — Vercel's Hobby plan hard-caps a project at 2 cron
// jobs total (see the batch46 postmortem in the project's own notes: this
// silently blocks EVERY future deployment, not just the cron, if crossed),
// and this project already has 2 (sync-orders, poll-fedex-tracking).
//
// AUTH: unlike every other courier here, Aramex has no separate API
// key/token — every SOAP call carries your FULL account credentials in the
// request body (ClientInfo: UserName/Password/AccountNumber/AccountPin/
// AccountEntity/AccountCountryCode — the exact same block Rate/Location/
// Shipping APIs use too, confirmed identical across all 4 WSDLs in the
// upload). Because credentials travel in the body in cleartext, this file
// ALWAYS calls the HTTPS endpoint regardless of what any WSDL's
// <soap:address> literally says — the tracking WSDL's address is
// http://ws.aramex.net/... (not https://), which contradicts the Shipping
// WSDL's https:// address in the very same upload; treated as a stale
// inconsistency in an older WSDL file, not something to actually honor.
//
// STATUS MAPPING — UNCONFIRMED, same caveat as this app's Shiprocket
// integration: TrackingResult.UpdateCode is a bare string with no
// enum/value table anywhere in the uploaded kit, so there's no official
// code list to map from (contrast FedEx, where the official OpenAPI spec
// at least gives field names even without a full code table). Bucketing
// here matches on UpdateDescription TEXT instead (case-insensitive
// substring), the same defensive approach used for Shiprocket. Once real
// tracking numbers flow through this, check courier_webhook_log's
// raw_payload rows for "Aramex" and refine both the code list and the text
// matches against what actually comes back.
//
// RESPONSE SHAPE — also unconfirmed: no sample response XML was included
// in the upload (WSDLs define the schema, not example payloads), so the
// exact SOAP envelope prefix/namespace style Aramex's live server actually
// uses hasn't been seen. Parsing below uses fast-xml-parser with
// removeNSPrefix so it doesn't matter whether the server prefixes elements
// (<soap:Envelope>) or uses a bare default namespace (<Envelope
// xmlns="...">) — both normalize to the same plain tag names.

import { XMLParser } from "fast-xml-parser";
import type { TrackingBucket } from "@/lib/courier-webhooks/apply-tracking-event";

const ARAMEX_TRACK_ENDPOINT = "https://ws.aramex.net/ShippingAPI/v1/Tracking/Service_1_0.svc";
const SOAP_ACTION = "http://ws.aramex.net/ShippingAPI/v1/Service_1_0/TrackShipments";

export type AramexClientInfo = {
  userName: string;
  password: string;
  accountNumber: string;
  accountPin: string;
  accountEntity: string;
  accountCountryCode: string;
};

// 2026-09-03: `override` (partial — any subset of fields) lets a caller
// supply per-company credentials resolved from the new courier_credentials
// table (see src/lib/couriers/credentials.ts) instead of this deployment's
// global env vars — used by courier-booking/actions.ts's
// createAramexBooking, via aramex-shipping.ts. Any field NOT present in
// override falls back to its env var, same as before this round. The
// TRACKING cron (poll-fedex-tracking/route.ts) calls this with no
// argument, so it is fully unaffected — that cron has no per-company
// concept and is deliberately untouched by this round.
export function getAramexClientInfo(override?: Partial<AramexClientInfo>): AramexClientInfo {
  const userName = override?.userName || process.env.ARAMEX_USERNAME;
  const password = override?.password || process.env.ARAMEX_PASSWORD;
  const accountNumber = override?.accountNumber || process.env.ARAMEX_ACCOUNT_NUMBER;
  const accountPin = override?.accountPin || process.env.ARAMEX_ACCOUNT_PIN;
  const accountEntity = override?.accountEntity || process.env.ARAMEX_ACCOUNT_ENTITY;
  const accountCountryCode = override?.accountCountryCode || process.env.ARAMEX_ACCOUNT_COUNTRY_CODE;
  if (!userName || !password || !accountNumber || !accountPin || !accountEntity || !accountCountryCode) {
    throw new Error(
      "ARAMEX_USERNAME / ARAMEX_PASSWORD / ARAMEX_ACCOUNT_NUMBER / ARAMEX_ACCOUNT_PIN / ARAMEX_ACCOUNT_ENTITY / ARAMEX_ACCOUNT_COUNTRY_CODE are not all set (env var or Account Setup)."
    );
  }
  return { userName, password, accountNumber, accountPin, accountEntity, accountCountryCode };
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function buildTrackShipmentsRequestXml(client: AramexClientInfo, awbNos: string[]): string {
  const shipmentsXml = awbNos.map((awb) => `<arr:string>${escapeXml(awb)}</arr:string>`).join("");
  return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:tns="http://ws.aramex.net/ShippingAPI/v1/">
  <soap:Body>
    <tns:ShipmentTrackingRequest>
      <tns:ClientInfo>
        <tns:UserName>${escapeXml(client.userName)}</tns:UserName>
        <tns:Password>${escapeXml(client.password)}</tns:Password>
        <tns:Version>v1.0</tns:Version>
        <tns:AccountNumber>${escapeXml(client.accountNumber)}</tns:AccountNumber>
        <tns:AccountPin>${escapeXml(client.accountPin)}</tns:AccountPin>
        <tns:AccountEntity>${escapeXml(client.accountEntity)}</tns:AccountEntity>
        <tns:AccountCountryCode>${escapeXml(client.accountCountryCode)}</tns:AccountCountryCode>
      </tns:ClientInfo>
      <tns:Transaction>
        <tns:Reference1>oms-poll</tns:Reference1>
      </tns:Transaction>
      <tns:Shipments xmlns:arr="http://schemas.microsoft.com/2003/10/Serialization/Arrays">${shipmentsXml}</tns:Shipments>
      <tns:GetLastTrackingUpdateOnly>true</tns:GetLastTrackingUpdateOnly>
    </tns:ShipmentTrackingRequest>
  </soap:Body>
</soap:Envelope>`;
}

export type AramexTrackingResult = {
  waybillNumber: string;
  updateCode: string | null;
  updateDescription: string | null;
  updateDateTime: string | null;
  updateLocation: string | null;
  comments: string | null;
  problemCode: string | null;
};

const xmlParser = new XMLParser({ removeNSPrefix: true, ignoreAttributes: true, trimValues: true });

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function textOrNull(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  return s ? s : null;
}

/**
 * Parses a TrackShipments SOAP response into a flat list of per-AWB
 * results. Deliberately tolerant of exactly where things land in the
 * envelope (removeNSPrefix + walking down by tag name rather than a rigid
 * fixed path) since the real response shape hasn't been seen yet — see
 * this file's header comment.
 */
export function parseTrackShipmentsResponseXml(xml: string): AramexTrackingResult[] {
  const parsed = xmlParser.parse(xml);
  const envelope = parsed?.Envelope ?? parsed;
  const body = envelope?.Body ?? envelope;
  const response = body?.ShipmentTrackingResponse ?? body;
  const dictEntries = asArray(response?.TrackingResults?.KeyValueOfstringArrayOfTrackingResultmFAkxlpY);

  const results: AramexTrackingResult[] = [];
  for (const entry of dictEntries) {
    const entryObj = entry as { Key?: unknown; Value?: { TrackingResult?: unknown } };
    const key = textOrNull(entryObj?.Key);
    const trackingResults = asArray(entryObj?.Value?.TrackingResult) as Record<string, unknown>[];
    for (const tr of trackingResults) {
      results.push({
        waybillNumber: textOrNull(tr?.WaybillNumber) ?? key ?? "",
        updateCode: textOrNull(tr?.UpdateCode),
        updateDescription: textOrNull(tr?.UpdateDescription),
        updateDateTime: textOrNull(tr?.UpdateDateTime),
        updateLocation: textOrNull(tr?.UpdateLocation),
        comments: textOrNull(tr?.Comments),
        problemCode: textOrNull(tr?.ProblemCode),
      });
    }
  }
  return results.filter((r) => r.waybillNumber);
}

export async function fetchAramexTracking(client: AramexClientInfo, awbNos: string[]): Promise<AramexTrackingResult[]> {
  const body = buildTrackShipmentsRequestXml(client, awbNos);
  const res = await fetch(ARAMEX_TRACK_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "text/xml; charset=utf-8",
      SOAPAction: `"${SOAP_ACTION}"`,
    },
    body,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Aramex TrackShipments request failed ${res.status}: ${text.slice(0, 500)}`);
  }
  return parseTrackShipmentsResponseXml(text);
}

// Matches on UpdateDescription TEXT (no official code table — see header
// comment). Order matters: return/RTO phrases checked before "delivered"
// so a hypothetical "returned to shipper - delivered" style string doesn't
// misclassify as DELIVERED.
export function bucketFromAramexDescription(description: string | null): TrackingBucket {
  if (!description) return "OTHER";
  const s = description.toLowerCase();
  if (s.includes("return") || s.includes("rto")) return "RTO";
  if (s.includes("lost") || s.includes("damage")) return "LOST";
  if (s.includes("delivered")) return "DELIVERED";
  if (
    s.includes("transit") ||
    s.includes("pickup") ||
    s.includes("picked up") ||
    s.includes("out for delivery") ||
    s.includes("arrived") ||
    s.includes("departed") ||
    s.includes("shipment received")
  ) {
    return "IN_TRANSIT";
  }
  return "OTHER";
}
