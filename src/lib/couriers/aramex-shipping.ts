// Aramex Shipping Services — SOAP CreateShipments operation, the sibling
// API to src/lib/couriers/aramex-tracking.ts's TrackShipments (same
// ClientInfo auth block — reused via getAramexClientInfo from that file,
// see its own header comment on why AUTH always travels in the body over
// HTTPS regardless of what a given WSDL's <soap:address> literally says).
//
// PER THE TASK BRIEF: the user already uploaded Aramex's full official kit
// including the Shipping Services WSDL (not just Tracking) plus a
// createShipmentsPHP.txt sample — that upload was searched for in this
// session and in the attached Claude Project's docs but could not be
// located anywhere accessible to this build (not in the project's doc
// list, not in any local file). Built instead from Aramex's well-
// documented PUBLIC Shipping Services API shape (the CreateShipments
// operation is one of Aramex's most widely mirrored public integration
// examples — Party/Address/Contact/ShipmentDetails/Dimensions field names
// below match that public shape) — UNCONFIRMED against the user's own
// uploaded sample, flagged clearly per the same honesty standard
// aramex-tracking.ts already sets for itself. If the real
// createShipmentsPHP.txt turns up later, diff its exact field names/
// structure against this file before trusting it with a real booking.
//
// DDP vs DDU: Aramex's ShipmentDetails has no literal "DDP"/"DDU" field —
// the closest documented equivalent is PaymentType ('P' = Prepaid by
// shipper — DDP-equivalent, 'C' = Collect from consignee — DDU-
// equivalent) combined with the shipment-level Services string (Aramex
// uses short codes like "CODS", "SIGR" — no confirmed "duty-specific"
// service code was found in public docs, so this client does NOT attempt
// to set one; only PaymentType is mapped from the app's DDP/DDU choice).
// FLAG THIS clearly to the owner before relying on it for a real
// international booking where duty handling matters.
//
// BOOKED AMOUNT: Aramex's CreateShipments response does not document a
// returned shipment rate/cost (rating is a SEPARATE Rate Calculator WSDL
// operation, out of scope for this round — the app already has a manual
// Courier Rate Card + Freight Cost Estimator covering Aramex, see
// src/app/dashboard/freight-estimate). This client therefore ALWAYS
// returns bookedAmt: null — the caller always falls back to a rate-card
// estimate for Aramex bookings, not sometimes.

import { XMLParser } from "fast-xml-parser";
import { getAramexClientInfo, type AramexClientInfo } from "@/lib/couriers/aramex-tracking";

const ARAMEX_SHIPPING_ENDPOINT = "https://ws.aramex.net/ShippingAPI/v1/Shipping/Service_1_0.svc";
const SOAP_ACTION = "http://ws.aramex.net/ShippingAPI/v1/Service_1_0/CreateShipments";

export type AramexDdpDdu = "DDP" | "DDU";

export type AramexShipInput = {
  productGroup: "EXP" | "DOM"; // Aramex: Express (international) vs Domestic
  productType: string; // Aramex product code, e.g. "PPX" (Priority Parcel Express) — kept free text, see fedex-ship.ts's rationale for why
  ddpDdu: AramexDdpDdu;
  shipper: {
    accountNumber: string;
    contactName: string;
    companyName: string;
    phone: string;
    email: string;
    address1: string;
    address2?: string | null;
    city: string;
    stateOrProvince?: string | null;
    postCode: string;
    countryCode: string;
  };
  consignee: {
    contactName: string;
    companyName?: string | null;
    phone: string;
    email?: string | null;
    address1: string;
    address2?: string | null;
    city: string;
    stateOrProvince?: string | null;
    postCode: string;
    countryCode: string;
  };
  packageWeightKg: number;
  packageDimsCm: { length: number; width: number; height: number };
  numberOfPieces: number;
  currencyCode: string;
  customsValue?: number | null;
  goodsDescription: string;
  goodsOriginCountry: string;
  referenceNo: string;
};

export type AramexShipResult = {
  success: boolean;
  trackingNo: string | null;
  labelUrl: string | null;
  bookedAmt: null; // always — see header comment
  bookedCurrency: null;
  raw: unknown;
};

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function partyXml(tag: string, p: { contactName: string; companyName?: string | null; phone: string; email?: string | null; address1: string; address2?: string | null; city: string; stateOrProvince?: string | null; postCode: string; countryCode: string }, accountNumber?: string): string {
  return `<tns:${tag}>
    <tns:Reference1></tns:Reference1>
    <tns:AccountNumber>${escapeXml(accountNumber ?? "")}</tns:AccountNumber>
    <tns:PartyAddress>
      <tns:Line1>${escapeXml(p.address1)}</tns:Line1>
      <tns:Line2>${escapeXml(p.address2 ?? "")}</tns:Line2>
      <tns:City>${escapeXml(p.city)}</tns:City>
      <tns:StateOrProvinceCode>${escapeXml(p.stateOrProvince ?? "")}</tns:StateOrProvinceCode>
      <tns:PostCode>${escapeXml(p.postCode)}</tns:PostCode>
      <tns:CountryCode>${escapeXml(p.countryCode)}</tns:CountryCode>
    </tns:PartyAddress>
    <tns:Contact>
      <tns:PersonName>${escapeXml(p.contactName)}</tns:PersonName>
      <tns:CompanyName>${escapeXml(p.companyName ?? "")}</tns:CompanyName>
      <tns:PhoneNumber1>${escapeXml(p.phone)}</tns:PhoneNumber1>
      <tns:EmailAddress>${escapeXml(p.email ?? "")}</tns:EmailAddress>
    </tns:Contact>
  </tns:${tag}>`;
}

