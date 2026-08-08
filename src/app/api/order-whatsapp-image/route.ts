import sharp from "sharp";
import { requireCapability, UnauthorizedError, ForbiddenError } from "@/lib/auth/require-capability";

// 2026-08-08: "WHATSAPP PAR PHOTO OR MSG DONO ALAG ALAG KYU JA RAHE HAI EK
// SATH JANA CHAHIYE" — user confirmed the photo and the caption text land
// as 2 SEPARATE WhatsApp messages on BOTH phone and computer. That rules
// out a single-platform quirk: no combination of `navigator.share({files,
// text})` reliably makes WhatsApp treat an image + a separate text payload
// as one message, on any device — WhatsApp's Web/OS Share Target handling
// just doesn't support that combo consistently.
//
// The only way to GUARANTEE one message is to make it structurally
// impossible to split: bake the caption directly into the photo itself
// (a caption panel appended below it) and share ONLY that single composite
// image, with no separate text field at all. There is nothing left for any
// platform to split apart. This route does that compositing server-side
// (fetching the source photo here also reuses the same CORS workaround as
// /api/order-photo-proxy — most photo URLs are on outside domains that
// don't send us permissive CORS headers).
export const runtime = "nodejs";

const MAX_WIDTH = 1000;
const PAD_X = 24;
const PAD_Y = 20;
const LINE_HEIGHT = 30;
const PRIORITY_HEIGHT = 42;
const NOTE_CHARS_PER_LINE = 58;
const NOTE_MAX_LINES = 3;

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function wrapText(label: string, value: string, charsPerLine: number, maxLines: number): string[] {
  const words = value.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > charsPerLine && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
    if (lines.length === maxLines - 1) break;
  }
  if (current) lines.push(current);
  if (lines.length > maxLines) lines.length = maxLines;
  const joined = lines.join(" ");
  if (joined.length < value.length && lines.length === maxLines) {
    lines[maxLines - 1] = lines[maxLines - 1].replace(/.{0,3}$/, "…");
  }
  return lines.length ? [`${label}:`, ...lines] : [`${label}: -`];
}

export async function GET(request: Request) {
  try {
    await requireCapability("order_entry");
  } catch (err) {
    if (err instanceof UnauthorizedError) return new Response("Not signed in.", { status: 401 });
    if (err instanceof ForbiddenError) return new Response("Forbidden.", { status: 403 });
    throw err;
  }

  const params = new URL(request.url).searchParams;
  const raw = params.get("url");
  if (!raw) return new Response("Missing url", { status: 400 });

  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return new Response("Invalid url", { status: 400 });
  }
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    return new Response("Invalid url", { status: 400 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(target.toString());
  } catch {
    return new Response("Could not fetch photo", { status: 502 });
  }
  if (!upstream.ok || !upstream.body) {
    return new Response("Could not fetch photo", { status: 502 });
  }
  const photoBuffer = Buffer.from(await upstream.arrayBuffer());

  const isAmazon = params.get("is_amazon") === "1";
  const refNo = params.get("ref_no") || "-";
  const qty = params.get("qty") || "-";
  const size = params.get("size") || "-";
  const dispatchDate = params.get("dispatch_date") || "-";
  const photoType = params.get("photo_type") || "-";
  const colour = params.get("colour") || "-";
  const tasselFringes = params.get("tassel_fringes") === "1" ? "Yes" : "No";
  const sku = params.get("sku") || "-";
  const note = params.get("note") || "-";

  let photo = sharp(photoBuffer);
  const meta = await photo.metadata();
  let width = meta.width ?? MAX_WIDTH;
  let height = meta.height ?? Math.round((width * 3) / 4);
  if (width > MAX_WIDTH) {
    const scale = MAX_WIDTH / width;
    height = Math.round(height * scale);
    width = MAX_WIDTH;
    photo = photo.resize(width, height);
  }
  const resizedPhotoBuffer = await photo.jpeg({ quality: 88 }).toBuffer();

  const fields: [string, string][] = [
    ["PO/RF/RG", refNo],
    ["QTY", qty],
    ["Size", size],
    ["Dispatch Date", dispatchDate],
    ["Photo", photoType],
    ["Colour", colour],
    ["Tassel/ Fringes", tasselFringes],
    ["SKU", sku],
  ];

  const svgLines: { text: string; bold?: boolean; color?: string; size?: number }[] = [];
  if (isAmazon) svgLines.push({ text: "TOP PRIORITY", bold: true, color: "#fbbf24", size: 24 });
  for (const [label, value] of fields) {
    svgLines.push({ text: `${label}: ${value}`, bold: false, color: "#f1f5f9", size: 18 });
  }
  const noteLines = wrapText("Note", note, NOTE_CHARS_PER_LINE, NOTE_MAX_LINES);
  noteLines.forEach((line, i) => {
    svgLines.push({ text: line, bold: i === 0, color: "#f1f5f9", size: 18 });
  });

  const panelHeight =
    PAD_Y * 2 + (isAmazon ? PRIORITY_HEIGHT : 0) + (svgLines.length - (isAmazon ? 1 : 0)) * LINE_HEIGHT;

  let y = PAD_Y;
  const textEls: string[] = [];
  for (const line of svgLines) {
    const isPriority = isAmazon && line.text === "TOP PRIORITY";
    y += isPriority ? PRIORITY_HEIGHT * 0.7 : LINE_HEIGHT * 0.75;
    textEls.push(
      `<text x="${PAD_X}" y="${y}" font-family="Arial, Helvetica, sans-serif" font-size="${line.size}" font-weight="${
        line.bold ? "bold" : "normal"
      }" fill="${line.color}">${escapeXml(line.text)}</text>`
    );
    y += isPriority ? PRIORITY_HEIGHT * 0.3 : LINE_HEIGHT * 0.25;
  }

  const svg = `<svg width="${width}" height="${panelHeight}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${width}" height="${panelHeight}" fill="#0f172a"/>
    ${textEls.join("\n")}
  </svg>`;
  const panelBuffer = await sharp(Buffer.from(svg)).png().toBuffer();

  const composite = await sharp({
    create: { width, height: height + panelHeight, channels: 3, background: "#0f172a" },
  })
    .composite([
      { input: resizedPhotoBuffer, top: 0, left: 0 },
      { input: panelBuffer, top: height, left: 0 },
    ])
    .jpeg({ quality: 90 })
    .toBuffer();

  return new Response(composite, {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "private, max-age=60",
    },
  });
}
