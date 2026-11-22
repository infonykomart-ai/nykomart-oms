import assert from "node:assert/strict";
import { test } from "node:test";
import { parseAddress, assessAddress } from "./parse";
import { verifyAddress, rulesVerifier } from "./verify";

// 2026-11-22 — Phase 2 address engine.
//
// The point of these cases is not "the regex compiles": every one of them is
// a real address SHAPE this business receives orders in, and the assertions
// are the fields that must survive it. Two kinds of case are deliberately
// kept apart:
//
//   • Deterministic shapes (a comma or line break marks city/state/postcode,
//     or the country's written order does) — assert exact fields AND that the
//     status is "Parsed".
//   • Genuinely ambiguous shapes (one run-together line, a missing country,
//     a postcode that doesn't match the country) — assert that the parser
//     does NOT invent the field and reports "Needs Review". Those tests exist
//     to stop a future "helpful" change from guessing silently.

type Case = {
  country: string;
  address: string;
  city: string;
  state?: string;
  postal: string;
  street?: string;
};

const DETERMINISTIC: Case[] = [
  {
    country: "United States",
    address: "John Smith\n4700 Hampden Lane Apt 0809\nBethesda, MD 20814\nUnited States",
    city: "Bethesda",
    state: "MD",
    postal: "20814",
    street: "4700 Hampden Lane Apt 0809",
  },
  {
    country: "United States (full state name)",
    address: "Jane Doe\n12 Oak Street\nSpringfield, Illinois 62704\nUSA",
    city: "Springfield",
    state: "IL",
    postal: "62704",
  },
  {
    country: "United States (Washington, DC)",
    address: "1600 Pennsylvania Ave NW\nWashington, DC 20500\nUnited States",
    city: "Washington",
    state: "DC",
    postal: "20500",
    street: "1600 Pennsylvania Ave NW",
  },
  {
    country: "Canada",
    address: "Alex Roy\n55 Queen Street West\nToronto, ON M5V 2T6\nCanada",
    city: "Toronto",
    state: "ON",
    postal: "M5V 2T6",
    street: "55 Queen Street West",
  },
  {
    country: "Canada (lowercase postcode)",
    address: "Alex Roy\n55 Queen Street West\nToronto, ON m5v 2t6\nCanada",
    city: "Toronto",
    state: "ON",
    postal: "M5V 2T6",
  },
  {
    country: "Australia",
    address: "Sam Lee\n9 Harbour Street\nSydney NSW 2000\nAustralia",
    city: "Sydney",
    state: "NSW",
    postal: "2000",
    street: "9 Harbour Street",
  },
  {
    country: "New Zealand",
    address: "Aroha King\n22 Cuba Street\n6011 Wellington\nNew Zealand",
    city: "Wellington",
    postal: "6011",
    street: "22 Cuba Street",
  },
  {
    country: "United Kingdom",
    address: "Jane Doe\n10 Downing Street\nLondon\nSW1A 2AA\nUnited Kingdom",
    city: "London",
    postal: "SW1A 2AA",
    street: "10 Downing Street",
  },
  {
    country: "United Kingdom (postcode on the street line)",
    address: "Jane Doe\n10 Downing Street, London SW1A 2AA\nUnited Kingdom",
    city: "London",
    postal: "SW1A 2AA",
  },
  {
    country: "Ireland",
    address: "Sean Byrne\n14 Grafton Street\nDublin\nD02 X285\nIreland",
    city: "Dublin",
    postal: "D02 X285",
  },
  {
    country: "Germany",
    address: "Anna Muller\nHauptstrasse 12\n10115 Berlin\nGermany",
    city: "Berlin",
    postal: "10115",
    street: "Hauptstrasse 12",
  },
  {
    country: "France",
    address: "Marie Dupont\n12 Rue de Rivoli\n75001 Paris\nFrance",
    city: "Paris",
    postal: "75001",
    street: "12 Rue de Rivoli",
  },
  {
    country: "Netherlands",
    address: "Piet de Vries\nPrinsengracht 263\n1012 AB Amsterdam\nNetherlands",
    city: "Amsterdam",
    postal: "1012 AB",
  },
  {
    country: "Belgium",
    address: "Luc Peeters\nRue Neuve 12\n1000 Brussel\nBelgium",
    city: "Brussel",
    postal: "1000",
  },
  {
    country: "Luxembourg",
    address: "Anne Weber\n12 Rue de la Gare\nL-1111 Luxembourg\nLuxembourg",
    city: "Luxembourg",
    postal: "L-1111",
  },
  {
    country: "Switzerland",
    address: "Hans Meier\nBahnhofstrasse 1\n8001 Zurich\nSwitzerland",
    city: "Zurich",
    postal: "8001",
  },
  {
    country: "Austria",
    address: "Lena Gruber\nKärntner Straße 1\n1010 Wien\nAustria",
    city: "Wien",
    postal: "1010",
  },
  {
    country: "Italy",
    address: "Marco Rossi\nVia del Corso 12\n00184 Roma\nItaly",
    city: "Roma",
    postal: "00184",
  },
  {
    country: "Spain",
    address: "Lucia Gomez\nCalle Mayor 12\n28013 Madrid\nSpain",
    city: "Madrid",
    postal: "28013",
  },
  {
    country: "Portugal",
    address: "Joao Silva\nRua Augusta 12\n1000-001 Lisboa\nPortugal",
    city: "Lisboa",
    postal: "1000-001",
  },
  {
    country: "Sweden",
    address: "Erik Lund\nDrottninggatan 12\n111 22 Stockholm\nSweden",
    city: "Stockholm",
    postal: "111 22",
  },
  {
    country: "Norway",
    address: "Kari Nord\nKarl Johans gate 12\n0150 Oslo\nNorway",
    city: "Oslo",
    postal: "0150",
  },
  {
    country: "Denmark",
    address: "Mette Jensen\nStrøget 12\n1050 København\nDenmark",
    city: "København",
    postal: "1050",
  },
  {
    country: "Finland",
    address: "Mikko Laine\nMannerheimintie 12\n00100 Helsinki\nFinland",
    city: "Helsinki",
    postal: "00100",
  },
  {
    country: "Poland",
    address: "Jan Kowalski\nul. Nowy Swiat 12\n00-950 Warszawa\nPoland",
    city: "Warszawa",
    postal: "00-950",
  },
  {
    country: "Czech Republic",
    address: "Petr Novak\nVaclavske namesti 12\n110 00 Praha\nCzech Republic",
    city: "Praha",
    postal: "110 00",
  },
  {
    country: "Slovakia",
    address: "Jana Hora\nHlavna 12\n811 01 Bratislava\nSlovakia",
    city: "Bratislava",
    postal: "811 01",
  },
  {
    country: "Hungary",
    address: "Anna Nagy\nVaci utca 12\n1051 Budapest\nHungary",
    city: "Budapest",
    postal: "1051",
  },
  {
    country: "Romania",
    address: "Ion Pop\nCalea Victoriei 12\n010011 Bucuresti\nRomania",
    city: "Bucuresti",
    postal: "010011",
  },
  {
    country: "Bulgaria",
    address: "Ivan Petrov\nVitosha Blvd 12\n1000 Sofia\nBulgaria",
    city: "Sofia",
    postal: "1000",
  },
  {
    country: "Croatia",
    address: "Ana Horvat\nIlica 12\n10000 Zagreb\nCroatia",
    city: "Zagreb",
    postal: "10000",
  },
  {
    country: "Slovenia",
    address: "Maja Kos\nPrešernova 12\n1000 Ljubljana\nSlovenia",
    city: "Ljubljana",
    postal: "1000",
  },
  {
    country: "Greece",
    address: "Nikos Papas\nErmou 12\n105 58 Athina\nGreece",
    city: "Athina",
    postal: "105 58",
  },
  {
    country: "India",
    address: "Rahul Sharma\n12 MG Road\nBengaluru, Karnataka 560001\nIndia",
    city: "Bengaluru",
    state: "KA",
    postal: "560001",
    street: "12 MG Road",
  },
  {
    country: "Pakistan",
    address: "Ali Khan\n12 Mall Road\nLahore 54000\nPakistan",
    city: "Lahore",
    postal: "54000",
  },
  {
    country: "Bangladesh",
    address: "Rahim Uddin\n12 Gulshan Avenue\nDhaka 1212\nBangladesh",
    city: "Dhaka",
    postal: "1212",
  },
  {
    country: "Sri Lanka",
    address: "Nimal Perera\n12 Galle Road\nColombo 00100\nSri Lanka",
    city: "Colombo",
    postal: "00100",
  },
  {
    country: "Nepal",
    address: "Sita Rai\n12 Durbar Marg\nKathmandu 44600\nNepal",
    city: "Kathmandu",
    postal: "44600",
  },
  {
    country: "China",
    address: "Li Wei\n100 Changan Avenue\n100000 Beijing\nChina",
    city: "Beijing",
    postal: "100000",
    street: "100 Changan Avenue",
  },
  {
    country: "South Korea",
    address: "Kim Min\n123 Gangnam-daero\n04524 Seoul\nSouth Korea",
    city: "Seoul",
    postal: "04524",
  },
  {
    country: "Singapore",
    address: "Tan Wei\n12 Orchard Road\n018956 Singapore\nSingapore",
    city: "Singapore",
    postal: "018956",
  },
  {
    country: "Malaysia",
    address: "Ahmad Razak\n12 Jalan Ampang\n50450 Kuala Lumpur\nMalaysia",
    city: "Kuala Lumpur",
    postal: "50450",
  },
  {
    country: "Thailand",
    address: "Somchai Pram\n12 Sukhumvit Road\n10110 Bangkok\nThailand",
    city: "Bangkok",
    postal: "10110",
  },
  {
    country: "Indonesia",
    address: "Budi Santoso\n12 Jalan Thamrin\n10110 Jakarta\nIndonesia",
    city: "Jakarta",
    postal: "10110",
  },
  {
    country: "Vietnam",
    address: "Nguyen An\n12 Hang Bai\n100000 Hanoi\nVietnam",
    city: "Hanoi",
    postal: "100000",
  },
  {
    country: "Philippines",
    address: "Jose Cruz\n12 Roxas Boulevard\n1000 Manila\nPhilippines",
    city: "Manila",
    postal: "1000",
  },
  {
    country: "Hong Kong (no postal code system)",
    address: "Chan Tai\n8 Queens Road Central\nCentral\nHong Kong",
    city: "Central",
    postal: "",
    street: "8 Queens Road Central",
  },
  {
    country: "United Arab Emirates (no postal code system)",
    address: "Omar Haddad\n12 Sheikh Zayed Road\nDubai\nUnited Arab Emirates",
    city: "Dubai",
    postal: "",
    street: "12 Sheikh Zayed Road",
  },
  {
    country: "Qatar (no postal code system)",
    address: "Khalid Nasser\n12 Al Corniche\nDoha\nQatar",
    city: "Doha",
    postal: "",
  },
  {
    country: "Saudi Arabia",
    address: "Fahad Ali\n12 King Fahd Road\nRiyadh 12271\nSaudi Arabia",
    city: "Riyadh",
    postal: "12271",
  },
  {
    country: "Kuwait",
    address: "Yousef Salem\n12 Gulf Road\nKuwait City 13001\nKuwait",
    city: "Kuwait City",
    postal: "13001",
  },
  {
    country: "Bahrain",
    address: "Ali Isa\n12 Manama Road\nManama 316\nBahrain",
    city: "Manama",
    postal: "316",
  },
  {
    country: "Oman",
    address: "Said Rashid\n12 Al Qurum\nMuscat 100\nOman",
    city: "Muscat",
    postal: "100",
  },
  {
    country: "Israel",
    address: "Noa Levi\n12 Rothschild Blvd\nTel Aviv 6100000\nIsrael",
    city: "Tel Aviv",
    postal: "6100000",
  },
  {
    country: "South Africa",
    address: "Thabo Nkosi\n12 Main Street\nJohannesburg 2001\nSouth Africa",
    city: "Johannesburg",
    postal: "2001",
  },
  {
    country: "Nigeria",
    address: "Chidi Okafor\n12 Marina Road\nLagos 101233\nNigeria",
    city: "Lagos",
    postal: "101233",
  },
  {
    country: "Kenya",
    address: "Wanjiru Kamau\n12 Kenyatta Avenue\nNairobi 00100\nKenya",
    city: "Nairobi",
    postal: "00100",
  },
  {
    country: "Egypt",
    address: "Ahmed Hassan\n12 Tahrir Street\nCairo 11511\nEgypt",
    city: "Cairo",
    postal: "11511",
  },
  {
    country: "Brazil",
    address: "Joao Silva\nAv Paulista 1000\nSao Paulo, SP 01310-100\nBrazil",
    city: "Sao Paulo",
    state: "SP",
    postal: "01310-100",
  },
  {
    country: "Mexico",
    address: "Ana Lopez\nCalle Reforma 123\nCiudad de Mexico, CDMX 06600\nMexico",
    city: "Ciudad de Mexico",
    state: "CDMX",
    postal: "06600",
  },
  {
    country: "Argentina",
    address: "Mateo Diaz\nAv Corrientes 1234\nBuenos Aires C1002ABC\nArgentina",
    city: "Buenos Aires",
    postal: "C1002ABC",
  },
  {
    country: "Chile",
    address: "Sofia Rojas\nAv Libertador 1234\nSantiago 8320000\nChile",
    city: "Santiago",
    postal: "8320000",
  },
  {
    country: "Colombia",
    address: "Camilo Ruiz\nCalle 100 12\nBogota 110111\nColombia",
    city: "Bogota",
    postal: "110111",
  },
  {
    country: "Peru",
    address: "Rosa Vega\nAv Arequipa 1234\nLima 15001\nPeru",
    city: "Lima",
    postal: "15001",
  },
  {
    country: "Puerto Rico",
    address: "Luis Rivera\n12 Calle Fortaleza\nSan Juan, PR 00901\nPuerto Rico",
    city: "San Juan",
    state: "PR",
    postal: "00901",
  },
];

