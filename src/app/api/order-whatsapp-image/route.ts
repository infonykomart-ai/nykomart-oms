import sharp from "sharp";
import { createCanvas, GlobalFonts, loadImage, type SKRSContext2D } from "@napi-rs/canvas";
import path from "node:path";
import { requireCapability, UnauthorizedError, ForbiddenError } from "@/lib/auth/require-capability";
import { safeExternalFetch } from "@/lib/security/safe-external-fetch";

// 2026-09-15 — "jo order send karte hai new order to whatsaap or telegram
// par ek hi msg me product ki photo or sath me msg jo program me decide kar
// rakha hai vo nhi jara" — the details caption is BAKED INTO THE IMAGE
// pixels again (details panel rendered ABOVE the photo inside one JPEG),
// because `navigator.share({ files, text })` keeps splitting into a
// photo-only message on real devices (Windows/WhatsApp Desktop drops the
// text entirely — exactly what the user hit on PO-A647/A646/A645).
//
// Full flip-flop history (read before changing this approach again):
//  • 2026-08-08: photo + separate text → 2 bubbles. Fix: drop text, bake
//    caption pixels (original composite route).
//  • 2026-09-01: "sirf photo ja rahi hai" → text re-added as trade-off.
//  • 2026-09-02: split again, proven by screenshots → image-only again,
//    panel moved above the photo.
//  • 2026-09-03: text re-added AGAIN (user wanted searchable caption),
//    knowingly unverified.
//  • 2026-09-04: baked caption removed from this route (photo-only), text
//    remains the caption — which is precisely the configuration that
//    re-broke on Windows today. Text-inside-image is the ONLY arrangement
//    no platform can split. The route now bakes the panel again and the
//    button (order-whatsapp-button.tsx) passes the SAME info as `text`
//    for platforms that do honor it (Android share sheet keeps photo+text
//    together as caption+text in one message).
//
// Fonts: @napi-rs/canvas GlobalFonts — NotoSans for Latin, NotoSans-
// Devanagari for Hindi remarks. Vercel's Node runtime ships no usable
// system fonts, so the two .ttf files under src/lib/fonts are registered
// explicitly. (Font path trick: route files get bundled by Turbopack, so
// the absolute path is computed and wrapped in try/catch — if a deploy
// target ever drops the fonts dir, the panel still renders with the
// fallback font instead of 500-ing.)
export const runtime = "nodejs";

const MAX_WIDTH = 1000;

const LATIN_FONT_PATH = path.join(process.cwd(), "src", "lib", "fonts", "NotoSans-Regular.ttf");
const DEVANAGARI_FONT_PATH = path.join(process.cwd(), "src", "lib", "fonts", "NotoSansDevanagari-Regular.ttf");

function registerFontsOnce() {
  try {
    if (!GlobalFonts.has("OMSSans")) GlobalFonts.registerFromPath(LATIN_FONT_PATH, "OMSSans");
    if (!GlobalFonts.has("OMSDevanagari")) GlobalFonts.registerFromPath(DEVANAGARI_FONT_PATH, "OMSDevanagari");
    return true;
  } catch {
    return false;
  }
}

// All text renders through the Hindi font stack — NotoSansDevanagari
// carries both Devanagari AND Latin glyphs, with OMSSans as fallback.
const HINDI = "OMSDevanagari, OMSSans";

type CaptionRow = { label: string; value: string };
type CaptionPanel = { rows: CaptionRow[]; note: string | null };

// The SAME field template the WhatsApp text caption uses (see
// order-whatsapp-button.tsx buildMessage) — both share one shape so the
// baked panel and the text caption can never disagree.
function buildPanelFromParams(params: URLSearchParams): CaptionPanel {
  const showTassel = params.get("show_tassel_fringes") === "1";
  const tassel = params.get("tassel_fringes") === "1";
  const rows: CaptionRow[] = [
    { label: "PO/RF/RG", value: params.get("ref_no") || "-" },
    { label: "QTY", value: params.get("qty") || "-" },
    { label: "Size", value: params.get("size") || "-" },
    { label: "Dispatch Date", value: params.get("dispatch_date") || "-" },
    { label: "Photo", value: params.get("photo_type") || "-" },
    { label: "Colour", value: params.get("colour") || "-" },
    ...(showTassel ? [{ label: "Tassel/ Fringes", value: tassel ? "Yes" : "No" } as CaptionRow] : []),
    { label: "SKU", value: params.get("sku") || "-" },
  ];
  const note = params.get("note") || "";
  return { rows, note: note && note !== "-" ? note : null };
}

