// 2026-11-18 — End-to-end generation pipeline, offline.
//
// This test runs the same code the /api/etsy-seo/generate route runs, in the
// same order, for all ten markets:
//
//   real prompt builder → real AIProviderManager (retry + fallback) →
//   real strict parser → real deterministic validator → real export builders
//
// The only thing replaced is the network: a stub provider returns realistic
// model output (fenced JSON, one over-long tag, localized copy). So the seams
// that a live run would first expose — prompt/parser contract drift, the
// 13-tag and 250-character rules, UTF-8 through CSV/JSON/XLSX, backup flagging
// and "never report success when every provider failed" — are exercised here.
//
// Still unverified without a key: the vendors actually answering, and the
// quality of real model output. See provider-wire.test.ts for the request
// format both providers send.

import { test } from "node:test";
import assert from "node:assert/strict";
import { AIProviderManager, type AttemptLog } from "./ai/ai-provider.manager";
import { ProviderError, type AIProvider, type ProviderHealth, type ProviderResponse, type StructuredRequest } from "./ai/types";
import { listingSystemPrompt, listingUserPrompt } from "./ai/prompts";
import { parseListingOutput } from "./ai/schemas";
import { ETSY_LANGUAGES, etsyLanguage } from "./languages";
import { validateListing } from "./seo-validation";
import { buildListingsCsv, buildProjectJson, buildWorkbook } from "./export";
import { REQUIRED_TAG_COUNT, TAG_MAX_CHARS, TITLE_MAX_CHARS, charCount } from "./validation";
import type { EtsyProductFacts } from "./product";

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

type Fixture = { title: string; primaryKeyword: string; tags: string[]; description: string };