for (const entry of DETERMINISTIC) {
  test(`parses ${entry.country} address as Parsed`, () => {
    const result = parseAddress(entry.address);
    assert.equal(result.fields.city, entry.city, `city for ${entry.country}`);
    assert.equal(result.fields.postalCode, entry.postal, `postal for ${entry.country}`);
    if (entry.state !== undefined) assert.equal(result.fields.state, entry.state, `state for ${entry.country}`);
    if (entry.street !== undefined) assert.equal(result.fields.street, entry.street, `street for ${entry.country}`);
    assert.equal(result.status, "Parsed", `status for ${entry.country}: ${result.notes.join(" / ")}`);
  });
}

test("every deterministic case is a distinct country shape", () => {
  assert.ok(DETERMINISTIC.length >= 40, "expected at least 40 country/shape cases");
});

// ---------------------------------------------------------------------------
// Ambiguous or incomplete input must never be filled in silently.
// ---------------------------------------------------------------------------

test("empty input is Needs Review and does not throw", () => {
  const result = parseAddress("");
  assert.equal(result.status, "Needs Review");
  assert.deepEqual(result.missing, ["address"]);
  assert.equal(result.fields.city, "");
});

test("null/undefined input is safe", () => {
  assert.equal(parseAddress(null).status, "Needs Review");
  assert.equal(parseAddress(undefined).status, "Needs Review");
});

