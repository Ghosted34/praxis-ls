"use strict";
/**
 * Canonical ISO 4217 currency reference — the ONE definition of "what currencies
 * exist, what they are called, how they are written, and where they are used".
 *
 * WHY IT LIVES HERE. Same reason as countries.js: three consumers need the
 * identical list and cannot be allowed to drift —
 *   - the API's currency module (add-from-catalogue enriches the tenant row
 *     from here, so a currency's name/symbol/decimals cannot be typed wrong),
 *   - the currency 360 (numeric code, the countries that use it),
 *   - the client's Smart Currency Picker, which imports it directly so the full
 *     world list renders with no API round-trip and can be searched BY COUNTRY
 *     ("Holland" → EUR) as well as by currency.
 *
 * SHAPE. `{ code, name, symbol, decimals, numeric }`.
 *   - `code`     ISO 4217 alpha-3 (the currency table's primary key).
 *   - `symbol`   what an amount is prefixed/suffixed with; falls back to the code
 *                for currencies with no distinct glyph.
 *   - `decimals` ISO minor-unit count — 0 (XAF, JPY…), 2 (most), or 3 (Gulf
 *                dinars). Money is formatted to this, so getting it right matters:
 *                "1 000 XAF" has no cents, "1.000 BHD" has three.
 *   - `numeric`  ISO 4217 numeric code as a 3-char string (leading zeros kept).
 *
 * COVERAGE. Every currency that any country in countries.js trades in is present
 * here (checked: the 153 distinct codes that file references), so
 * `forCountry(cc)` always resolves and the picker's country search never dead-ends.
 *
 * ORDERING. `CATALOGUE` is sorted by the priority of the currency's most
 * representative country (via countries.sortOrder), so XAF/XOF/EUR/USD/NGN/CNY
 * and the main trade lanes lead — an operator in Douala is not scrolling past
 * Afghani to reach the CFA franc — then alphabetically by code.
 *
 * Named `exports.x =` assignments, NOT `module.exports = { x }` — the client is
 * bundled and cjs-module-lexer cannot see named exports through an object
 * literal. See index.js.
 */

const countries = require("./countries");

// Minor units that are NOT 2. Everything not listed here is 2 decimals.
const DECIMALS_0 = new Set([
  "BIF", "CLP", "DJF", "GNF", "ISK", "JPY", "KMF", "KRW", "PYG", "RWF",
  "UGX", "VND", "VUV", "XAF", "XOF", "XPF",
]);
const DECIMALS_3 = new Set(["BHD", "IQD", "JOD", "KWD", "LYD", "OMR", "TND"]);