/** Realistic "model output" per market: native copy, not a translation. */
const FIXTURES: Record<string, Fixture> = {
  nl: {
    title: "Katoenen vloerkleed handgemaakt met floral blokprint beige indigo 90x150 cm",
    primaryKeyword: "katoenen vloerkleed",
    tags: [
      "katoenen vloerkleed",
      "handgemaakt tapijt",
      "blokprint kleed",
      "vloerkleed 90x150",
      "beige indigo kleed",
      "floral vloerkleed",
      "woonkamer kleed",
      "slaapkamer tapijt",
      "katoen tapijt india",
      "boho vloerkleed",
      "plat geweven kleed",
      "duurzaam katoen",
      "handbedrukt kleed",
    ],
    description:
      "Dit katoenen vloerkleed wordt in India met de hand bedrukt met een floral blokprint in natuurlijk beige en indigo. Het platte weefsel voelt zacht aan, is licht van gewicht en laat zich eenvoudig opvouwen voor de opslag. Verkrijgbaar in 60x90 cm en 90x150 cm, dikte 5 mm, gewicht 1,2 kg. Geschikt voor de woonkamer, slaapkamer of hal. Reinig met de hand in koud water en laat liggend drogen. Kleine kleurverschillen horen bij handwerk en maken elk kleed uniek. Verzending uit India, verwerkingstijd 3-5 werkdagen.",
  },
  fr: {
    title: "Tapis en coton fait main imprimé floral beige indigo 90x150 cm",
    primaryKeyword: "tapis en coton",
    tags: [
      "tapis en coton",
      "tapis fait main",
      "tapis salon",
      "tapis chambre",
      "tapis 90x150",
      "imprimé floral",
      "tapis beige",
      "tapis indigo",
      "tapis bohème",
      "tapis plat",
      "tapis coton inde",
      "tapis décoratif",
      "tapis intérieur",
    ],
    description:
      "Ce tapis en coton est fabriqué à la main en Inde et imprimé à la planche avec un motif floral beige naturel et indigo. Le tissage plat reste doux au toucher, léger et facile à plier pour le rangement. Disponible en 60x90 cm et 90x150 cm, épaisseur 5 mm, poids 1,2 kg. Il convient au salon, à la chambre et à l'entrée. Lavage à la main à l'eau froide, séchage à plat. De légères variations de couleur sont normales pour une pièce imprimée à la main et rendent chaque tapis unique. Expédition depuis l'Inde, délai de préparation de 3 à 5 jours ouvrés.",
  },
  de: {
    title: "Baumwollteppich handgemacht mit floralem Blockdruck beige indigo 90x150 cm",
    primaryKeyword: "Baumwollteppich",
    tags: [
      "baumwollteppich",
      "teppich handgemacht",
      "blockdruck teppich",
      "floraler teppich",
      "teppich 90x150",
      "beige indigo",
      "wohnzimmerteppich",
      "schlafzimmer teppich",
      "flachgewebe teppich",
      "baumwolle natur",
      "teppich indien",
      "boho teppich",
      "wohnaccessoire",
    ],
    description:
      "Dieser Baumwollteppich wird in Indien von Hand gefertigt und im Blockdruckverfahren mit einem floralen Muster in natürlichem Beige und Indigo bedruckt. Die flache Webart ist weich, leicht und lässt sich zum Verstauen einfach zusammenfalten. Erhältlich in 60x90 cm und 90x150 cm, Dicke 5 mm, Gewicht 1,2 kg. Geeignet für Wohnzimmer, Schlafzimmer und Flur. Von Hand in kaltem Wasser waschen und liegend trocknen. Leichte Farbabweichungen sind bei Handarbeit üblich und machen jedes Stück einzigartig. Versand aus Indien, Bearbeitungszeit 3-5 Werktage.",
  },
  it: {
    title: "Tappeto in cotone fatto a mano stampa floreale beige indaco 90x150 cm",
    primaryKeyword: "tappeto in cotone",
    tags: [
      "tappeto in cotone",
      "tappeto fatto a mano",
      "tappeto soggiorno",
      "tappeto camera",
      "tappeto 90x150",
      "stampa floreale",
      "tappeto beige",
      "tappeto indaco",
      "tappeto bohème",
      "tappeto piatto",
      "cotone indiano",
      "tappeto decorativo",
      "tappeto morbido",
    ],
    description:
      "Questo tappeto in cotone è realizzato a mano in India e stampato a mano con un motivo floreale in beige naturale e indaco. La tessitura piatta è morbida, leggera e facile da piegare per riporla. Disponibile in 60x90 cm e 90x150 cm, spessore 5 mm, peso 1,2 kg. Adatto a soggiorno, camera da letto e ingresso. Lavare a mano in acqua fredda e asciugare in piano. Lievi differenze di colore sono normali in un prodotto stampato a mano e rendono ogni tappeto unico. Spedizione dall'India, tempi di preparazione 3-5 giorni lavorativi.",
  },
  ja: {
    title: "手作りコットンラグ フローラル柄 ベージュ 藍色 90×150cm 薄手 平織り",
    primaryKeyword: "コットンラグ",
    tags: [
      "コットンラグ",
      "手作りラグ",
      "フローラル柄",
      "ベージュラグ",
      "藍色ラグ",
      "リビングラグ",
      "寝室ラグ",
      "ラグ 90×150",
      "インド製ラグ",
      "薄手ラグ",
      "平織りラグ",
      "ナチュラル雑貨",
      "ボヘミアン柄",
    ],
    description:
      "このコットンラグはインドで手作業により作られ、ベージュと藍色のフローラル柄がブロックプリントで施されています。平織りなので柔らかく、軽く、折りたたんで収納しやすいのが特徴です。60×90cmと90×150cmの2サイズ、厚さ5mm、重さ1.2kg。リビング、寝室、玄関に適しています。冷水で手洗いし、平らに干してください。手作業の商品のため多少の色の違いがありますが、それも一点ものの魅力です。インドから発送、発送準備は3〜5営業日です。滑りやすい床では滑り止めマットの併用をおすすめします。天然素材の風合いを楽しめる、毎日使いやすい一枚です。ギフトや新生活のインテリアにも合わせやすいデザインです。畳の上やフローリングの上に敷いて、気軽に模様替えを楽しめます。",
  },
  pl: {
    title: "Bawełniany dywan ręcznie robiony z kwiatowym nadrukiem beżowy indygo 90x150 cm",
    primaryKeyword: "bawełniany dywan",
    tags: [
      "bawełniany dywan",
      "dywan ręczny",
      "nadruk kwiatowy",
      "dywan do salonu",
      "dywan do sypialni",
      "dywan 90x150",
      "dywan beżowy",
      "dywan indygo",
      "dywan boho",
      "dywan płaski",
      "bawełna z indii",
      "dywan dekoracyjny",
      "dywan naturalny",
    ],
    description:
      "Ten bawełniany dywan powstaje ręcznie w Indiach i jest zdobiony kwiatowym nadrukiem block print w kolorze naturalnego beżu i indygo. Płaski splot jest miękki, lekki i łatwy do złożenia podczas przechowywania. Dostępny w rozmiarach 60x90 cm oraz 90x150 cm, grubość 5 mm, waga 1,2 kg. Pasuje do salonu, sypialni i przedpokoju. Prać ręcznie w zimnej wodzie i suszyć na płasko. Niewielkie różnice kolorów są naturalne przy ręcznym druku i czynią każdy dywan wyjątkowym. Wysyłka z Indii, czas przygotowania 3-5 dni roboczych.",
  },
  pt: {
    title: "Tapete de algodão feito à mão com estampado floral bege e índigo 90x150 cm",
    primaryKeyword: "tapete de algodão",
    tags: [
      "tapete de algodão",
      "tapete feito à mão",
      "tapete sala",
      "tapete quarto",
      "tapete 90x150",
      "estampado floral",
      "tapete bege",
      "tapete índigo",
      "tapete boho",
      "tapete plano",
      "algodão da índia",
      "tapete decorativo",
      "tapete suave",
    ],
    description:
      "Este tapete de algodão é feito à mão na Índia e estampado com um motivo floral em bege natural e índigo. A trama plana é macia, leve e fácil de dobrar para guardar. Disponível em 60x90 cm e 90x150 cm, com 5 mm de espessura e 1,2 kg. Adequado para sala, quarto e entrada. Lavar à mão em água fria e secar na horizontal. Pequenas diferenças de cor são naturais num produto estampado à mão e tornam cada tapete único. Envio da Índia, prazo de preparação de 3 a 5 dias úteis.",
  },
  ru: {
    title: "Хлопковый ковер ручной работы с цветочным принтом бежевый индиго 90x150 см",
    primaryKeyword: "хлопковый ковер",
    tags: [
      "хлопковый ковер",
      "ковер ручной работы",
      "цветочный принт",
      "ковер в гостиную",
      "ковер в спальню",
      "ковер 90x150",
      "бежевый ковер",
      "ковер индиго",
      "ковер бохо",
      "плоский ковер",
      "хлопок индия",
      "декоративный ковер",
      "мягкий ковер",
    ],
    description:
      "Этот хлопковый ковер изготовлен вручную в Индии и украшен цветочным принтом в оттенках натурального бежевого и индиго. Плоское плетение мягкое, легкое и легко складывается для хранения. Доступны размеры 60x90 см и 90x150 см, толщина 5 мм, вес 1,2 кг. Подходит для гостиной, спальни и прихожей. Стирать вручную в холодной воде и сушить в расправленном виде. Небольшие различия в оттенке естественны при ручной печати и делают каждый ковер уникальным. Отправка из Индии, срок подготовки 3-5 рабочих дней.",
  },
  es: {
    title: "Alfombra de algodón hecha a mano con estampado floral beige e índigo 90x150 cm",
    primaryKeyword: "alfombra de algodón",
    tags: [
      "alfombra de algodón",
      "alfombra artesanal",
      "alfombra salón",
      "alfombra dormitorio",
      "alfombra 90x150",
      "estampado floral",
      "alfombra beige",
      "alfombra índigo",
      "alfombra boho",
      "alfombra plana",
      "algodón de la india",
      "alfombra decorativa",
      "alfombra suave",
    ],
    description:
      "Esta alfombra de algodón está fabricada a mano en la India y estampada con un motivo floral en beige natural e índigo. El tejido plano es suave, ligero y fácil de doblar para guardarla. Disponible en 60x90 cm y 90x150 cm, con 5 mm de grosor y 1,2 kg de peso. Adecuada para el salón, el dormitorio y la entrada. Lavar a mano en agua fría y secar en horizontal. Las pequeñas variaciones de color son normales en un producto estampado a mano y hacen que cada alfombra sea única. Envío desde la India, plazo de preparación de 3 a 5 días laborables.",
  },
  sv: {
    title: "Handgjord bomullsmatta med blommigt tryck beige indigo 90x150 cm",
    primaryKeyword: "bomullsmatta",
    tags: [
      "bomullsmatta",
      "handgjord matta",
      "blommigt tryck",
      "matta vardagsrum",
      "matta sovrum",
      "matta 90x150",
      "beige matta",
      "indigo matta",
      "boho matta",
      "platt matta",
      "bomull från indien",
      "dekorativ matta",
      "mjuk matta",
    ],
    description:
      "Den här bomullsmattan är handgjord i Indien och tryckt med ett blommigt mönster i naturligt beige och indigo. Den platta vävningen är mjuk, lätt och enkel att vika ihop för förvaring. Finns i 60x90 cm och 90x150 cm, tjocklek 5 mm och vikt 1,2 kg. Passar i vardagsrum, sovrum och hall. Tvätta för hand i kallt vatten och torka liggande. Små färgvariationer är naturliga för en handtryckt produkt och gör varje matta unik. Leverans från Indien, beredskapstid 3-5 arbetsdagar.",
  },
};

