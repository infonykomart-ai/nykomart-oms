// 2026-11-18 — Live smoke test for the Etsy International SEO Generator.
//
//   npm run smoke:etsy-seo                 # German listing + XLSX/CSV/JSON export
//   ETSY_SMOKE_LANGUAGE=ja npm run smoke:etsy-seo
//
// This is the one check the offline test suite cannot make: it calls the REAL
// Gemini API with GEMINI_API_KEY (and OpenRouter only if both OpenRouter
// variables are set). It runs the same pipeline the /api/etsy-seo/generate
// route runs — prompt → provider manager → strict parser → deterministic
// validator → export builders — then writes the three export formats and
// prints provider, model, tokens, latency and estimated cost.
//
// It spends your credits: one generation, plus one repair attempt if the model
// returns unusable JSON, plus the OpenRouter fallback if Gemini fails.
// A missing key is a setup message and exit code 2, never a fake success.

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { AIProviderManager, createProviders, type AttemptLog } from "../src/lib/etsy/ai/ai-provider.manager";
import { listingSystemPrompt, listingUserPrompt } from "../src/lib/etsy/ai/prompts";
import { parseListingOutput } from "../src/lib/etsy/ai/schemas";
import { estimateCostUsd } from "../src/lib/etsy/ai/pricing";
import { ETSY_LANGUAGES, etsyLanguage, type EtsyLanguage } from "../src/lib/etsy/languages";
import { validateListing } from "../src/lib/etsy/seo-validation";
import { buildListingsCsv, buildProjectJson, buildWorkbook, type ExportListing } from "../src/lib/etsy/export";
import { charCount, REQUIRED_TAG_COUNT, TAG_MAX_CHARS, TITLE_MAX_CHARS } from "../src/lib/etsy/validation";
import type { EtsyProductFacts } from "../src/lib/etsy/product";

const LANGUAGE_CODE = (process.env.ETSY_SMOKE_LANGUAGE ?? "de").trim().toLowerCase();
const OUT_DIR = path.resolve(process.cwd(), "artifacts", "etsy-seo-smoke");

const FACTS: EtsyProductFacts = {
  productName: "Handmade Cotton Rug",
  productType: "Area rug",
  category: "Home & Living > Rugs",
  material: "100% cotton",
  technique: "Hand block printed",
  colour: "Natural beige with indigo",
  shape: "Rectangular",
  pattern: "Floral block print",
  sizes: "60x90 cm, 90x150 cm",
  thickness: "5 mm",
  weight: "1.2 kg",
  originCountry: "India",
  usage: "Living room, bedroom, hallway",
  care: "Gentle hand wash in cold water, dry flat",
  features: "Lightweight, foldable, flat weave",
  shipping: "Ships from India",
  processingTime: "3-5 business days",
};

function requireLanguage(code: string): EtsyLanguage {
  const found = etsyLanguage(code);
  if (!found) {
    console.error(`Unknown ETSY_SMOKE_LANGUAGE "${code}". Expected one of: ${ETSY_LANGUAGES.map((l) => l.code).join(", ")}.`);
    process.exit(2);
  }
  return found;
}

const LANGUAGE = requireLanguage(LANGUAGE_CODE);

const geminiKey = (process.env.GEMINI_API_KEY ?? "").trim();
const openRouterKey = (process.env.OPENROUTER_API_KEY ?? "").trim();
const openRouterModel = (process.env.OPENROUTER_MODEL_ID ?? "").trim();

if (!geminiKey) {
  console.error(
    [
      "GEMINI_API_KEY is not set — refusing to pretend a live call happened.",
      "",
      "Set it for one run without writing it into a file:",
      "  GEMINI_API_KEY=… npm run smoke:etsy-seo",
      "or put GEMINI_API_KEY in .env.local (see .env.example) and run the same command.",
      "",
      "Optional: OPENROUTER_API_KEY + OPENROUTER_MODEL_ID enable the real backup path.",
    ].join("\n")
  );
  process.exit(2);
}

