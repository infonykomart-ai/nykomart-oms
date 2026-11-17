import { NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { getAuthedEmployee, UnauthorizedError } from "@/lib/auth/require-capability";
import { ETSY_LANGUAGES, etsyLanguage } from "@/lib/etsy/languages";
import {
  clampTitle,
  normalizeTags,
  REQUIRED_TAG_COUNT,
  TAG_MAX_CHARS,
  TITLE_MAX_CHARS,
  validateTranslation,
} from "@/lib/etsy/validation";

// 2026-11-17 — AI generation for the Etsy multilingual module.
//
// ONE language per request on purpose: "Generate All" loops ten calls from the
// client so a single slow/failed language never loses the other nine, the UI
// can show per-language progress, and no request comes near a serverless
// timeout. `field` narrows a regeneration to title / description / tags only —
// the other fields are returned untouched (empty here, merged client-side).
//
// Provider: the GEMINI_API_KEY the OMS already uses for the AI companion and
// the companion-image generator (see /api/companion-chat). The spec's
// "auto Google se update" style live data is NOT involved: Etsy keyword
// knowledge here is the model's own, so the response never claims verified
// search volume.
const MODEL = "gemini-flash-latest";
const MAX_ATTEMPTS = 2;

export const maxDuration = 60;

export type EtsySourcePayload = {
  sku?: string;
  productName?: string;
  title: string;
  description: string;
  tags?: string;
  category?: string;
  material?: string;
  size?: string;
  colour?: string;
  technique?: string;
  features?: string;
};

type GenerateBody = {
  languageCode?: string;
  field?: "all" | "title" | "description" | "tags";
  source?: EtsySourcePayload;
};

type AiListing = { title?: string; description?: string; tags?: unknown };

function buildSystemPrompt(): string {
  return `You are a professional Etsy SEO copywriter and native-level translator working for an Indian handmade-textile exporter.

Your job: take ONE English Etsy listing and produce a localized, search-optimized listing for a specific target language and marketplace.

Hard rules:
- Translate meaning, not words. Write like a native Etsy seller in that country, not like a translation engine.
- Keep every product fact exactly as given (material, size, colour, technique, measurements, care). Never invent certifications, origins, delivery times, discounts or claims.
- Etsy limits: title at most ${TITLE_MAX_CHARS} characters INCLUDING spaces; exactly ${REQUIRED_TAG_COUNT} tags, each at most ${TAG_MAX_CHARS} characters INCLUDING spaces; tags are single-word-or-phrase search terms, never sentences, no duplicates, no numbering, no hashtags.
- Titles: one title, local keywords in natural local order, primary keyword near the front, no keyword stuffing, no ALL CAPS, no emoji.
- Descriptions: complete listing in the local language with these labelled parts, using plain text and "-" bullets:
  Introduction, Features (material, technique, design, shape/colour, texture/thickness, handmade details), Available Sizes, Uses (living room, bedroom, dining room, hallway, entryway, home decoration — only where sensible), Care Instructions, Important Information (handmade/colour variations, dimensions, customization, shipping if given), Closing.
- Tags: mix main product, material, style, design, room/use and buyer-intent phrases, all in the target language. Do not just transliterate English tags.
- Never claim you researched live search volume.
Return ONLY valid JSON, no markdown, exactly:
{"title": "...", "description": "...", "tags": ["tag1", "... exactly 13 ..."]}`;
}

function buildUserPrompt(languageName: string, market: string, source: EtsySourcePayload, field: GenerateBody["field"], retryIssues: string[]): string {
  const facts = [
    source.sku && `SKU: ${source.sku}`,
    source.productName && `Product name: ${source.productName}`,
    `English title: ${source.title}`,
    source.description && `English description:\n${source.description}`,
    source.tags && `English tags: ${source.tags}`,
    source.category && `Category: ${source.category}`,
    source.material && `Material: ${source.material}`,
    source.size && `Size: ${source.size}`,
    source.colour && `Colour: ${source.colour}`,
    source.technique && `Manufacturing technique: ${source.technique}`,
    source.features && `Features: ${source.features}`,
  ]
    .filter(Boolean)
    .join("\n");

  const scope =
    field === "title"
      ? 'Produce ONLY the "title" field (still return the JSON object; use an empty string for description and an empty array for tags).'
      : field === "description"
        ? 'Produce ONLY the "description" field (empty title, empty tags array).'
        : field === "tags"
          ? 'Produce ONLY the 13 "tags" (empty title, empty description).'
          : "Produce all three fields.";

  return `Target language: ${languageName}
Target Etsy marketplace: ${market}

${facts}

${scope}

Write the localized Etsy listing in ${languageName} now.
Remember: exactly ${REQUIRED_TAG_COUNT} tags, each ${TAG_MAX_CHARS} characters or fewer, and a title within ${TITLE_MAX_CHARS} characters.${
    retryIssues.length > 0 ? `\n\nYour previous attempt failed these checks — fix them:\n- ${retryIssues.join("\n- ")}` : ""
  }`;
}

/** Pull a JSON object out of a model reply that may be fenced or chatty. */
function parseAiJson(text: string): AiListing | null {
  const cleaned = text.replace(/```json/gi, "```").replace(/```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1)) as AiListing;
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  try {
    await getAuthedEmployee();
  } catch (err) {
    if (err instanceof UnauthorizedError) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
    throw err;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      {
        error:
          "GEMINI_API_KEY is not set — add it in the environment variables (the same key the AI companion uses), then try again.",
      },
      { status: 503 }
    );
  }

  let body: GenerateBody;
  try {
    body = (await req.json()) as GenerateBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const language = etsyLanguage(body.languageCode ?? "");
  if (!language) {
    return NextResponse.json({ error: `Unknown language. Expected one of: ${ETSY_LANGUAGES.map((l) => l.code).join(", ")}.` }, { status: 400 });
  }
  const source = body.source;
  if (!source?.title?.trim()) return NextResponse.json({ error: "The English title is required." }, { status: 400 });
  const field = body.field ?? "all";

  const ai = new GoogleGenAI({ apiKey });
  let issues: string[] = [];
  let last: { title: string; description: string; tags: string[] } | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await ai.models.generateContent({
        model: MODEL,
        contents: [{ role: "user", parts: [{ text: buildUserPrompt(language.name, language.market, source, field, issues) }] }],
        config: {
          systemInstruction: buildSystemPrompt(),
          responseMimeType: "application/json",
          temperature: 0.65,
        },
      });
      const parsed = parseAiJson(response.text ?? "");
      if (!parsed) {
        issues = ["Reply was not valid JSON."];
        continue;
      }

      const title = field === "description" || field === "tags" ? "" : clampTitle(String(parsed.title ?? ""));
      const description = field === "title" || field === "tags" ? "" : String(parsed.description ?? "").trim();
      const tagInput = field === "title" || field === "description" ? [] : (parsed.tags as string[] | undefined) ?? [];
      const normalized = normalizeTags(tagInput);

      last = { title, description, tags: normalized.tags };

      // Only validate the fields this request actually produced.
      const check = validateTranslation({
        title: field === "description" || field === "tags" ? source.title : title,
        description: field === "title" || field === "tags" ? (source.description || "x".repeat(120)) : description,
        tags: field === "title" || field === "description" ? Array.from({ length: REQUIRED_TAG_COUNT }, (_, i) => `tag ${i}`) : normalized.tags,
      });
      const relevant = check.issues.filter(
        (issue) =>
          (field === "all") ||
          (field === "title" && issue.startsWith("Title")) ||
          (field === "description" && issue.startsWith("Description")) ||
          (field === "tags" && issue.startsWith("Tags"))
      );
      if (relevant.length === 0) {
        return NextResponse.json({
          ok: true,
          languageCode: language.code,
          languageName: language.name,
          field,
          title: last.title,
          description: last.description,
          tags: last.tags,
          validation: {
            titleCharacters: [...(last.title || "")].length,
            maxTitleCharacters: TITLE_MAX_CHARS,
            tagCount: last.tags.length,
            requiredTagCount: REQUIRED_TAG_COUNT,
            maxTagLength: Math.max(0, ...last.tags.map((t) => [...t].length)),
            maxTagCharacters: TAG_MAX_CHARS,
            pass: true,
          },
          model: MODEL,
          drops: normalized.droppedTooLong.length + normalized.droppedDuplicate > 0
            ? { tooLong: normalized.droppedTooLong, duplicates: normalized.droppedDuplicate }
            : null,
        });
      }
      issues = relevant;
    } catch (err) {
      const status = err && typeof err === "object" && "status" in err ? (err as { status?: unknown }).status : undefined;
      const text = err instanceof Error ? `${err.name} ${err.message}` : String(err);
      if (status === 429 || /RESOURCE_EXHAUSTED|rate.?limit|quota/i.test(text)) {
        return NextResponse.json(
          { error: "Gemini's rate limit is finished for now — wait a minute and retry this language." },
          { status: 429 }
        );
      }
      if (status === 401 || status === 403 || /API key not valid|API_KEY_INVALID|PERMISSION_DENIED/i.test(text)) {
        return NextResponse.json({ error: "GEMINI_API_KEY looks invalid or expired — ask an Admin to update it." }, { status: 502 });
      }
      console.error("etsy-translation generate error:", err);
      return NextResponse.json({ error: "The translation service is having trouble right now — try again." }, { status: 502 });
    }
  }

  // Both attempts produced something, but it still breaks an Etsy rule: hand
  // the text back with pass:false so the user can fix it instead of losing it.
  return NextResponse.json({
    ok: true,
    languageCode: language.code,
    languageName: language.name,
    field,
    title: last?.title ?? "",
    description: last?.description ?? "",
    tags: last?.tags ?? [],
    validation: { pass: false, issues, maxTitleCharacters: TITLE_MAX_CHARS, maxTagCharacters: TAG_MAX_CHARS, requiredTagCount: REQUIRED_TAG_COUNT },
    model: MODEL,
  });
}