/**
 * The short headings and bullet block the prompt requires (rule 6). Kept apart
 * from the prose so the fixture body stays readable.
 */
const SECTIONS: Record<string, { intro: string; specs: string[] }> = {
  nl: { intro: "Over dit katoenen vloerkleed:", specs: ["Eigenschappen:", "- Maat: 60x90 cm en 90x150 cm", "- Dikte: 5 mm", "- Gewicht: 1,2 kg", "- Materiaal: 100% katoen"] },
  fr: { intro: "À propos de ce tapis en coton :", specs: ["Caractéristiques :", "- Dimensions : 60x90 cm et 90x150 cm", "- Épaisseur : 5 mm", "- Poids : 1,2 kg", "- Matière : 100% coton"] },
  de: { intro: "Über diesen Baumwollteppich:", specs: ["Eigenschaften:", "- Größe: 60x90 cm und 90x150 cm", "- Dicke: 5 mm", "- Gewicht: 1,2 kg", "- Material: 100% Baumwolle"] },
  it: { intro: "Informazioni su questo tappeto in cotone:", specs: ["Caratteristiche:", "- Misure: 60x90 cm e 90x150 cm", "- Spessore: 5 mm", "- Peso: 1,2 kg", "- Materiale: 100% cotone"] },
  ja: { intro: "このコットンラグについて:", specs: ["仕様:", "- サイズ: 60×90cm、90×150cm", "- 厚さ: 5mm", "- 重さ: 1.2kg", "- 素材: コットン100%"] },
  pl: { intro: "O tym bawełnianym dywanie:", specs: ["Parametry:", "- Rozmiar: 60x90 cm i 90x150 cm", "- Grubość: 5 mm", "- Waga: 1,2 kg", "- Materiał: 100% bawełna"] },
  pt: { intro: "Sobre este tapete de algodão:", specs: ["Características:", "- Tamanho: 60x90 cm e 90x150 cm", "- Espessura: 5 mm", "- Peso: 1,2 kg", "- Material: 100% algodão"] },
  ru: { intro: "Об этом хлопковом ковре:", specs: ["Характеристики:", "- Размер: 60x90 см и 90x150 см", "- Толщина: 5 мм", "- Вес: 1,2 кг", "- Материал: 100% хлопок"] },
  es: { intro: "Sobre esta alfombra de algodón:", specs: ["Características:", "- Medidas: 60x90 cm y 90x150 cm", "- Grosor: 5 mm", "- Peso: 1,2 kg", "- Material: 100% algodón"] },
  sv: { intro: "Om den här bomullsmattan:", specs: ["Egenskaper:", "- Storlek: 60x90 cm och 90x150 cm", "- Tjocklek: 5 mm", "- Vikt: 1,2 kg", "- Material: 100% bomull"] },
};

