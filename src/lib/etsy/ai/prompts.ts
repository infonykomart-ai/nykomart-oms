// 2026-11-18 — Every AI prompt used by the Etsy SEO Generator lives here, so
// the rules the validation engine enforces are stated in exactly one place.
//
// Two non-negotiables in all prompts:
//   * Product facts are copied, never invented or "improved".
//   * Research metrics are never claimed. If a number was not measured, the
//     model must not produce one — the UI labels AI keywords as unverified.

import { ETSY_LANGUAGES, type EtsyLanguage } from "../languages";
import { REQUIRED_TAG_COUNT, TAG_MAX_CHARS, TITLE_MAX_CHARS } from "../validation";
import { factLines, type EtsyProductFacts } from "../product";
import type { KeywordGroups } from "./schemas";

export const DESCRIPTION_SECTIONS = [
  "Product introduction",
  "Main product features",
  "Material and craftsmanship",
  "Design and pattern",
  "Available sizes",
  "Product specifications",
  "Suitable rooms and uses",
  "Care instructions",
  "Customization options",
  "Shipping and processing information",
  "Important product notes",
];

export function listingSystemPrompt(): string {
  return `You are a senior Etsy SEO copywriter and native-level localizer for an Indian handmade rug/textile exporter.

You write ONE listing for ONE market at a time. The buyers are local shoppers who search in their own language — never a translation engine.

Hard rules:
1. Write natively in the requested language, using the vocabulary and spelling that market actually searches with. Do not mechanically translate the English title.
2. Never change or invent a product fact: material, dimensions, thickness, weight, technique, colour, care, certifications, origin, shipping promise, processing time. If a fact is not supplied, omit it.
3. Never invent search volume, review counts, sales, rankings or competitor data, and never claim "best seller", "eco-friendly", "organic", "certified" or "washable" unless the supplied facts say so.
4. Title: one line, at most ${TITLE_MAX_CHARS} characters INCLUDING spaces, primary keyword near the front, no ALL CAPS, no emoji, no keyword stuffing, each of % : & + at most once. Aim for a natural title under 15 words.
5. Tags: exactly ${REQUIRED_TAG_COUNT} tags, each at most ${TAG_MAX_CHARS} characters INCLUDING spaces, all in the target language, no duplicates, no numbering, no hashtags, no sentences. Mix: main product, material, technique, style/pattern, room/use, buyer-intent and long-tail phrases.
6. Description: complete listing in the target language, plain text with short headings and "-" bullets, in this order: ${DESCRIPTION_SECTIONS.join(", ")}. Mention a section only if you have the fact for it; skip care/shipping/customization when not supplied.
7. Alt text: describe ONLY what is visible in the photo, include the product keywords naturally, at most 250 characters, no invented details.

Return ONLY valid JSON with this exact shape:
{
  "title": "…",
  "description": "…",
  "tags": ["…", "… (exactly 13)"],
  "primary_keyword": "…",
  "secondary_keywords": ["…"],
  "alt_texts": [{"image": 1, "text": "…"}]
}`;
}

export type ListingPromptInput = {
  language: EtsyLanguage;
  facts: EtsyProductFacts;
  englishTitle: string;
  englishDescription?: string;
  englishTags?: string;
  keywords?: KeywordGroups | null;
  competitorNotes?: string | null;
  imageCount: number;
  imageDescriptions?: string[];
  field: "all" | "title" | "description" | "tags" | "alt_text";
  previousIssues?: string[];
};

function keywordBlock(keywords: KeywordGroups | null | undefined): string {
  if (!keywords) return "Local keyword research: none recorded yet — derive keywords from the product facts and write native buying phrases.";
  const line = (label: string, list: string[]) => (list.length ? `${label}: ${list.join(", ")}` : null);
  return [
    "Local keyword research for this market (use these, do not translate them):",
    line("Primary", keywords.primary),
    line("Secondary", keywords.secondary),
    line("Long-tail", keywords.longTail),
    line("Buyer intent", keywords.buyerIntent),
    line("Product terms", keywords.product),
    line("Material terms", keywords.material),
    line("Style/design", keywords.style),
    line("Room/use", keywords.room),
    line("Seasonal", keywords.seasonal),
    line("Competitor-inspired", keywords.competitor),
  ]
    .filter(Boolean)
    .join("\n");
}

