import sharp from "sharp";
import { createCanvas, GlobalFonts } from "@napi-rs/canvas";
import { readFileSync } from "node:fs";
import path from "node:path";
import { requireCapability, UnauthorizedError, ForbiddenError } from "@/lib/auth/require-capability";
import { safeExternalFetch } from "@/lib/security/safe-external-fetch";

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
// (a caption panel) and share ONLY that single composite image, with no
// separate text field at all. There is nothing left for any platform to
// split apart. This route does that compositing server-side (fetching the
// source photo here also reuses the same CORS workaround as
// /api/order-photo-proxy — most photo URLs are on outside domains that
// don't send us permissive CORS headers).
//
// 2026-09-02: panel moved from BELOW the photo to ABOVE it. A tall/portrait
// product photo plus the panel can add up to an image taller than what
// WhatsApp shows uncropped in the chat feed — with the panel below, that
// meant the details were the part most likely to be cropped out of view,
// which is what led (via a misdiagnosis) to briefly re-adding a separate
// `text` field and reintroducing the exact 2-message split this whole
// approach exists to prevent (see order-whatsapp-button.tsx's history
// comment). Panel-first means the order details are always the first thing
// visible, cropped or not, with no separate text field required.
//
// 2026-09-02: "order photo ke sath ek msg jo apn ne decide kiya tha vo
// jana chahiye tha vo kyu nahi jara" — the panel WAS rendering (right
// position, right size), but every character inside it came out as a
// blank □ box. Root cause: the panel used to be drawn as an SVG <text>
// element with font-family="Arial, Helvetica, sans-serif", rasterized by
// sharp's bundled librsvg. That works locally/in dev (real system fonts
// installed) but Vercel's Node serverless runtime ships with NO fonts and
// no working fontconfig at all — librsvg has no font to fall back to, so
// every glyph renders as its "missing glyph" box, confirmed by
// reproducing this exact failure in an isolated sandbox with fontconfig
// pointed at an empty directory. Embedding a font directly in the SVG via
// a base64 @font-face (tried both .woff2 and .ttf) did NOT fix it either
// — librsvg in this sharp build simply doesn't honor embedded @font-face
// at all, it only ever resolves fonts through the (here, empty) system
// fontconfig database.
//
// Fixed by not asking the OS for a font at all: the panel is now drawn
// with @napi-rs/canvas (already a dependency — see courier-bills/
// pdf-layout.ts) using GlobalFonts.register() on font files read
// straight from src/lib/fonts/ into a Buffer. Registering a font this way
// bypasses fontconfig entirely, so it works identically whether or not
// the OS has any fonts installed — verified by reproducing the exact
// same empty-fontconfig sandbox and confirming real glyphs render both
// for plain ASCII and for Devanagari (order notes are sometimes typed in
// Hindi). Noto Sans + Noto Sans Devanagari (SIL OFL, freely embeddable)
// were chosen for that reason — a Latin-only font would still have left
// Hindi notes as boxes.
export const runtime = "nodejs";

const FONTS_DIR = path.join(process.cwd(), "src/lib/fonts");
const LATIN_FONT_FAMILY = "OrderWhatsAppLatin";
const DEVANAGARI_FONT_FAMILY = "OrderWhatsAppDevanagari";
// Family list, not a single family — canvas falls back per-character to
// whichever registered font actually has the glyph, so one line can mix
// English labels and a Hindi note correctly (see header comment above).
const PANEL_FONT_STACK = `${LATIN_FONT_FAMILY}, ${DEVANAGARI_FONT_FAMILY}`;
// Registering twice (e.g. on a warm serverless instance handling a 2nd
// request) just re-registers the same family name — harmless — so no
// extra guard is needed here.
GlobalFonts.register(readFileSync(path.join(FONTS_DIR, "NotoSans-Regular.ttf")), LATIN_FONT_FAMILY);
GlobalFonts.register(readFileSync(path.join(FONTS_DIR, "NotoSansDevanagari-Regular.ttf")), DEVANAGARI_FONT_FAMILY);