// The label column is rendered in a fixed-width gutter so every value
// aligns; long values wrap within the value column.
function drawPanel(
  ctx: SKRSContext2D,
  panel: CaptionPanel,
  x: number,
  y: number,
  width: number,
  scale: number
): number {
  const labelFont = `${13 * scale}px ${HINDI}`;
  const valueFont = `600 ${13 * scale}px ${HINDI}`;
  const noteFont = `${13.5 * scale}px ${HINDI}`;
  const labelWidth = 110 * scale;
  const rowGap = 8 * scale;
  const lineH = 18 * scale;

  ctx.textBaseline = "top";
  let cursorY = y;
  for (const row of panel.rows) {
    ctx.font = labelFont;
    ctx.fillStyle = "rgba(120,113,108,1)";
    ctx.fillText(row.label, x, cursorY);

    ctx.font = valueFont;
    ctx.fillStyle = "rgba(28,25,23,1)";
    // wrap value into the remaining width
    const words = row.value.split(/\s+/);
    let line = "";
    let lineY = cursorY;
    for (const w of words) {
      const candidate = line ? `${line} ${w}` : w;
      if (ctx.measureText(candidate).width > width - labelWidth && line) {
        ctx.fillText(line, x + labelWidth, lineY);
        line = w;
        lineY += lineH;
      } else {
        line = candidate;
      }
    }
    if (line) ctx.fillText(line, x + labelWidth, lineY);
    cursorY = Math.max(lineY + lineH, cursorY + lineH) + rowGap;
  }

  if (panel.note) {
    cursorY += 4 * scale;
    ctx.font = noteFont;
    ctx.fillStyle = "rgba(28,25,23,1)";
    const words = panel.note.split(/\s+/);
    let line = "";
    const maxWidth = width;
    for (const w of words) {
      const candidate = line ? `${line} ${w}` : w;
      if (ctx.measureText(candidate).width > maxWidth && line) {
        ctx.fillText(line, x, cursorY);
        line = w;
        cursorY += lineH;
      } else {
        line = candidate;
      }
    }
    if (line) ctx.fillText(line, x, cursorY);
    cursorY += lineH;
  }

  return cursorY - y; // total height consumed
}

// Measured with the same fonts/layout drawPanel uses — measure first, then
// compose canvas at the exact total height, then draw.
function measurePanelHeight(panel: CaptionPanel, width: number, scale: number): number {
  const canvas = createCanvas(10, 10);
  const ctx = canvas.getContext("2d");
  ctx.font = `600 ${13 * scale}px ${HINDI}`;
  const labelWidth = 110 * scale;
  const rowGap = 8 * scale;
  const lineH = 18 * scale;
  let h = 0;
  for (const row of panel.rows) {
    const words = row.value.split(/\s+/);
    let line = "";
    let lines = 1;
    for (const w of words) {
      const candidate = line ? `${line} ${w}` : w;
      if (ctx.measureText(candidate).width > width - labelWidth && line) {
        lines += 1;
        line = w;
      } else {
        line = candidate;
      }
    }
    h += lines * lineH + rowGap;
  }
  if (panel.note) {
    h += 4 * scale;
    ctx.font = `${13.5 * scale}px ${HINDI}`;
    let line = "";
    let lines = 1;
    for (const w of panel.note.split(/\s+/)) {
      const candidate = line ? `${line} ${w}` : w;
      if (ctx.measureText(candidate).width > width && line) {
        lines += 1;
        line = w;
      } else {
        line = candidate;
      }
    }
    h += lines * lineH;
  }
  return h;
}