export function listingUserPrompt(input: ListingPromptInput): string {
  const { language, facts, field } = input;
  const factsBlock = factLines(facts).join("\n") || "(no structured facts supplied — use only the English source below)";

  const scope =
    field === "title"
      ? 'Produce ONLY "title" (description "", tags [], alt_texts []).'
      : field === "description"
        ? 'Produce ONLY "description" (title "", tags [], alt_texts []).'
        : field === "tags"
          ? `Produce ONLY "tags" — exactly ${REQUIRED_TAG_COUNT} (title "", description "", alt_texts []).`
          : field === "alt_text"
            ? 'Produce ONLY "alt_texts" for every uploaded image (title "", description "", tags []).'
            : "Produce every field.";

  const images = input.imageCount
    ? `Images: ${input.imageCount} uploaded.\n${(input.imageDescriptions ?? []).map((d, i) => `- Image ${i + 1}: ${d}`).join("\n")}`
    : "Images: none uploaded (return an empty alt_texts array).";

  return `Target market: ${language.country}
Target language: ${language.name} (${language.locale})
Buyers search in: ${language.market}

PRODUCT FACTS (copy exactly; never invent, never change):
${factsBlock}

English source title: ${input.englishTitle}
${input.englishDescription ? `English source description:\n${input.englishDescription}\n` : ""}${input.englishTags ? `English source tags: ${input.englishTags}\n` : ""}
${keywordBlock(input.keywords)}

${images}
${input.competitorNotes ? `Competitor observations (public/user-provided only; never copy wording):\n${input.competitorNotes}\n` : ""}
${scope}

Write the ${language.name} listing now. Facts must match the PRODUCT FACTS exactly.${
    input.previousIssues?.length
      ? `\n\nYour previous attempt failed these checks — fix them:\n- ${input.previousIssues.join("\n- ")}`
      : ""
  }`;
}

export function keywordSystemPrompt(): string {
  return `You are an Etsy keyword researcher who understands local search behaviour in ${ETSY_LANGUAGES.length} European and Japanese markets.

Rules:
- Return keywords in the TARGET LANGUAGE, as buyers actually type them. Never translate English keywords word-for-word.
- Do not invent search volume, competition scores or sales numbers. You have no access to live metrics, so never return any.
- Prefer multi-word phrases (2–4 words). Tags must fit ${TAG_MAX_CHARS} characters, so include short variants too.
- Group honestly: primary (3–5), secondary (5–8), long_tail (5–8), buyer_intent (4–6), product, material, style, room, seasonal, competitor (3–5 each).

Return ONLY valid JSON:
{
  "primary": [], "secondary": [], "long_tail": [], "buyer_intent": [],
  "product": [], "material": [], "style": [], "room": [], "seasonal": [], "competitor": []
}`;
}

export function keywordUserPrompt(input: {
  language: EtsyLanguage;
  facts: EtsyProductFacts;
  englishTitle: string;
  competitorTitles?: string[];
}): string {
  const { language } = input;
  return `Market: ${language.country} / ${language.market}
Language: ${language.name}

Product facts:
${factLines(input.facts).join("\n") || `(only the title is known: ${input.englishTitle})`}

English title: ${input.englishTitle}
${input.competitorTitles?.length ? `Competitor titles seen publicly (do not copy):\n- ${input.competitorTitles.join("\n- ")}\n` : ""}
Return the keyword research JSON in ${language.name} now. No metrics — keywords only.`;
}