function composedDescription(languageCode: string): string {
  const fixture = FIXTURES[languageCode];
  const sections = SECTIONS[languageCode];
  return [sections.intro, fixture.description, "", sections.specs.join("\n")].join("\n");
}

/** A stub provider that answers with the fixture for the requested market. */
class StubProvider implements AIProvider {
  calls: StructuredRequest[] = [];
  constructor(
    readonly name: "gemini" | "openrouter",
    private readonly reply: (request: StructuredRequest) => ProviderResponse,
    private readonly configured = true,
    private readonly modelId = "stub-model-1"
  ) {}

  isConfigured() {
    return this.configured;
  }

  models() {
    return [this.modelId];
  }

  async generateStructured(request: StructuredRequest): Promise<ProviderResponse> {
    this.calls.push(request);
    return this.reply(request);
  }

  async checkHealth(): Promise<ProviderHealth> {
    return { ok: this.configured, provider: this.name, model: this.modelId };
  }
}

function fixtureReply(languageCode: string, provider: "gemini" | "openrouter") {
  const fixture = FIXTURES[languageCode];
  // Models wrap JSON in fences and add chatter — exactly what the parser must survive.
  const body = {
    title: fixture.title,
    description: composedDescription(languageCode),
    tags: fixture.tags,
    primary_keyword: fixture.primaryKeyword,
    secondary_keywords: fixture.tags.slice(1, 4),
    alt_texts: [],
    search_volume: 12000,
  };
  return () =>
    ({
      provider,
      model: provider === "gemini" ? "stub-model-1" : "stub-backup-1",
      text: "Here is the listing:\n```json\n" + JSON.stringify(body) + "\n```",
      usage: { inputTokens: 900, outputTokens: 400 },
      latencyMs: 12,
    }) as ProviderResponse;
}