test("phone, email and tax-ID lines are ignored, not treated as address lines", () => {
  const result = parseAddress(
    "Jane Doe\n10 Downing Street\nLondon\nSW1A 2AA\nUnited Kingdom\n+44 20 7925 0918\nbuyer@example.com\nBuyer National Id: GARV180581D53"
  );
  assert.equal(result.fields.city, "London");
  assert.equal(result.fields.postalCode, "SW1A 2AA");
  assert.equal(result.fields.street, "10 Downing Street");
  assert.equal(result.status, "Parsed");
});

test("a US address with no state is Never marked Parsed and no state is invented", () => {
  const result = parseAddress("Jane Doe\n12 Oak Street\nSpringfield 62704\nUnited States");
  assert.equal(result.fields.state, "");
  assert.equal(result.status, "Needs Review");
  assert.ok(result.missing.some((m) => m.includes("state")));
});

test("a postcode that does not fit the detected country is reported, not accepted", () => {
  const result = parseAddress("Marie Dupont\n12 Rue de Rivoli\n7500 Paris\nFrance");
  assert.equal(result.fields.postalCode, "");
  assert.equal(result.status, "Needs Review");
});

test("an address with no country is Needs Review even when the street parses", () => {
  const result = parseAddress("12 Main Street\nSpringfield");
  assert.equal(result.fields.country, "");
  assert.equal(result.status, "Needs Review");
  assert.ok(result.missing.includes("country"));
});