// { code, name, symbol, numeric }. Decimals are derived from the sets above so
// the minor-unit rule lives in exactly one place. Alphabetical by code.
const RAW = [
  { code: "AED", name: "UAE Dirham", symbol: "د.إ", numeric: "784" },
  { code: "AFN", name: "Afghan Afghani", symbol: "؋", numeric: "971" },
  { code: "ALL", name: "Albanian Lek", symbol: "L", numeric: "008" },
  { code: "AMD", name: "Armenian Dram", symbol: "֏", numeric: "051" },
  { code: "ANG", name: "Netherlands Antillean Guilder", symbol: "ƒ", numeric: "532" },
  { code: "AOA", name: "Angolan Kwanza", symbol: "Kz", numeric: "973" },
  { code: "ARS", name: "Argentine Peso", symbol: "$", numeric: "032" },
  { code: "AUD", name: "Australian Dollar", symbol: "A$", numeric: "036" },
  { code: "AWG", name: "Aruban Florin", symbol: "ƒ", numeric: "533" },
  { code: "AZN", name: "Azerbaijani Manat", symbol: "₼", numeric: "944" },
  { code: "BAM", name: "Bosnia-Herzegovina Convertible Mark", symbol: "KM", numeric: "977" },
  { code: "BBD", name: "Barbadian Dollar", symbol: "$", numeric: "052" },
  { code: "BDT", name: "Bangladeshi Taka", symbol: "৳", numeric: "050" },
  { code: "BGN", name: "Bulgarian Lev", symbol: "лв", numeric: "975" },
  { code: "BHD", name: "Bahraini Dinar", symbol: ".د.ب", numeric: "048" },
  { code: "BIF", name: "Burundian Franc", symbol: "FBu", numeric: "108" },
  { code: "BMD", name: "Bermudian Dollar", symbol: "$", numeric: "060" },
  { code: "BND", name: "Brunei Dollar", symbol: "$", numeric: "096" },
  { code: "BOB", name: "Bolivian Boliviano", symbol: "Bs", numeric: "068" },
  { code: "BRL", name: "Brazilian Real", symbol: "R$", numeric: "986" },
  { code: "BSD", name: "Bahamian Dollar", symbol: "$", numeric: "044" },
  { code: "BTN", name: "Bhutanese Ngultrum", symbol: "Nu.", numeric: "064" },
  { code: "BWP", name: "Botswana Pula", symbol: "P", numeric: "072" },
  { code: "BYN", name: "Belarusian Ruble", symbol: "Br", numeric: "933" },
  { code: "BZD", name: "Belize Dollar", symbol: "BZ$", numeric: "084" },
  { code: "CAD", name: "Canadian Dollar", symbol: "C$", numeric: "124" },
  { code: "CDF", name: "Congolese Franc", symbol: "FC", numeric: "976" },
  { code: "CHF", name: "Swiss Franc", symbol: "CHF", numeric: "756" },
  { code: "CLP", name: "Chilean Peso", symbol: "$", numeric: "152" },
  { code: "CNY", name: "Chinese Yuan", symbol: "¥", numeric: "156" },
  { code: "COP", name: "Colombian Peso", symbol: "$", numeric: "170" },
  { code: "CRC", name: "Costa Rican Colón", symbol: "₡", numeric: "188" },
  { code: "CUP", name: "Cuban Peso", symbol: "$", numeric: "192" },
  { code: "CVE", name: "Cape Verdean Escudo", symbol: "$", numeric: "132" },
  { code: "CZK", name: "Czech Koruna", symbol: "Kč", numeric: "203" },
  { code: "DJF", name: "Djiboutian Franc", symbol: "Fdj", numeric: "262" },
  { code: "DKK", name: "Danish Krone", symbol: "kr", numeric: "208" },
  { code: "DOP", name: "Dominican Peso", symbol: "RD$", numeric: "214" },
  { code: "DZD", name: "Algerian Dinar", symbol: "دج", numeric: "012" },
  { code: "EGP", name: "Egyptian Pound", symbol: "£", numeric: "818" },
  { code: "ERN", name: "Eritrean Nakfa", symbol: "Nfk", numeric: "232" },
  { code: "ETB", name: "Ethiopian Birr", symbol: "Br", numeric: "230" },
  { code: "EUR", name: "Euro", symbol: "€", numeric: "978" },
  { code: "FJD", name: "Fijian Dollar", symbol: "$", numeric: "242" },
  { code: "FKP", name: "Falkland Islands Pound", symbol: "£", numeric: "238" },
  { code: "GBP", name: "British Pound", symbol: "£", numeric: "826" },
  { code: "GEL", name: "Georgian Lari", symbol: "₾", numeric: "981" },
  { code: "GHS", name: "Ghanaian Cedi", symbol: "₵", numeric: "936" },
  { code: "GIP", name: "Gibraltar Pound", symbol: "£", numeric: "292" },
  { code: "GMD", name: "Gambian Dalasi", symbol: "D", numeric: "270" },
  { code: "GNF", name: "Guinean Franc", symbol: "FG", numeric: "324" },
  { code: "GTQ", name: "Guatemalan Quetzal", symbol: "Q", numeric: "320" },
  { code: "GYD", name: "Guyanaese Dollar", symbol: "$", numeric: "328" },
  { code: "HKD", name: "Hong Kong Dollar", symbol: "HK$", numeric: "344" },
  { code: "HNL", name: "Honduran Lempira", symbol: "L", numeric: "340" },
  { code: "HTG", name: "Haitian Gourde", symbol: "G", numeric: "332" },
  { code: "HUF", name: "Hungarian Forint", symbol: "Ft", numeric: "348" },
  { code: "IDR", name: "Indonesian Rupiah", symbol: "Rp", numeric: "360" },
  { code: "ILS", name: "Israeli New Shekel", symbol: "₪", numeric: "376" },
  { code: "INR", name: "Indian Rupee", symbol: "₹", numeric: "356" },
  { code: "IQD", name: "Iraqi Dinar", symbol: "ع.د", numeric: "368" },
  { code: "IRR", name: "Iranian Rial", symbol: "﷼", numeric: "364" },
  { code: "ISK", name: "Icelandic Króna", symbol: "kr", numeric: "352" },
  { code: "JMD", name: "Jamaican Dollar", symbol: "J$", numeric: "388" },
  { code: "JOD", name: "Jordanian Dinar", symbol: "د.ا", numeric: "400" },
  { code: "JPY", name: "Japanese Yen", symbol: "¥", numeric: "392" },
  { code: "KES", name: "Kenyan Shilling", symbol: "KSh", numeric: "404" },
  { code: "KGS", name: "Kyrgystani Som", symbol: "лв", numeric: "417" },
  { code: "KHR", name: "Cambodian Riel", symbol: "៛", numeric: "116" },
  { code: "KMF", name: "Comorian Franc", symbol: "CF", numeric: "174" },
  { code: "KPW", name: "North Korean Won", symbol: "₩", numeric: "408" },
  { code: "KRW", name: "South Korean Won", symbol: "₩", numeric: "410" },
  { code: "KWD", name: "Kuwaiti Dinar", symbol: "د.ك", numeric: "414" },
  { code: "KYD", name: "Cayman Islands Dollar", symbol: "$", numeric: "136" },
  { code: "KZT", name: "Kazakhstani Tenge", symbol: "₸", numeric: "398" },
  { code: "LAK", name: "Laotian Kip", symbol: "₭", numeric: "418" },
  { code: "LBP", name: "Lebanese Pound", symbol: "ل.ل", numeric: "422" },
  { code: "LKR", name: "Sri Lankan Rupee", symbol: "Rs", numeric: "144" },
  { code: "LRD", name: "Liberian Dollar", symbol: "$", numeric: "430" },
  { code: "LSL", name: "Lesotho Loti", symbol: "L", numeric: "426" },
  { code: "LYD", name: "Libyan Dinar", symbol: "ل.د", numeric: "434" },
  { code: "MAD", name: "Moroccan Dirham", symbol: "د.م.", numeric: "504" },
  { code: "MDL", name: "Moldovan Leu", symbol: "L", numeric: "498" },
  { code: "MGA", name: "Malagasy Ariary", symbol: "Ar", numeric: "969" },
  { code: "MKD", name: "Macedonian Denar", symbol: "ден", numeric: "807" },
  { code: "MMK", name: "Myanmar Kyat", symbol: "K", numeric: "104" },
  { code: "MNT", name: "Mongolian Tugrik", symbol: "₮", numeric: "496" },
  { code: "MOP", name: "Macanese Pataca", symbol: "MOP$", numeric: "446" },
  { code: "MRU", name: "Mauritanian Ouguiya", symbol: "UM", numeric: "929" },
  { code: "MUR", name: "Mauritian Rupee", symbol: "₨", numeric: "480" },
  { code: "MVR", name: "Maldivian Rufiyaa", symbol: ".ރ", numeric: "462" },
  { code: "MWK", name: "Malawian Kwacha", symbol: "MK", numeric: "454" },
  { code: "MXN", name: "Mexican Peso", symbol: "$", numeric: "484" },
  { code: "MYR", name: "Malaysian Ringgit", symbol: "RM", numeric: "458" },
  { code: "MZN", name: "Mozambican Metical", symbol: "MT", numeric: "943" },
  { code: "NAD", name: "Namibian Dollar", symbol: "$", numeric: "516" },
  { code: "NGN", name: "Nigerian Naira", symbol: "₦", numeric: "566" },
  { code: "NIO", name: "Nicaraguan Córdoba", symbol: "C$", numeric: "558" },
  { code: "NOK", name: "Norwegian Krone", symbol: "kr", numeric: "578" },
  { code: "NPR", name: "Nepalese Rupee", symbol: "₨", numeric: "524" },
  { code: "NZD", name: "New Zealand Dollar", symbol: "NZ$", numeric: "554" },
  { code: "OMR", name: "Omani Rial", symbol: "ر.ع.", numeric: "512" },
  { code: "PAB", name: "Panamanian Balboa", symbol: "B/.", numeric: "590" },
  { code: "PEN", name: "Peruvian Sol", symbol: "S/", numeric: "604" },
  { code: "PGK", name: "Papua New Guinean Kina", symbol: "K", numeric: "598" },
  { code: "PHP", name: "Philippine Peso", symbol: "₱", numeric: "608" },
  { code: "PKR", name: "Pakistani Rupee", symbol: "₨", numeric: "586" },
  { code: "PLN", name: "Polish Zloty", symbol: "zł", numeric: "985" },
  { code: "PYG", name: "Paraguayan Guarani", symbol: "₲", numeric: "600" },
  { code: "QAR", name: "Qatari Riyal", symbol: "ر.ق", numeric: "634" },
  { code: "RON", name: "Romanian Leu", symbol: "lei", numeric: "946" },
  { code: "RSD", name: "Serbian Dinar", symbol: "дин.", numeric: "941" },
  { code: "RUB", name: "Russian Ruble", symbol: "₽", numeric: "643" },
  { code: "RWF", name: "Rwandan Franc", symbol: "FRw", numeric: "646" },
  { code: "SAR", name: "Saudi Riyal", symbol: "﷼", numeric: "682" },
  { code: "SBD", name: "Solomon Islands Dollar", symbol: "$", numeric: "090" },
  { code: "SCR", name: "Seychellois Rupee", symbol: "₨", numeric: "690" },
  { code: "SDG", name: "Sudanese Pound", symbol: "ج.س.", numeric: "938" },
  { code: "SEK", name: "Swedish Krona", symbol: "kr", numeric: "752" },
  { code: "SGD", name: "Singapore Dollar", symbol: "S$", numeric: "702" },
  { code: "SHP", name: "Saint Helena Pound", symbol: "£", numeric: "654" },
  { code: "SLE", name: "Sierra Leonean Leone", symbol: "Le", numeric: "925" },
  { code: "SOS", name: "Somali Shilling", symbol: "Sh", numeric: "706" },
  { code: "SRD", name: "Surinamese Dollar", symbol: "$", numeric: "968" },
  { code: "SSP", name: "South Sudanese Pound", symbol: "£", numeric: "728" },
  { code: "STN", name: "São Tomé & Príncipe Dobra", symbol: "Db", numeric: "930" },
  { code: "SYP", name: "Syrian Pound", symbol: "£", numeric: "760" },
  { code: "SZL", name: "Swazi Lilangeni", symbol: "L", numeric: "748" },
  { code: "THB", name: "Thai Baht", symbol: "฿", numeric: "764" },
  { code: "TJS", name: "Tajikistani Somoni", symbol: "ЅМ", numeric: "972" },
  { code: "TMT", name: "Turkmenistani Manat", symbol: "m", numeric: "934" },
  { code: "TND", name: "Tunisian Dinar", symbol: "د.ت", numeric: "788" },
  { code: "TOP", name: "Tongan Paʻanga", symbol: "T$", numeric: "776" },
  { code: "TRY", name: "Turkish Lira", symbol: "₺", numeric: "949" },
  { code: "TTD", name: "Trinidad & Tobago Dollar", symbol: "TT$", numeric: "780" },
  { code: "TWD", name: "New Taiwan Dollar", symbol: "NT$", numeric: "901" },
  { code: "TZS", name: "Tanzanian Shilling", symbol: "TSh", numeric: "834" },
  { code: "UAH", name: "Ukrainian Hryvnia", symbol: "₴", numeric: "980" },
  { code: "UGX", name: "Ugandan Shilling", symbol: "USh", numeric: "800" },
  { code: "USD", name: "US Dollar", symbol: "$", numeric: "840" },
  { code: "UYU", name: "Uruguayan Peso", symbol: "$U", numeric: "858" },
  { code: "UZS", name: "Uzbekistani Som", symbol: "лв", numeric: "860" },
  { code: "VES", name: "Venezuelan Bolívar", symbol: "Bs.S", numeric: "928" },
  { code: "VND", name: "Vietnamese Dong", symbol: "₫", numeric: "704" },
  { code: "VUV", name: "Vanuatu Vatu", symbol: "VT", numeric: "548" },
  { code: "WST", name: "Samoan Tala", symbol: "WS$", numeric: "882" },
  { code: "XAF", name: "Central African CFA Franc BEAC", symbol: "FCFA", numeric: "950" },
  { code: "XCD", name: "East Caribbean Dollar", symbol: "$", numeric: "951" },
  { code: "XOF", name: "West African CFA Franc BCEAO", symbol: "CFA", numeric: "952" },
  { code: "XPF", name: "CFP Franc", symbol: "₣", numeric: "953" },
  { code: "YER", name: "Yemeni Rial", symbol: "﷼", numeric: "886" },
  { code: "ZAR", name: "South African Rand", symbol: "R", numeric: "710" },
  { code: "ZMW", name: "Zambian Kwacha", symbol: "ZK", numeric: "967" },
];

