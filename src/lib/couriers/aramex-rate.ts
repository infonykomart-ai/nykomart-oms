// Aramex Rate Calculator — SOAP/XML, a SEPARATE WSDL/service from the
// Shipping Services API aramex-shipping.ts calls, but confirmed (per the
// original uploaded kit's own header comment in aramex-tracking.ts) to
// share the exact same ClientInfo credential block — so
// getAramexClientInfo() is reused verbatim, no new credentials needed.
//
// UNVERIFIED against a real Aramex account — this WSDL was never part of
// the original uploaded kit's CreateShipments implementation actually
// exercised in aramex-shipping.ts; endpoint/field names here are built
// from Aramex's publicly mirrored Rate Calculator WSDL. Same "plausible,
// not confirmed" standard as the rest of this round's new rate-quote
// files.
import { XMLParser } from "fast-xml-parser";
import { getAramexClientInfo, type AramexClientInfo } from "@/lib/couriers/aramex-tracking";
import type { RateQuoteInput, RateQuoteResult } from "@/lib/couriers/rate-quote-types";

const ARAMEX_RATE_ENDPOINT = "https://ws.aramex.net/shippingapi/ratecalculator/service_1_0.svc";
const SOAP_ACTION = "http://ws.aramex.net/ShippingAPI/v1/Service_1_0/CalculateRate";

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function buildCalculateRateXml(client: AramexClientInfo, input: RateQuoteInput): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:tns="http://ws.aramex.net/ShippingAPI/v1/">
  <soap:Body>
    <tns:CalculateRate>
      <tns:ClientInfo>
        <tns:UserName>${escapeXml(client.userName)}</tns:UserName>
        <tns:Password>${escapeXml(client.password)}</tns:Password>
        <tns:Version>v1.0</tns:Version>
        <tns:AccountNumber>${escapeXml(client.accountNumber)}</tns:AccountNumber>
        <tns:AccountPin>${escapeXml(client.accountPin)}</tns:AccountPin>
        <tns:AccountEntity>${escapeXml(client.accountEntity)}</tns:AccountEntity>
        <tns:AccountCountryCode>${escapeXml(client.accountCountryCode)}</tns:AccountCountryCode>
      </tns:ClientInfo>
      <tns:OriginAddress>
        <tns:PostCode>${escapeXml(input.originPostalCode)}</tns:PostCode>
        <tns:CountryCode>${escapeXml(input.originCountryCode)}</tns:CountryCode>
      </tns:OriginAddress>
      <tns:DestinationAddress>
        <tns:PostCode>${escapeXml(input.destPostalCode)}</tns:PostCode>
        <tns:CountryCode>${escapeXml(input.destCountryCode)}</tns:CountryCode>
      </tns:DestinationAddress>
      <tns:ShipmentDetails>
        <tns:PaymentType>P</tns:PaymentType>
        <tns:ProductGroup>${input.originCountryCode === input.destCountryCode ? "DOM" : "EXP"}</tns:ProductGroup>
        <tns:ProductType>PPX</tns:ProductType>
        <tns:ActualWeight>
          <tns:Unit>KG</tns:Unit>
          <tns:Value>${input.weightKg}</tns:Value>
        </tns:ActualWeight>
        <tns:NumberOfPieces>1</tns:NumberOfPieces>
      </tns:ShipmentDetails>
    </tns:CalculateRate>
  </soap:Body>
</soap:Envelope>`;
}

export async function getAramexRateQuote(
  input: RateQuoteInput,
  credentials?: Partial<AramexClientInfo>
): Promise<RateQuoteResult> {
  try {
    const client = getAramexClientInfo(credentials);
    const body = buildCalculateRateXml(client, input);
    const res = await fetch(ARAMEX_RATE_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: `"${SOAP_ACTION}"` },
      body,
    });
    const text = await res.text();
    if (!res.ok) return { ok: false, error: `Aramex Rate Calculator failed ${res.status}: ${text.slice(0, 300)}` };

    const parser = new XMLParser({ removeNSPrefix: true, ignoreAttributes: true });
    const parsed = parser.parse(text) as {
      Envelope?: {
        Body?: {
          CalculateRateResponse?: {
            CalculateRateResult?: {
              HasErrors?: boolean;
              Notifications?: { Notification?: { Message?: string } | Array<{ Message?: string }> };
              TotalAmount?: { CurrencyCode?: string; Value?: number };
            };
          };
        };
      };
    };
    const result = parsed.Envelope?.Body?.CalculateRateResponse?.CalculateRateResult;
    if (!result) return { ok: false, error: "Aramex Rate Calculator returned an unrecognized response shape." };
    if (result.HasErrors) {
      const notif = result.Notifications?.Notification;
      const msg = Array.isArray(notif) ? notif.map((n) => n.Message).filter(Boolean).join("; ") : notif?.Message;
      return { ok: false, error: msg || "Aramex Rate Calculator reported an error." };
    }
    const amount = result.TotalAmount?.Value;
    const currency = result.TotalAmount?.CurrencyCode;
    if (amount == null || !currency) return { ok: false, error: "Aramex Rate Calculator returned no total amount." };
    return { ok: true, amount, currency };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Aramex rate quote failed." };
  }
}