/** The exact sequence the generate route performs for one market. */
async function generateMarket(languageCode: string, providers?: { gemini: AIProvider; openrouter: AIProvider }, logs: AttemptLog[] = []) {
  const language = etsyLanguage(languageCode);
  assert.ok(language, `unknown language ${languageCode}`);
  const manager = new AIProviderManager(providers ?? { gemini: new StubProvider("gemini", fixtureReply(languageCode, "gemini")), openrouter: new StubProvider("openrouter", () => { throw new Error("backup must not be used"); }, false) });

  const result = await manager.generateStructured({
    operation: "listing",
    system: listingSystemPrompt(),
    prompt: listingUserPrompt({
      language,
      facts: FACTS,
      englishTitle: "Handmade Cotton Rug, Block Print Floral, Natural Beige with Indigo",
      englishDescription: "Handmade cotton rug block printed in India.",
      imageCount: 0,
      field: "all",
    }),
    temperature: 0.6,
    config: { backupEnabled: true },
    parse: (text) => parseListingOutput(text, { field: "all", imageCount: 0 }),
    onAttempt: (log) => {
      logs.push(log);
    },
  });

  const report = validateListing({
    languageCode: language.code,
    locale: language.locale,
    title: result.data.title,
    description: result.data.description,
    tags: result.data.tags,
    altTexts: [],
    imageCount: 0,
    keywords: { primary: result.data.primaryKeyword, secondary: result.data.secondaryKeywords },
    sourceTitle: "Handmade Cotton Rug, Block Print Floral, Natural Beige with Indigo",
  });

  return { result, report, language };
}