/** Minor-unit count for a currency (default 2 when unknown). */
function decimalsFor(code) {
  const c = String(code || "").toUpperCase();
  if (DECIMALS_0.has(c)) return 0;
  if (DECIMALS_3.has(c)) return 3;
  return 2;
}

const CURRENCIES = RAW.map((c) => ({ ...c, decimals: decimalsFor(c.code) }));
const BY_CODE = new Map(CURRENCIES.map((c) => [c.code, c]));

/** One currency row by code, or undefined. */
function byCode(code) {
  return BY_CODE.get(String(code || "").toUpperCase());
}

/**
 * The countries that trade in a currency, priority-ordered (CEMAC/OHADA and the
 * main lanes first), each as `{ code, name }`. Drawn from countries.js so it can
 * never disagree with the country picker. `[]` when nothing uses it.
 */
function countriesFor(code) {
  const cur = String(code || "").toUpperCase();
  return countries.COUNTRIES
    .filter((c) => c.currency === cur)
    .map((c) => ({ code: c.code, name: c.name, sort_order: countries.sortOrder(c.code) }))
    .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
    .map(({ code: cc, name }) => ({ code: cc, name }));
}

/** The currency a country trades in, as a full catalogue row (or undefined). */
function forCountry(countryCode) {
  const c = countries.byCode(countryCode);
  return c ? byCode(c.currency) : undefined;
}

/**
 * The most representative country for a currency — the highest-priority one that
 * uses it — so the picker has a flag to show. For EUR that is whichever euro
 * country leads the priority order; for XAF, Cameroon. `null` when none.
 */
function representativeCountry(code) {
  const list = countriesFor(code);
  return list.length ? list[0].code : null;
}

/**
 * The full list a consumer renders: every currency plus its representative
 * country and a `sort_order` derived from that country's priority, sorted
 * lanes-first then by code. Computed once at module load.
 */
const CATALOGUE = CURRENCIES
  .map((c) => {
    const rep = representativeCountry(c.code);
    return { ...c, country_code: rep, sort_order: rep == null ? 10_000 : countries.sortOrder(rep) };
  })
  .sort((a, b) => a.sort_order - b.sort_order || a.code.localeCompare(b.code));

exports.CURRENCIES = CURRENCIES;
exports.CATALOGUE = CATALOGUE;
exports.byCode = byCode;
exports.decimalsFor = decimalsFor;
exports.countriesFor = countriesFor;
exports.forCountry = forCountry;
exports.representativeCountry = representativeCountry;