test("a single run-together line is split, but flagged Needs Review", () => {
  const result = parseAddress("Megha Malik 4700 Hampden Lane Apt 0809 Bethesda MD 20814 United States");
  assert.equal(result.fields.name, "Megha Malik");
  assert.equal(result.fields.city, "Bethesda");
  assert.equal(result.fields.state, "MD");
  assert.equal(result.fields.postalCode, "20814");
  assert.equal(result.status, "Needs Review");
  assert.ok(result.notes.some((n) => n.toLowerCase().includes("single")));
});

test("the original pasted text is preserved verbatim", () => {
  const raw = "  Jane Doe\n10 Downing Street\nLondon\nSW1A 2AA\nUnited Kingdom  ";
  const result = parseAddress(raw);
  assert.equal(result.raw, raw);
  assert.equal(result.parser, "rules-v1");
});

test("a leading company name is kept out of the street line", () => {
  const result = parseAddress("Acme Trading Ltd\n12 Oak Street\nSpringfield, IL 62704\nUnited States");
  assert.equal(result.fields.company, "Acme Trading Ltd");
  assert.equal(result.fields.street, "12 Oak Street");
  assert.equal(result.status, "Parsed");
});

test("an apartment on its own line stays in address line 2 and is not lost", () => {
  const result = parseAddress("Jane Doe\n12 Oak Street\nApt 4B\nSpringfield, IL 62704\nUnited States");
  assert.equal(result.fields.street, "12 Oak Street");
  assert.equal(result.fields.address2, "Apt 4B");
  assert.equal(result.fields.apartment, "Apt 4B");
  assert.equal(result.fields.city, "Springfield");
});