test("all ten markets generate, parse, validate and export with their own script intact", async () => {
  const listings = [];

  for (const language of ETSY_LANGUAGES) {
    const { result, report } = await generateMarket(language.code);
    const fixture = FIXTURES[language.code];

    // The parser kept the localized text exactly as the model wrote it.
    assert.equal(result.data.title, fixture.title, `${language.code}: title changed in parsing`);
    assert.equal(result.data.tags.length, REQUIRED_TAG_COUNT, `${language.code}: tag count`);
    assert.ok(charCount(result.data.title) <= TITLE_MAX_CHARS, `${language.code}: title too long`);
    for (const tag of result.data.tags) {
      assert.ok(charCount(tag) <= TAG_MAX_CHARS, `${language.code}: tag "${tag}" is ${charCount(tag)} chars`);
    }
    // Manually added model-only metric is not carried into the listing contract.
    assert.equal((result.data as unknown as Record<string, unknown>).search_volume, undefined);

    // The deterministic validator, not the model, decides status and score.
    assert.equal(report.maxScore, 100);
    assert.ok(report.score >= 0 && report.score <= 100, `${language.code}: score out of range`);
    assert.deepEqual(report.errors, [], `${language.code}: unexpected errors`);
    // Before alt text exists the only thing outstanding is the image warning.
    assert.equal(report.status, "warning", `${language.code}: expected warning (no images yet), got ${report.status} — ${report.warnings.join(" | ")}`);
    assert.ok(report.warnings.some((w) => /Alt text/i.test(w)), `${language.code}: expected the missing-alt-text warning`);

    // With alt text for every image the same listing is a clean pass.
    const complete = validateListing({
      languageCode: language.code,
      locale: language.locale,
      title: result.data.title,
      description: result.data.description,
      tags: result.data.tags,
      altTexts: [
        { image: 1, text: fixture.description.slice(0, 200) },
        { image: 2, text: fixture.title },
      ],
      imageCount: 2,
      keywords: { primary: result.data.primaryKeyword, secondary: result.data.secondaryKeywords },
      sourceTitle: "Handmade Cotton Rug, Block Print Floral, Natural Beige with Indigo",
    });
    assert.equal(complete.status, "pass", `${language.code}: expected pass, got ${complete.status} — ${complete.errors.join(" | ")} ${complete.warnings.join(" | ")}`);
    assert.ok(complete.score >= 85, `${language.code}: pass should score well, got ${complete.score}`);

    listings.push({
      country: language.country,
      language: language.name,
      languageCode: language.code,
      locale: language.locale,
      title: result.data.title,
      description: result.data.description,
      tags: result.data.tags,
      altTexts: [],
      seoScore: complete.score,
      validationStatus: complete.status,
      validationReport: complete,
      provider: result.provider,
      model: result.model,
      backupUsed: result.backupUsed,
    });
  }

  assert.equal(listings.length, 10);

  // --- Exports: UTF-8 must survive Japanese and Russian round trips. ---
  const project = {
    id: "00000000-0000-0000-0000-000000000001",
    projectName: "Handmade Cotton Rug",
    sku: "NY-RUG-001",
    category: "Home & Living > Rugs",
    originalTitle: "Handmade Cotton Rug",
    originalDescription: "Hand block printed cotton rug.",
    originalTags: "cotton rug, block print rug",
  };
  const keywords = [
    {
      keyword: FIXTURES.ja.primaryKeyword,
      languageCode: "ja",
      country: "Japan",
      keywordType: "primary",
      source: "ai_suggested",
      verified: false,
      searchVolume: null,
      competition: null,
      confidence: "low",
      sourceUrl: null,
      researchedAt: new Date().toISOString(),
    },
  ];

  const csv = buildListingsCsv(listings);
  assert.ok(csv.startsWith("\ufeff"), "CSV must keep its UTF-8 BOM for Excel");
  for (const language of ETSY_LANGUAGES) {
    const title = FIXTURES[language.code].title;
    assert.ok(csv.includes(title), `${language.code}: title missing from the CSV`);
  }

  const json = buildProjectJson({ project, listings, keywords, competitors: [] });
  const roundTripped = JSON.parse(JSON.stringify(json));
  const jaTitle = (roundTripped.localizations as Array<{ title: { text: string } }>)[4].title.text;
  assert.equal(jaTitle, FIXTURES.ja.title);
  const ruTitle = (roundTripped.localizations as Array<{ title: { text: string } }>)[7].title.text;
  assert.equal(ruTitle, FIXTURES.ru.title);
  assert.equal((roundTripped.research as { verified_keywords: number }).verified_keywords, 0);
  assert.equal((roundTripped.research as { ai_suggested_keywords: number }).ai_suggested_keywords, 1);
  assert.equal((roundTripped.research as { keywords: Array<{ data_status?: string }> }).keywords.length, 1);

  const workbook = buildWorkbook({ project, listings, keywords, competitors: [] });
  assert.ok(Buffer.isBuffer(workbook) && workbook.byteLength > 5000, "XLSX buffer looks empty");
  assert.equal(workbook.subarray(0, 2).toString("utf8"), "PK", "XLSX must be a zip container");
});