const MAX_WIDTH = 1000;
const PAD_X = 24;
const PAD_Y = 20;
const LINE_HEIGHT = 30;
const PRIORITY_HEIGHT = 42;
const NOTE_CHARS_PER_LINE = 58;
const NOTE_MAX_LINES = 3;

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

  const result = await safeExternalFetch(raw);
  if (!result.ok) return new Response(result.error, { status: result.status });
  const photoBuffer = Buffer.from(await result.response.arrayBuffer());

  const isAmazon = params.get("is_amazon") === "1";
  const refNo = params.get("ref_no") || "-";
  const qty = params.get("qty") || "-";
  const size = params.get("size") || "-";
  const dispatchDate = params.get("dispatch_date") || "-";
  const photoType = params.get("photo_type") || "-";
  const colour = params.get("colour") || "-";
  const tasselFringes = params.get("tassel_fringes") === "1" ? "Yes" : "No";
  // 2026-09-02: "tassel fringes sirf cotton rug me hota hai" — only draw
  // this line for cotton-rug orders; every other item showed a meaningless
  // "Tassel/Fringes: No" before. Caller (order-whatsapp-button.tsx) decides
  // applicability from item_category_name and passes it explicitly rather
  // than this route guessing from the ref/SKU.
  const showTasselFringes = params.get("show_tassel_fringes") === "1";
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
    ...(showTasselFringes ? ([["Tassel/ Fringes", tasselFringes]] as [string, string][]) : []),
    ["SKU", sku],
  ];

  const panelLines: { text: string; bold?: boolean; color?: string; size?: number }[] = [];
  if (isAmazon) panelLines.push({ text: "TOP PRIORITY", bold: true, color: "#fbbf24", size: 24 });
  for (const [label, value] of fields) {
    panelLines.push({ text: `${label}: ${value}`, bold: false, color: "#f1f5f9", size: 18 });
  }
  const noteLines = wrapText("Note", note, NOTE_CHARS_PER_LINE, NOTE_MAX_LINES);
  noteLines.forEach((line, i) => {
    panelLines.push({ text: line, bold: i === 0, color: "#f1f5f9", size: 18 });
  });

  const panelHeight =
    PAD_Y * 2 + (isAmazon ? PRIORITY_HEIGHT : 0) + (panelLines.length - (isAmazon ? 1 : 0)) * LINE_HEIGHT;

  // Drawn with @napi-rs/canvas, not sharp+SVG — see the header comment on
  // why (fontconfig-free rendering is the whole point).
  const panelCanvas = createCanvas(width, panelHeight);
  const ctx = panelCanvas.getContext("2d");
  ctx.fillStyle = "#0f172a";
  ctx.fillRect(0, 0, width, panelHeight);
  ctx.textBaseline = "alphabetic";

  let y = PAD_Y;
  for (const line of panelLines) {
    const isPriority = isAmazon && line.text === "TOP PRIORITY";
    y += isPriority ? PRIORITY_HEIGHT * 0.7 : LINE_HEIGHT * 0.75;
    ctx.font = `${line.bold ? "bold " : ""}${line.size}px ${PANEL_FONT_STACK}`;
    ctx.fillStyle = line.color ?? "#f1f5f9";
    ctx.fillText(line.text, PAD_X, y);
    y += isPriority ? PRIORITY_HEIGHT * 0.3 : LINE_HEIGHT * 0.25;
  }

  const panelBuffer = panelCanvas.toBuffer("image/png");

  // Panel first (top: 0), photo below (top: panelHeight) — see the
  // 2026-09-02 header comment: the details panel must be the part that
  // survives if WhatsApp crops a tall image in the chat feed thumbnail.
  const composite = await sharp({
    create: { width, height: height + panelHeight, channels: 3, background: "#0f172a" },
  })
    .composite([
      { input: panelBuffer, top: 0, left: 0 },
      { input: resizedPhotoBuffer, top: panelHeight, left: 0 },
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