async function main() {
  const providers = createProviders({
    geminiApiKey: geminiKey,
    openRouterApiKey: openRouterKey || null,
    openRouterModels: openRouterModel ? [openRouterModel] : undefined,
  });
  const backupEnabled = !!openRouterKey && !!openRouterModel;
  const manager = new AIProviderManager(providers);

  const attempts: AttemptLog[] = [];
  const onAttempt = (log: AttemptLog) => {
    attempts.push(log);
    const tokens = log.usage ? `${log.usage.inputTokens ?? "?"} in / ${log.usage.outputTokens ?? "?"} out` : "usage not reported";
    console.log(`  attempt: ${log.provider}/${log.model} ${log.status} ${log.latencyMs} ms ${tokens}${log.errorMessage ? ` — ${log.errorMessage}` : ""}`);
  };

  console.log(`Live smoke test — ${LANGUAGE.name} (${LANGUAGE.locale}, ${LANGUAGE.country})`);
  console.log(`  primary: gemini/${process.env.GEMINI_MODEL_ID?.trim() || "(provider default)"}`);
  console.log(`  backup:  ${backupEnabled ? `openrouter/${openRouterModel}` : "not configured (alternate Gemini model only)"}`);
  console.log("  this run spends real API credits.\n");

  const startedAt = Date.now();
  const result = await manager.generateStructured({
    operation: "listing",
    system: listingSystemPrompt(),
    prompt: listingUserPrompt({
      language: LANGUAGE,
      facts: FACTS,
      englishTitle: FACTS.productName ?? "Handmade Cotton Rug",
      imageCount: 0,
      field: "all",
    }),
    temperature: 0.6,
    config: {
      backupEnabled,
      primaryModel: process.env.GEMINI_MODEL_ID?.trim() || null,
      backupModel: openRouterModel || null,
    },
    parse: (text) => parseListingOutput(text, { field: "all", imageCount: 0 }),
    onAttempt,
  });

  const listing = result.data;
  const report = validateListing({
    languageCode: LANGUAGE.code,
    locale: LANGUAGE.locale,
    title: listing.title,
    description: listing.description,
    tags: listing.tags,
    altTexts: [],
    imageCount: 0,
    keywords: { primary: listing.primaryKeyword || undefined, secondary: listing.secondaryKeywords },
    sourceTitle: FACTS.productName,
  });

  const cost = estimateCostUsd(result.model, result.provider, result.usage);
  console.log("\nResult");
  console.log(`  provider:   ${result.provider} (${result.model})${result.backupUsed ? " — BACKUP WAS USED" : ""}`);
  console.log(`  latency:    ${result.latencyMs} ms end to end`);
  console.log(`  tokens:     ${result.usage?.inputTokens ?? "?"} in / ${result.usage?.outputTokens ?? "?"} out`);
  console.log(`  est. cost:  ${cost === null ? "unknown (no published price for this model)" : `$${cost.toFixed(6)}`}`);
  console.log(`  title:      ${charCount(listing.title)}/${TITLE_MAX_CHARS} chars`);
  console.log(`  tags:       ${listing.tags.length}/${REQUIRED_TAG_COUNT}, longest ${Math.max(0, ...listing.tags.map((t) => charCount(t)))}/${TAG_MAX_CHARS}`);
  console.log(`  description: ${charCount(listing.description)} chars`);
  console.log(`  validation: ${report.status} — score ${report.score}/100`);
  for (const error of report.errors) console.log(`    error:   ${error}`);
  for (const warning of report.warnings) console.log(`    warning: ${warning}`);
  for (const note of listing.notes) console.log(`    note:    ${note}`);

  const exportListing: ExportListing = {
    country: LANGUAGE.country,
    language: LANGUAGE.name,
    languageCode: LANGUAGE.code,
    locale: LANGUAGE.locale,
    title: listing.title,
    description: listing.description,
    tags: listing.tags,
    altTexts: [],
    seoScore: report.score,
    validationStatus: report.status,
    validationReport: report,
    provider: result.provider,
    model: result.model,
    backupUsed: result.backupUsed,
  };
  const project = {
    id: "smoke-test",
    projectName: FACTS.productName ?? "Handmade Cotton Rug",
    sku: "SMOKE-1",
    category: FACTS.category,
    originalTitle: FACTS.productName ?? "Handmade Cotton Rug",
    originalDescription: "",
    originalTags: "",
    product: FACTS as Record<string, unknown>,
  };
  const exportInput = { project, listings: [exportListing], keywords: [], competitors: [] };

  const json = JSON.stringify(buildProjectJson(exportInput), null, 2);
  const csv = buildListingsCsv([exportListing]);
  const workbook = buildWorkbook(exportInput);

  // The key must never reach an export, a log line or a filename.
  const files: Array<{ name: string; body: string | Buffer }> = [
    { name: `etsy-seo-${LANGUAGE.code}.json`, body: json },
    { name: `etsy-seo-${LANGUAGE.code}.csv`, body: csv },
    { name: `etsy-seo-${LANGUAGE.code}.xlsx`, body: workbook },
  ];
  for (const file of files) {
    const text = Buffer.isBuffer(file.body) ? file.body.toString("latin1") : file.body;
    if (text.includes(geminiKey) || (openRouterKey && text.includes(openRouterKey))) {
      throw new Error(`The API key leaked into ${file.name} — refusing to write it.`);
    }
  }

  await mkdir(OUT_DIR, { recursive: true });
  for (const file of files) {
    const target = path.join(OUT_DIR, file.name);
    await writeFile(target, file.body);
    console.log(`  wrote ${path.relative(process.cwd(), target)} (${Buffer.byteLength(file.body as string | Buffer)} bytes)`);
  }

  // Same rules as the route: a "fail" is a real failure, a "warning" is not
  // (no images were uploaded to this smoke run, so alt text is always missing).
  if (report.status === "fail") {
    console.error(`\nSmoke test failed: the generated ${LANGUAGE.name} listing does not pass validation.`);
    process.exit(1);
  }

  console.log(`\nSmoke test passed in ${Date.now() - startedAt} ms.`);
  console.log(`Open ${path.relative(process.cwd(), OUT_DIR)}/ to read the real ${LANGUAGE.name} output.`);
}

main().catch((error) => {
  console.error(`\nSmoke test failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