test("backup provider answers when Gemini is rate limited, and the result is flagged as backup", async () => {
  const logs: AttemptLog[] = [];
  const gemini = new StubProvider("gemini", () => {
    throw new ProviderError("429 RESOURCE_EXHAUSTED", { provider: "gemini", model: "stub-model-1", retryable: true, status: 429, kind: "rate_limit" });
  });
  const openrouter = new StubProvider("openrouter", fixtureReply("de", "openrouter"), true, "stub-backup-1");

  const { result } = await generateMarket("de", { gemini, openrouter }, logs);

  assert.equal(result.provider, "openrouter");
  assert.equal(result.backupUsed, true);
  assert.equal(result.model, "stub-backup-1");
  assert.ok(logs.some((l) => l.provider === "gemini" && l.status === "error" && !l.backupUsed));
  assert.ok(logs.some((l) => l.provider === "openrouter" && l.status === "success" && l.backupUsed));
});

test("an over-long tag is sent back as a repair request, never silently shipped", async () => {
  const fixture = FIXTURES.fr;
  let call = 0;
  const gemini = new StubProvider("gemini", () => {
    call += 1;
    const tags = call === 1 ? [...fixture.tags.slice(0, 12), "tapis en coton fait main"] : fixture.tags; // 26 chars
    return {
      provider: "gemini",
      model: "stub-model-1",
      text: JSON.stringify({ title: fixture.title, description: fixture.description, tags, primary_keyword: fixture.primaryKeyword, secondary_keywords: [], alt_texts: [] }),
      usage: { inputTokens: 900, outputTokens: 400 },
      latencyMs: 9,
    };
  });

  const { result } = await generateMarket("fr", { gemini, openrouter: new StubProvider("openrouter", () => { throw new Error("backup must not be used"); }, false) });

  assert.equal(call, 2, "the model must be asked again with the validation issues");
  assert.match(gemini.calls[1].prompt, /failed validation/);
  assert.match(gemini.calls[1].prompt, /20 characters/);
  assert.equal(result.data.tags.length, REQUIRED_TAG_COUNT);
  assert.ok(result.data.tags.every((t) => charCount(t) <= TAG_MAX_CHARS));
});

test("when every provider fails the pipeline throws — no listing is reported as generated", async () => {
  const gemini = new StubProvider("gemini", () => {
    throw new ProviderError("503 UNAVAILABLE", { provider: "gemini", model: "stub-model-1", retryable: true, status: 503, kind: "unavailable" });
  });
  const openrouter = new StubProvider("openrouter", () => {
    throw new ProviderError("timeout", { provider: "openrouter", model: "stub-backup-1", retryable: true, kind: "timeout" });
  });

  await assert.rejects(
    () => generateMarket("ja", { gemini, openrouter }),
    (error: unknown) => error instanceof ProviderError && /Every AI provider failed/.test(error.message)
  );
});

test("a reply that is not a listing at all fails validation instead of producing empty fields", async () => {
  const gemini = new StubProvider("gemini", () => ({
    provider: "gemini",
    model: "stub-model-1",
    text: "Sorry, I cannot help with that request.",
    usage: null,
    latencyMs: 5,
  }));

  await assert.rejects(
    () => generateMarket("nl", { gemini, openrouter: new StubProvider("openrouter", () => { throw new Error("no backup"); }, false) }),
    (error: unknown) => error instanceof ProviderError && /not a JSON object|did not pass validation/.test(error.message)
  );
});