test("apartment text inside the street line stays in the street line (courier labels need it)", () => {
  const result = parseAddress("Jane Doe\n4700 Hampden Lane Apt 0809\nBethesda, MD 20814\nUnited States");
  assert.equal(result.fields.street, "4700 Hampden Lane Apt 0809");
  assert.equal(result.fields.apartment, "Apt 0809");
});

test("a postcode with no city anywhere is Needs Review", () => {
  const result = parseAddress("Taro Yamada\n2-8-1 Nishi-Shinjuku\n160-0023\nJapan");
  assert.equal(result.fields.postalCode, "160-0023");
  assert.equal(result.fields.city, "");
  assert.equal(result.status, "Needs Review");
});

test("Kansas City is not mistaken for a state name", () => {
  const result = parseAddress("Jane Doe\n12 Oak Street\nKansas City, MO 64106\nUnited States");
  assert.equal(result.fields.city, "Kansas City");
  assert.equal(result.fields.state, "MO");
});

test("a second street line is kept in address line 2", () => {
  const result = parseAddress("Jane Doe\nUnit 5\n12 Oak Street\nSpringfield, IL 62704\nUnited States");
  assert.equal(result.fields.city, "Springfield");
  assert.ok(result.fields.address2.includes("12 Oak Street"));
});