// ---------------------------------------------------------------------------
// 2026-11-24 — Shared, one-pass keyword research for all ten markets.
//
// The ten-language run used to call keyword research once per language. This
// prompt asks for every market in ONE reply, so the research cost is paid once
// and each language task receives only its own country-specific slice.
// ---------------------------------------------------------------------------
export function multiLanguageKeywordSystemPrompt(): string {
  return `You are an Etsy keyword researcher who understands local buying language in ${ETSY_LANGUAGES.length} markets (Dutch, French, German, Italian, Japanese, Polish, Portuguese, Russian, Spanish, Swedish).

Rules:
- Research all requested markets in ONE pass. Write every keyword in that market's own language, as buyers actually type it — never a word-for-word translation.
- Do not invent search volume, competition scores or sales numbers. You have no access to live metrics, so never return any.
- Prefer 2–4 word phrases a buyer would search. Include short variants that fit ${TAG_MAX_CHARS} characters.
- Per market return: primary (3–4), secondary (4–6), long_tail (3–4), buyer_intent (2–3), plus product, material, style, room and seasonal terms (2 each). Do not pad with duplicates.

Return ONLY valid JSON keyed by language code, for example:
{
  "nl": { "primary": [], "secondary": [], "long_tail": [], "buyer_intent": [], "product": [], "material": [], "style": [], "room": [], "seasonal": [] },
  "de": { … }
}`;
}

export function multiLanguageKeywordUserPrompt(input: {
  languages: EtsyLanguage[];
  facts: EtsyProductFacts;
  englishTitle: string;
  englishDescription?: string;
}): string {
  const markets = input.languages
    .map((language) => `- ${language.code} → ${language.name} (${language.locale}), market: ${language.market}`)
    .join("\n");
  return `Product facts (do not invent anything beyond these):
${factLines(input.facts).join("\n") || `(only the English title is known: ${input.englishTitle})`}

English source title: ${input.englishTitle}
${input.englishDescription ? `English source description (first 1200 characters):\n${input.englishDescription.slice(0, 1200)}\n` : ""}
Markets to research (one JSON object per language code):
${markets}

Return the JSON now, with a key for every one of the ${input.languages.length} language codes above.`;
}

export function competitorSystemPrompt(): string {
  return `You analyze publicly available Etsy competitor listings that the user supplied (title, tags, keywords, URL). You have no access to private sales, conversion or advertising data.

Rules:
- Never claim to know sales, revenue, conversion rate, ad spend or search ranking.
- Never copy a competitor title or description verbatim; extract patterns only.
- Suggest differentiators grounded in the product facts supplied.

Return ONLY valid JSON:
{"keyword_opportunities": [], "terminology": [], "title_structure": "", "long_tail": [], "keyword_gaps": [], "differentiation": [], "notes": ""}`;
}

export function competitorUserPrompt(input: {
  language: EtsyLanguage;
  facts: EtsyProductFacts;
  competitorUrl?: string;
  competitorTitle?: string;
  competitorTags?: string;
  competitorKeywords?: string;
  englishTitle: string;
}): string {
  return `Market: ${input.language.country} · Language: ${input.language.name}
Our product: ${input.englishTitle}
Our facts:
${factLines(input.facts).join("\n") || "(none supplied)"}

Competitor (user-provided / public):
URL: ${input.competitorUrl || "not given"}
Title: ${input.competitorTitle || "not given"}
Tags: ${input.competitorTags || "not given"}
Keywords: ${input.competitorKeywords || "not given"}

Analyze in ${input.language.name}. Return the JSON only.`;
}

export function altTextSystemPrompt(): string {
  return `You write Etsy image alt text. Describe only what is visibly present in the photo — item, colour, pattern, texture, framing, props. Never invent material, size, room or certifications that cannot be seen. Maximum 250 characters. Include the product's main keyword naturally, in the requested language, without stuffing.

Return ONLY valid JSON: {"alt_text": "…"}`;
}

export function altTextUserPrompt(input: {
  language: EtsyLanguage;
  facts: EtsyProductFacts;
  imageNumber: number;
  imageCount: number;
  visibleDescription?: string;
}): string {
  return `Language: ${input.language.name} (${input.language.locale}) — market ${input.language.country}.
Image ${input.imageNumber} of ${input.imageCount}.
Known product facts (do not restate unseen details): ${factLines(input.facts).slice(0, 6).join("; ") || input.facts.productName || "handmade rug"}
${input.visibleDescription ? `Visible content note: ${input.visibleDescription}` : ""}
Describe this photo in ${input.language.name}. JSON only.`;
}