export function buildCreateShipmentsRequestXml(client: AramexClientInfo, input: AramexShipInput): string {
  const paymentType = input.ddpDdu === "DDP" ? "P" : "C"; // see header comment — no confirmed dedicated DDP/DDU field
  return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:tns="http://ws.aramex.net/ShippingAPI/v1/">
  <soap:Body>
    <tns:ShipmentCreationRequest>
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
        <tns:Reference1>${escapeXml(input.referenceNo)}</tns:Reference1>
      </tns:Transaction>
      <tns:Shipments>
        <tns:Shipment>
          <tns:Reference1>${escapeXml(input.referenceNo)}</tns:Reference1>
          ${partyXml("Shipper", input.shipper, input.shipper.accountNumber)}
          ${partyXml("Consignee", input.consignee)}
          <tns:ShippingDateTime>${new Date().toISOString()}</tns:ShippingDateTime>
          <tns:DueDate>${new Date().toISOString()}</tns:DueDate>
          <tns:Details>
            <tns:Dimensions>
              <tns:Length>${input.packageDimsCm.length}</tns:Length>
              <tns:Width>${input.packageDimsCm.width}</tns:Width>
              <tns:Height>${input.packageDimsCm.height}</tns:Height>
              <tns:Unit>cm</tns:Unit>
            </tns:Dimensions>
            <tns:ActualWeight>
              <tns:Value>${input.packageWeightKg}</tns:Value>
              <tns:Unit>KG</tns:Unit>
            </tns:ActualWeight>
            <tns:NumberOfPieces>${input.numberOfPieces}</tns:NumberOfPieces>
            <tns:ProductGroup>${escapeXml(input.productGroup)}</tns:ProductGroup>
            <tns:ProductType>${escapeXml(input.productType)}</tns:ProductType>
            <tns:PaymentType>${paymentType}</tns:PaymentType>
            <tns:DescriptionOfGoods>${escapeXml(input.goodsDescription)}</tns:DescriptionOfGoods>
            <tns:GoodsOriginCountry>${escapeXml(input.goodsOriginCountry)}</tns:GoodsOriginCountry>
            <tns:CustomsValueAmount>
              <tns:Value>${input.customsValue ?? 0}</tns:Value>
              <tns:CurrencyCode>${escapeXml(input.currencyCode)}</tns:CurrencyCode>
            </tns:CustomsValueAmount>
          </tns:Details>
        </tns:Shipment>
      </tns:Shipments>
      <tns:LabelInfo>
        <tns:ReportID>9201</tns:ReportID>
        <tns:ReportType>URL</tns:ReportType>
      </tns:LabelInfo>
    </tns:ShipmentCreationRequest>
  </soap:Body>
</soap:Envelope>`;
}

const xmlParser = new XMLParser({ removeNSPrefix: true, ignoreAttributes: true, trimValues: true });

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

export async function createAramexShipment(
  input: AramexShipInput,
  credentials?: {
    username?: string;
    password?: string;
    account_number?: string;
    account_pin?: string;
    account_entity?: string;
    account_country_code?: string;
  }
): Promise<AramexShipResult> {
  const client = getAramexClientInfo({
    userName: credentials?.username,
    password: credentials?.password,
    accountNumber: credentials?.account_number,
    accountPin: credentials?.account_pin,
    accountEntity: credentials?.account_entity,
    accountCountryCode: credentials?.account_country_code,
  });
  const requestXml = buildCreateShipmentsRequestXml(client, input);

  const res = await fetch(ARAMEX_SHIPPING_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: `"${SOAP_ACTION}"` },
    body: requestXml,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Aramex CreateShipments request failed ${res.status}: ${text.slice(0, 500)}`);
  }

  const parsed = xmlParser.parse(text);
  const envelope = parsed?.Envelope ?? parsed;
  const body = envelope?.Body ?? envelope;
  const response = body?.ShipmentCreationResponse ?? body;

  const hasErrors = asArray(response?.Notifications?.Notification).length > 0 && !response?.Shipments;
  if (hasErrors) {
    const messages = asArray(response?.Notifications?.Notification)
      .map((n: unknown) => (n as { Message?: string })?.Message)
      .filter(Boolean)
      .join("; ");
    throw new Error(`Aramex CreateShipments failed: ${messages || "unknown error — see raw response"}`);
  }

  const processedShipment = asArray(response?.Shipments?.ProcessedShipment)[0] as
    | { ID?: string; ShipmentLabel?: { LabelURL?: string } }
    | undefined;
  const trackingNo = processedShipment?.ID ?? null;
  const labelUrl = processedShipment?.ShipmentLabel?.LabelURL ?? null;

  return {
    success: !!trackingNo,
    trackingNo,
    labelUrl,
    bookedAmt: null,
    bookedCurrency: null,
    raw: parsed,
  };
}