export async function GET(request: Request) {
  try {
    await requireCapability("order_entry");
  } catch (err) {
    if (err instanceof UnauthorizedError) return new Response("Not signed in.", { status: 401 });
    if (err instanceof ForbiddenError) return new Response("Forbidden.", { status: 403 });
    throw err;
  }

  // 2026-09-19 — multi-photo composite: url1 = Main, url2/url3 = Closeup 1/2
  // (the button only sends url2/url3 when those slots are actually filled).
  // `url` stays accepted as the legacy alias for url1. A closeup that fails
  // to load is skipped (the composite still goes out with what loaded); the
  // MAIN photo failing is still a hard error, same as before.
  const params = new URL(request.url).searchParams;
  const mainRaw = params.get("url1") ?? params.get("url");
  if (!mainRaw) return new Response("Missing url", { status: 400 });
  const closeupRaws = [params.get("url2"), params.get("url3")]
    .filter((u): u is string => !!u)
    .slice(0, 2);

  async function fetchDecoded(raw: string): Promise<{ buffer: Buffer; width: number; height: number } | null> {
    try {
      const r = await safeExternalFetch(raw);
      if (!r.ok) return null;
      const buf = Buffer.from(await r.response.arrayBuffer());
      const p = sharp(buf);
      const meta = await p.metadata();
      const w = meta.width ?? MAX_WIDTH;
      return { buffer: buf, width: w, height: meta.height ?? Math.round((w * 3) / 4) };
    } catch {
      return null;
    }
  }

  // Positional results: slot 0 is ALWAYS the Main photo — if it fails the
  // request errors rather than silently relabeling a closeup as Main; a
  // failed closeup slot is just skipped from the composite.
  const [mainResult, ...closeupResults] = await Promise.all([
    fetchDecoded(mainRaw),
    ...closeupRaws.map((u) => fetchDecoded(u)),
  ]);
  if (!mainResult) return new Response("Could not load the main photo", { status: 502 });
  const loaded = [mainResult, ...closeupResults.filter((p): p is NonNullable<typeof p> => !!p)];

  // One shared width for the whole composite: the narrowest photo, capped
  // at MAX_WIDTH — nothing gets stretched and the panel math stays
  // single-column.
  const width = Math.min(MAX_WIDTH, ...loaded.map((p) => p.width));
  const photos = await Promise.all(
    loaded.map(async (p) => {
      const scale = width / p.width;
      const height = Math.max(1, Math.round(p.height * scale));
      const resized = await sharp(p.buffer).resize(width, height).jpeg({ quality: 88 }).toBuffer();
      return { buffer: resized, height };
    })
  );

  // ── Baked details panel (above the photo) ──────────────────────────────
  const panel = buildPanelFromParams(params);
  const fontsOk = registerFontsOnce();
  const panelScale = Math.max(1, Math.round(width / 500)); // crisp on large photos
  const panelPad = 20 * panelScale;
  const bannerH = 34 * panelScale; // TOP PRIORITY strip
  const isAmazon = params.get("is_amazon") === "1";
  const measured =
    panelPad + bannerH + measurePanelHeight(panel, width - panelPad * 2, panelScale) + panelPad;

  // 2026-09-19 — per-photo label strip (only when 2+ photos made it in):
  // "Main Photo" / "Closeup 1" / "Closeup 2", matching the entry form's
  // slots and the print sheet's captions. Single photo → no strips at all,
  // exactly the old look ("agar single hai to uske hisab se").
  const labels = photos.length > 1 ? ["Main Photo", "Closeup 1", "Closeup 2"].slice(0, photos.length) : [];
  const labelH = labels.length ? 26 * panelScale : 0;

  const totalPhotosH = photos.reduce((sum, p) => sum + labelH + p.height, 0);
  const canvas = createCanvas(width, measured + totalPhotosH);
  const ctx = canvas.getContext("2d");

  // Panel background + Amazon banner
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, measured);
  if (isAmazon) {
    ctx.fillStyle = "#b91c1c";
    ctx.fillRect(0, 0, width, bannerH);
    ctx.font = `700 ${17 * panelScale}px ${HINDI}`;
    ctx.fillStyle = "#ffffff";
    ctx.textBaseline = "middle";
    ctx.fillText("TOP PRIORITY — Amazon order", panelPad, bannerH / 2 + 1);
    ctx.textBaseline = "top";
  }

  if (fontsOk) {
    drawPanel(ctx, panel, panelPad, panelPad + bannerH, width - panelPad * 2, panelScale);
  } else {
    // Fonts failed to register (deploy target without the ttf files) —
    // degrade to a plain placeholder so the share flow still works.
    ctx.fillStyle = "#78716c";
    ctx.font = `${14 * panelScale}px sans-serif`;
    ctx.fillText("Order details: see caption", panelPad, panelPad + bannerH + 8 * panelScale);
  }

  // Photos below the panel, stacked — each is fully decoded via PNG before
  // drawImage (canvas drawImage decodes png reliably).
  let y = measured;
  for (let i = 0; i < photos.length; i++) {
    if (labels.length) {
      ctx.fillStyle = "#f5f5f4";
      ctx.fillRect(0, y, width, labelH);
      ctx.fillStyle = "#78716c";
      ctx.font = `600 ${13 * panelScale}px ${HINDI}`;
      ctx.textBaseline = "middle";
      ctx.fillText(labels[i], panelPad, y + labelH / 2 + 1);
      ctx.textBaseline = "top";
      y += labelH;
    }
    const png = await sharp(photos[i].buffer).png().toBuffer();
    const img = await loadImage(png);
    ctx.drawImage(img, 0, y, width, photos[i].height);
    y += photos[i].height;
  }

  const composite = await canvas.encode("jpeg", 88);

  return new Response(new Uint8Array(composite), {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "private, max-age=60",
    },
  });
}