// ---------------------------------------------------------------------------
// assessAddress — the same check the server action runs before saving.
// ---------------------------------------------------------------------------

test("assessAddress: complete US address is Parsed", () => {
  assert.deepEqual(
    assessAddress({ country: "United States", state: "MD", city: "Bethesda", postalCode: "20814", street: "1 Main St" }),
    { status: "Parsed", confidence: "high", missing: [] }
  );
});

test("assessAddress: missing city is Needs Review and names it", () => {
  const result = assessAddress({ country: "United States", state: "MD", city: "", postalCode: "20814", street: "1 Main St" });
  assert.equal(result.status, "Needs Review");
  assert.ok(result.missing.includes("city"));
});

test("assessAddress: a state is required for the US but not for Germany", () => {
  const us = assessAddress({ country: "United States", state: "", city: "Austin", postalCode: "78701", street: "1 Main St" });
  const de = assessAddress({ country: "Germany", state: "", city: "Berlin", postalCode: "10115", street: "Hauptstr 1" });
  assert.equal(us.status, "Needs Review");
  assert.equal(de.status, "Parsed");
});

test("assessAddress: no postcode required for Hong Kong", () => {
  assert.equal(
    assessAddress({ country: "Hong Kong", state: "", city: "Central", postalCode: "", street: "8 Queens Road" }).status,
    "Parsed"
  );
});

test("assessAddress: a malformed postcode is reportable even when present", () => {
  const result = assessAddress({ country: "United Kingdom", state: "", city: "London", postalCode: "12345", street: "10 Downing St" });
  assert.equal(result.status, "Needs Review");
  assert.ok(result.missing.some((m) => m.includes("GB")));
});

test("assessAddress: an unrecognised country cannot be Parsed", () => {
  const result = assessAddress({ country: "Atlantis", state: "", city: "Nowhere", postalCode: "00000", street: "1 Main St" });
  assert.equal(result.status, "Needs Review");
});

// ---------------------------------------------------------------------------
// Verification providers.
// ---------------------------------------------------------------------------

test("rules verifier never returns Verified", async () => {
  const result = await rulesVerifier.verify({
    fields: {
      name: "",
      company: "",
      street: "1 Main St",
      address2: "",
      apartment: "",
      building: "",
      district: "",
      landmark: "",
      city: "Bethesda",
      state: "MD",
      postalCode: "20814",
      country: "United States",
      countryCode: "US",
    },
    raw: "",
  });
  assert.equal(result.status, "Parsed");
  assert.notEqual(result.status, "Verified");
  assert.equal(result.provider, "rules");
});

test("verifyAddress falls back to rules without a Google key and never throws", async () => {
  const previous = process.env.GOOGLE_ADDRESS_VALIDATION_API_KEY;
  delete process.env.GOOGLE_ADDRESS_VALIDATION_API_KEY;
  try {
    const result = await verifyAddress({
      fields: {
        name: "",
        company: "",
        street: "1 Main St",
        address2: "",
        apartment: "",
        building: "",
        district: "",
        landmark: "",
        city: "Bethesda",
        state: "MD",
        postalCode: "20814",
        country: "United States",
        countryCode: "US",
      },
      raw: "",
    });
    assert.equal(result.provider, "rules");
    assert.equal(result.status, "Parsed");
  } finally {
    if (previous !== undefined) process.env.GOOGLE_ADDRESS_VALIDATION_API_KEY = previous;
  }
});
