"use strict";
/**
 * Canonical ISO 3166-1 alpha-2 country reference — the ONE definition of "what
 * countries exist, what they dial, and what they trade in".
 *
 * WHY IT LIVES HERE. Three consumers need the identical list and cannot be
 * allowed to drift:
 *   - the API's `GET /countries` (src/modules/master/country/…),
 *   - the migration that seeds `country_profile` (generated FROM this file — see
 *     scripts/gen/gen-country-seed.js, so the table and the module cannot
 *     disagree),
 *   - the client's Smart Country Picker (PR 2), which imports it directly so a
 *     searchable list of every country renders with no API round-trip.
 *
 * That is the same reason the Zod schemas live in this package: one boundary,
 * one definition. See index.js for why the exports are `exports.x =` and not an
 * object literal (the bundler cannot see named exports through the latter).
 *
 * SHAPE. `{ code, name, phone, currency }`. `phone` is the E.164 country
 * calling code as a bare string of digits (no `+`), because the picker composes
 * it into a full number and the API stores E.164. `currency` is ISO 4217.
 *
 * ORDERING. `PRIORITY_ORDER` puts CEMAC, then the rest of OHADA, then the major
 * trade lanes this product actually moves freight on, at the top of the list —
 * everything else follows alphabetically by name. `sortOrder(code)` turns that
 * into the integer the table stores and the picker sorts on, so "Cameroon" is
 * not buried between "Cambodia" and "Canada" for an operator in Douala.
 */

/** Every ISO 3166-1 alpha-2 country: code, English name, calling code, currency. */
const COUNTRIES = [
  { code: "AD", name: "Andorra", phone: "376", currency: "EUR" },
  { code: "AE", name: "United Arab Emirates", phone: "971", currency: "AED" },
  { code: "AF", name: "Afghanistan", phone: "93", currency: "AFN" },
  { code: "AG", name: "Antigua and Barbuda", phone: "1268", currency: "XCD" },
  { code: "AI", name: "Anguilla", phone: "1264", currency: "XCD" },
  { code: "AL", name: "Albania", phone: "355", currency: "ALL" },
  { code: "AM", name: "Armenia", phone: "374", currency: "AMD" },
  { code: "AO", name: "Angola", phone: "244", currency: "AOA" },
  { code: "AQ", name: "Antarctica", phone: "672", currency: "USD" },
  { code: "AR", name: "Argentina", phone: "54", currency: "ARS" },
  { code: "AS", name: "American Samoa", phone: "1684", currency: "USD" },
  { code: "AT", name: "Austria", phone: "43", currency: "EUR" },
  { code: "AU", name: "Australia", phone: "61", currency: "AUD" },
  { code: "AW", name: "Aruba", phone: "297", currency: "AWG" },
  { code: "AX", name: "Åland Islands", phone: "358", currency: "EUR" },
  { code: "AZ", name: "Azerbaijan", phone: "994", currency: "AZN" },
  { code: "BA", name: "Bosnia and Herzegovina", phone: "387", currency: "BAM" },
  { code: "BB", name: "Barbados", phone: "1246", currency: "BBD" },
  { code: "BD", name: "Bangladesh", phone: "880", currency: "BDT" },
  { code: "BE", name: "Belgium", phone: "32", currency: "EUR" },
  { code: "BF", name: "Burkina Faso", phone: "226", currency: "XOF" },
  { code: "BG", name: "Bulgaria", phone: "359", currency: "BGN" },
  { code: "BH", name: "Bahrain", phone: "973", currency: "BHD" },
  { code: "BI", name: "Burundi", phone: "257", currency: "BIF" },
  { code: "BJ", name: "Benin", phone: "229", currency: "XOF" },
  { code: "BL", name: "Saint Barthélemy", phone: "590", currency: "EUR" },
  { code: "BM", name: "Bermuda", phone: "1441", currency: "BMD" },
  { code: "BN", name: "Brunei Darussalam", phone: "673", currency: "BND" },
  { code: "BO", name: "Bolivia", phone: "591", currency: "BOB" },
  {
    code: "BQ",
    name: "Bonaire, Sint Eustatius and Saba",
    phone: "599",
    currency: "USD",
  },
  { code: "BR", name: "Brazil", phone: "55", currency: "BRL" },
  { code: "BS", name: "Bahamas", phone: "1242", currency: "BSD" },
  { code: "BT", name: "Bhutan", phone: "975", currency: "BTN" },
  { code: "BV", name: "Bouvet Island", phone: "47", currency: "NOK" },
  { code: "BW", name: "Botswana", phone: "267", currency: "BWP" },
  { code: "BY", name: "Belarus", phone: "375", currency: "BYN" },
  { code: "BZ", name: "Belize", phone: "501", currency: "BZD" },
  { code: "CA", name: "Canada", phone: "1", currency: "CAD" },
  { code: "CC", name: "Cocos (Keeling) Islands", phone: "61", currency: "AUD" },
  {
    code: "CD",
    name: "Congo (Democratic Republic)",
    phone: "243",
    currency: "CDF",
  },
  {
    code: "CF",
    name: "Central African Republic",
    phone: "236",
    currency: "XAF",
  },
  { code: "CG", name: "Congo (Republic)", phone: "242", currency: "XAF" },
  { code: "CH", name: "Switzerland", phone: "41", currency: "CHF" },
  { code: "CI", name: "Côte d'Ivoire", phone: "225", currency: "XOF" },
  { code: "CK", name: "Cook Islands", phone: "682", currency: "NZD" },
  { code: "CL", name: "Chile", phone: "56", currency: "CLP" },
  { code: "CM", name: "Cameroon", phone: "237", currency: "XAF" },
  { code: "CN", name: "China", phone: "86", currency: "CNY" },
  { code: "CO", name: "Colombia", phone: "57", currency: "COP" },
  { code: "CR", name: "Costa Rica", phone: "506", currency: "CRC" },
  { code: "CU", name: "Cuba", phone: "53", currency: "CUP" },
  { code: "CV", name: "Cabo Verde", phone: "238", currency: "CVE" },
  { code: "CW", name: "Curaçao", phone: "599", currency: "ANG" },
  { code: "CX", name: "Christmas Island", phone: "61", currency: "AUD" },
  { code: "CY", name: "Cyprus", phone: "357", currency: "EUR" },
  { code: "CZ", name: "Czechia", phone: "420", currency: "CZK" },
  { code: "DE", name: "Germany", phone: "49", currency: "EUR" },
  { code: "DJ", name: "Djibouti", phone: "253", currency: "DJF" },
  { code: "DK", name: "Denmark", phone: "45", currency: "DKK" },
  { code: "DM", name: "Dominica", phone: "1767", currency: "XCD" },
  { code: "DO", name: "Dominican Republic", phone: "1809", currency: "DOP" },
  { code: "DZ", name: "Algeria", phone: "213", currency: "DZD" },
  { code: "EC", name: "Ecuador", phone: "593", currency: "USD" },
  { code: "EE", name: "Estonia", phone: "372", currency: "EUR" },
  { code: "EG", name: "Egypt", phone: "20", currency: "EGP" },
  { code: "EH", name: "Western Sahara", phone: "212", currency: "MAD" },
  { code: "ER", name: "Eritrea", phone: "291", currency: "ERN" },
  { code: "ES", name: "Spain", phone: "34", currency: "EUR" },
  { code: "ET", name: "Ethiopia", phone: "251", currency: "ETB" },
  { code: "FI", name: "Finland", phone: "358", currency: "EUR" },
  { code: "FJ", name: "Fiji", phone: "679", currency: "FJD" },
  { code: "FK", name: "Falkland Islands", phone: "500", currency: "FKP" },
  { code: "FM", name: "Micronesia", phone: "691", currency: "USD" },
  { code: "FO", name: "Faroe Islands", phone: "298", currency: "DKK" },
  { code: "FR", name: "France", phone: "33", currency: "EUR" },
  { code: "GA", name: "Gabon", phone: "241", currency: "XAF" },
  { code: "GB", name: "United Kingdom", phone: "44", currency: "GBP" },
  { code: "GD", name: "Grenada", phone: "1473", currency: "XCD" },
  { code: "GE", name: "Georgia", phone: "995", currency: "GEL" },
  { code: "GF", name: "French Guiana", phone: "594", currency: "EUR" },
  { code: "GG", name: "Guernsey", phone: "44", currency: "GBP" },
  { code: "GH", name: "Ghana", phone: "233", currency: "GHS" },
  { code: "GI", name: "Gibraltar", phone: "350", currency: "GIP" },
  { code: "GL", name: "Greenland", phone: "299", currency: "DKK" },
  { code: "GM", name: "Gambia", phone: "220", currency: "GMD" },
  { code: "GN", name: "Guinea", phone: "224", currency: "GNF" },
  { code: "GP", name: "Guadeloupe", phone: "590", currency: "EUR" },
  { code: "GQ", name: "Equatorial Guinea", phone: "240", currency: "XAF" },
  { code: "GR", name: "Greece", phone: "30", currency: "EUR" },
  {
    code: "GS",
    name: "South Georgia and the South Sandwich Islands",
    phone: "500",
    currency: "GBP",
  },
  { code: "GT", name: "Guatemala", phone: "502", currency: "GTQ" },
  { code: "GU", name: "Guam", phone: "1671", currency: "USD" },
  { code: "GW", name: "Guinea-Bissau", phone: "245", currency: "XOF" },
  { code: "GY", name: "Guyana", phone: "592", currency: "GYD" },
  { code: "HK", name: "Hong Kong", phone: "852", currency: "HKD" },
  {
    code: "HM",
    name: "Heard Island and McDonald Islands",
    phone: "672",
    currency: "AUD",
  },
  { code: "HN", name: "Honduras", phone: "504", currency: "HNL" },
  { code: "HR", name: "Croatia", phone: "385", currency: "EUR" },
  { code: "HT", name: "Haiti", phone: "509", currency: "HTG" },
  { code: "HU", name: "Hungary", phone: "36", currency: "HUF" },
  { code: "ID", name: "Indonesia", phone: "62", currency: "IDR" },
  { code: "IE", name: "Ireland", phone: "353", currency: "EUR" },
  { code: "IL", name: "Israel", phone: "972", currency: "ILS" },
  { code: "IM", name: "Isle of Man", phone: "44", currency: "GBP" },
  { code: "IN", name: "India", phone: "91", currency: "INR" },
  {
    code: "IO",
    name: "British Indian Ocean Territory",
    phone: "246",
    currency: "USD",
  },
  { code: "IQ", name: "Iraq", phone: "964", currency: "IQD" },
  { code: "IR", name: "Iran", phone: "98", currency: "IRR" },
  { code: "IS", name: "Iceland", phone: "354", currency: "ISK" },
  { code: "IT", name: "Italy", phone: "39", currency: "EUR" },
  { code: "JE", name: "Jersey", phone: "44", currency: "GBP" },
  { code: "JM", name: "Jamaica", phone: "1876", currency: "JMD" },
  { code: "JO", name: "Jordan", phone: "962", currency: "JOD" },
  { code: "JP", name: "Japan", phone: "81", currency: "JPY" },
  { code: "KE", name: "Kenya", phone: "254", currency: "KES" },
  { code: "KG", name: "Kyrgyzstan", phone: "996", currency: "KGS" },
  { code: "KH", name: "Cambodia", phone: "855", currency: "KHR" },
  { code: "KI", name: "Kiribati", phone: "686", currency: "AUD" },
  { code: "KM", name: "Comoros", phone: "269", currency: "KMF" },
  { code: "KN", name: "Saint Kitts and Nevis", phone: "1869", currency: "XCD" },
  { code: "KP", name: "North Korea", phone: "850", currency: "KPW" },
  { code: "KR", name: "South Korea", phone: "82", currency: "KRW" },
  { code: "KW", name: "Kuwait", phone: "965", currency: "KWD" },
  { code: "KY", name: "Cayman Islands", phone: "1345", currency: "KYD" },
  { code: "KZ", name: "Kazakhstan", phone: "7", currency: "KZT" },
  { code: "LA", name: "Laos", phone: "856", currency: "LAK" },
  { code: "LB", name: "Lebanon", phone: "961", currency: "LBP" },
  { code: "LC", name: "Saint Lucia", phone: "1758", currency: "XCD" },
  { code: "LI", name: "Liechtenstein", phone: "423", currency: "CHF" },
  { code: "LK", name: "Sri Lanka", phone: "94", currency: "LKR" },
  { code: "LR", name: "Liberia", phone: "231", currency: "LRD" },
  { code: "LS", name: "Lesotho", phone: "266", currency: "LSL" },
  { code: "LT", name: "Lithuania", phone: "370", currency: "EUR" },
  { code: "LU", name: "Luxembourg", phone: "352", currency: "EUR" },
  { code: "LV", name: "Latvia", phone: "371", currency: "EUR" },
  { code: "LY", name: "Libya", phone: "218", currency: "LYD" },
  { code: "MA", name: "Morocco", phone: "212", currency: "MAD" },
  { code: "MC", name: "Monaco", phone: "377", currency: "EUR" },
  { code: "MD", name: "Moldova", phone: "373", currency: "MDL" },
  { code: "ME", name: "Montenegro", phone: "382", currency: "EUR" },
  {
    code: "MF",
    name: "Saint Martin (French part)",
    phone: "590",
    currency: "EUR",
  },
  { code: "MG", name: "Madagascar", phone: "261", currency: "MGA" },
  { code: "MH", name: "Marshall Islands", phone: "692", currency: "USD" },
  { code: "MK", name: "North Macedonia", phone: "389", currency: "MKD" },
  { code: "ML", name: "Mali", phone: "223", currency: "XOF" },
  { code: "MM", name: "Myanmar", phone: "95", currency: "MMK" },
  { code: "MN", name: "Mongolia", phone: "976", currency: "MNT" },
  { code: "MO", name: "Macao", phone: "853", currency: "MOP" },
  {
    code: "MP",
    name: "Northern Mariana Islands",
    phone: "1670",
    currency: "USD",
  },
  { code: "MQ", name: "Martinique", phone: "596", currency: "EUR" },
  { code: "MR", name: "Mauritania", phone: "222", currency: "MRU" },
  { code: "MS", name: "Montserrat", phone: "1664", currency: "XCD" },
  { code: "MT", name: "Malta", phone: "356", currency: "EUR" },
  { code: "MU", name: "Mauritius", phone: "230", currency: "MUR" },
  { code: "MV", name: "Maldives", phone: "960", currency: "MVR" },
  { code: "MW", name: "Malawi", phone: "265", currency: "MWK" },
  { code: "MX", name: "Mexico", phone: "52", currency: "MXN" },
  { code: "MY", name: "Malaysia", phone: "60", currency: "MYR" },
  { code: "MZ", name: "Mozambique", phone: "258", currency: "MZN" },
  { code: "NA", name: "Namibia", phone: "264", currency: "NAD" },
  { code: "NC", name: "New Caledonia", phone: "687", currency: "XPF" },
  { code: "NE", name: "Niger", phone: "227", currency: "XOF" },
  { code: "NF", name: "Norfolk Island", phone: "672", currency: "AUD" },
  { code: "NG", name: "Nigeria", phone: "234", currency: "NGN" },
  { code: "NI", name: "Nicaragua", phone: "505", currency: "NIO" },
  { code: "NL", name: "Netherlands", phone: "31", currency: "EUR" },
  { code: "NO", name: "Norway", phone: "47", currency: "NOK" },
  { code: "NP", name: "Nepal", phone: "977", currency: "NPR" },
  { code: "NR", name: "Nauru", phone: "674", currency: "AUD" },
  { code: "NU", name: "Niue", phone: "683", currency: "NZD" },
  { code: "NZ", name: "New Zealand", phone: "64", currency: "NZD" },
  { code: "OM", name: "Oman", phone: "968", currency: "OMR" },
  { code: "PA", name: "Panama", phone: "507", currency: "PAB" },
  { code: "PE", name: "Peru", phone: "51", currency: "PEN" },
  { code: "PF", name: "French Polynesia", phone: "689", currency: "XPF" },
  { code: "PG", name: "Papua New Guinea", phone: "675", currency: "PGK" },
  { code: "PH", name: "Philippines", phone: "63", currency: "PHP" },
  { code: "PK", name: "Pakistan", phone: "92", currency: "PKR" },
  { code: "PL", name: "Poland", phone: "48", currency: "PLN" },
  {
    code: "PM",
    name: "Saint Pierre and Miquelon",
    phone: "508",
    currency: "EUR",
  },
  { code: "PN", name: "Pitcairn", phone: "64", currency: "NZD" },
  { code: "PR", name: "Puerto Rico", phone: "1787", currency: "USD" },
  { code: "PS", name: "Palestine", phone: "970", currency: "ILS" },
  { code: "PT", name: "Portugal", phone: "351", currency: "EUR" },
  { code: "PW", name: "Palau", phone: "680", currency: "USD" },
  { code: "PY", name: "Paraguay", phone: "595", currency: "PYG" },
  { code: "QA", name: "Qatar", phone: "974", currency: "QAR" },
  { code: "RE", name: "Réunion", phone: "262", currency: "EUR" },
  { code: "RO", name: "Romania", phone: "40", currency: "RON" },
  { code: "RS", name: "Serbia", phone: "381", currency: "RSD" },
  { code: "RU", name: "Russia", phone: "7", currency: "RUB" },
  { code: "RW", name: "Rwanda", phone: "250", currency: "RWF" },
  { code: "SA", name: "Saudi Arabia", phone: "966", currency: "SAR" },
  { code: "SB", name: "Solomon Islands", phone: "677", currency: "SBD" },
  { code: "SC", name: "Seychelles", phone: "248", currency: "SCR" },
  { code: "SD", name: "Sudan", phone: "249", currency: "SDG" },
  { code: "SE", name: "Sweden", phone: "46", currency: "SEK" },
  { code: "SG", name: "Singapore", phone: "65", currency: "SGD" },
  { code: "SH", name: "Saint Helena", phone: "290", currency: "SHP" },
  { code: "SI", name: "Slovenia", phone: "386", currency: "EUR" },
  { code: "SJ", name: "Svalbard and Jan Mayen", phone: "47", currency: "NOK" },
  { code: "SK", name: "Slovakia", phone: "421", currency: "EUR" },
  { code: "SL", name: "Sierra Leone", phone: "232", currency: "SLE" },
  { code: "SM", name: "San Marino", phone: "378", currency: "EUR" },
  { code: "SN", name: "Senegal", phone: "221", currency: "XOF" },
  { code: "SO", name: "Somalia", phone: "252", currency: "SOS" },
  { code: "SR", name: "Suriname", phone: "597", currency: "SRD" },
  { code: "SS", name: "South Sudan", phone: "211", currency: "SSP" },
  { code: "ST", name: "Sao Tome and Principe", phone: "239", currency: "STN" },
  { code: "SV", name: "El Salvador", phone: "503", currency: "USD" },
  {
    code: "SX",
    name: "Sint Maarten (Dutch part)",
    phone: "1721",
    currency: "ANG",
  },
  { code: "SY", name: "Syria", phone: "963", currency: "SYP" },
  { code: "SZ", name: "Eswatini", phone: "268", currency: "SZL" },
  {
    code: "TC",
    name: "Turks and Caicos Islands",
    phone: "1649",
    currency: "USD",
  },
  { code: "TD", name: "Chad", phone: "235", currency: "XAF" },
  {
    code: "TF",
    name: "French Southern Territories",
    phone: "262",
    currency: "EUR",
  },
  { code: "TG", name: "Togo", phone: "228", currency: "XOF" },
  { code: "TH", name: "Thailand", phone: "66", currency: "THB" },
  { code: "TJ", name: "Tajikistan", phone: "992", currency: "TJS" },
  { code: "TK", name: "Tokelau", phone: "690", currency: "NZD" },
  { code: "TL", name: "Timor-Leste", phone: "670", currency: "USD" },
  { code: "TM", name: "Turkmenistan", phone: "993", currency: "TMT" },
  { code: "TN", name: "Tunisia", phone: "216", currency: "TND" },
  { code: "TO", name: "Tonga", phone: "676", currency: "TOP" },
  { code: "TR", name: "Türkiye", phone: "90", currency: "TRY" },
  { code: "TT", name: "Trinidad and Tobago", phone: "1868", currency: "TTD" },
  { code: "TV", name: "Tuvalu", phone: "688", currency: "AUD" },
  { code: "TW", name: "Taiwan", phone: "886", currency: "TWD" },
  { code: "TZ", name: "Tanzania", phone: "255", currency: "TZS" },
  { code: "UA", name: "Ukraine", phone: "380", currency: "UAH" },
  { code: "UG", name: "Uganda", phone: "256", currency: "UGX" },
  {
    code: "UM",
    name: "United States Minor Outlying Islands",
    phone: "1",
    currency: "USD",
  },
  { code: "US", name: "United States", phone: "1", currency: "USD" },
  { code: "UY", name: "Uruguay", phone: "598", currency: "UYU" },
  { code: "UZ", name: "Uzbekistan", phone: "998", currency: "UZS" },
  { code: "VA", name: "Holy See", phone: "379", currency: "EUR" },
  {
    code: "VC",
    name: "Saint Vincent and the Grenadines",
    phone: "1784",
    currency: "XCD",
  },
  { code: "VE", name: "Venezuela", phone: "58", currency: "VES" },
  {
    code: "VG",
    name: "Virgin Islands (British)",
    phone: "1284",
    currency: "USD",
  },
  { code: "VI", name: "Virgin Islands (U.S.)", phone: "1340", currency: "USD" },
  { code: "VN", name: "Vietnam", phone: "84", currency: "VND" },
  { code: "VU", name: "Vanuatu", phone: "678", currency: "VUV" },
  { code: "WF", name: "Wallis and Futuna", phone: "681", currency: "XPF" },
  { code: "WS", name: "Samoa", phone: "685", currency: "WST" },
  { code: "YE", name: "Yemen", phone: "967", currency: "YER" },
  { code: "YT", name: "Mayotte", phone: "262", currency: "EUR" },
  { code: "ZA", name: "South Africa", phone: "27", currency: "ZAR" },
  { code: "ZM", name: "Zambia", phone: "260", currency: "ZMW" },
  { code: "ZW", name: "Zimbabwe", phone: "263", currency: "USD" },
];

/**
 * Membership groups that decide a jurisdiction's default registration profile.
 * CEMAC ⊂ OHADA for our purposes here, but CEMAC is listed first so it sorts
 * ahead — this is a Douala-based freight forwarder, and its home bloc leads.
 */
const CEMAC = ["CM", "CF", "TD", "CG", "GA", "GQ"];
const OHADA = [
  ...CEMAC,
  "BJ",
  "BF",
  "CI",
  "KM",
  "CD",
  "GW",
  "GN",
  "ML",
  "NE",
  "SN",
  "TG",
];
/** EU member states — drive the EORI + VAT registration profile. */
const EU = [
  "AT",
  "BE",
  "BG",
  "HR",
  "CY",
  "CZ",
  "DK",
  "EE",
  "FI",
  "FR",
  "DE",
  "GR",
  "HU",
  "IE",
  "IT",
  "LV",
  "LT",
  "LU",
  "MT",
  "NL",
  "PL",
  "PT",
  "RO",
  "SK",
  "SI",
  "ES",
  "SE",
];

/**
 * The lanes this product moves the most freight on, after its own bloc. Kept
 * short and deliberate — it only decides what floats to the top of a picker, so
 * the test is "would a Douala ops desk pick this weekly", not "is it a big
 * economy".
 */
const MAJOR_LANES = [
  "CN",
  "US",
  "FR",
  "NL",
  "BE",
  "DE",
  "GB",
  "AE",
  "IN",
  "ZA",
  "NG",
  "GH",
  "TR",
  "IT",
  "ES",
  "SG",
  "HK",
  "JP",
  "KR",
  "BR",
  "MA",
  "EG",
];

/**
 * The priority prefix of the sort order: CEMAC, then the rest of OHADA, then the
 * major lanes. Deduplicated, order-preserving.
 */
const PRIORITY_ORDER = [...new Set([...OHADA, ...MAJOR_LANES])];

const PRIORITY_INDEX = new Map(PRIORITY_ORDER.map((code, i) => [code, i]));

/**
 * Integer sort key for a country.
 *
 * Priority codes get `0..N-1`; everyone else gets `1000 + alphabetical-rank`, so
 * the two bands never interleave and the tail stays A→Z by name. The table
 * stores this as `sort_order`; the picker sorts on it directly.
 */
function sortOrder(code) {
  if (PRIORITY_INDEX.has(code)) return PRIORITY_INDEX.get(code);
  const rank = [...COUNTRIES]
    .sort((a, b) => a.name.localeCompare(b.name))
    .findIndex((c) => c.code === code);
  return 1000 + (rank === -1 ? COUNTRIES.length : rank);
}

/**
 * Per-jurisdiction registration requirements — the legal/tax IDs a party in that
 * country is expected to carry. Each entry is
 * `{ kind, label_fr, label_en, regex, placeholder, required }`, matching
 * `country_profile.registration_requirements` and `party_registration.kind`.
 *
 * Only the jurisdictions with a defined profile are listed; `requirementsFor`
 * falls back to `[]` for the rest (a country we trade with but do not enforce a
 * registration shape on). OHADA/CEMAC members all resolve to NIU + RCCM, the
 * Cameroon-real pair this product started with (KB §6).
 */
const OHADA_REQUIREMENTS = [
  {
    kind: "NIU",
    label_fr: "Numéro d'Identifiant Unique",
    label_en: "Unique Taxpayer Number",
    regex: "^[A-Za-z0-9]{8,20}$",
    placeholder: "P0123456789A",
    required: true,
  },
  {
    kind: "RCCM",
    label_fr: "Registre du Commerce et du Crédit Mobilier",
    label_en: "Trade & Personal Property Credit Register",
    regex: "^[A-Za-z0-9/\\-]{6,30}$",
    placeholder: "RC/DLA/2020/B/1234",
    required: true,
  },
];
const EU_REQUIREMENTS = [
  {
    kind: "VAT",
    label_fr: "Numéro de TVA intracommunautaire",
    label_en: "VAT number",
    regex: "^[A-Za-z]{2}[A-Za-z0-9]{2,12}$",
    placeholder: "FR12345678901",
    required: true,
  },
  {
    kind: "EORI",
    label_fr: "Numéro EORI",
    label_en: "EORI number",
    regex: "^[A-Za-z]{2}[A-Za-z0-9]{1,15}$",
    placeholder: "FR123456789012345",
    required: false,
  },
];
const REGISTRATION_REQUIREMENTS = {
  US: [
    {
      kind: "EIN",
      label_fr: "Employer Identification Number",
      label_en: "Employer Identification Number (EIN)",
      regex: "^\\d{2}-?\\d{7}$",
      placeholder: "12-3456789",
      required: true,
    },
    {
      kind: "W9",
      label_fr: "Formulaire W-9",
      label_en: "Form W-9",
      regex: "",
      placeholder: "On file",
      required: false,
    },
  ],
  GB: [
    {
      kind: "CRN",
      label_fr: "Companies House Number",
      label_en: "Companies House Number",
      regex: "^[A-Za-z0-9]{8}$",
      placeholder: "01234567",
      required: true,
    },
    {
      kind: "VAT",
      label_fr: "Numéro de TVA",
      label_en: "VAT number",
      regex: "^GB[0-9]{9,12}$",
      placeholder: "GB123456789",
      required: false,
    },
    {
      kind: "UTR",
      label_fr: "Unique Taxpayer Reference",
      label_en: "Unique Taxpayer Reference (UTR)",
      regex: "^\\d{10}$",
      placeholder: "1234567890",
      required: false,
    },
  ],
};
for (const code of OHADA) REGISTRATION_REQUIREMENTS[code] = OHADA_REQUIREMENTS;
for (const code of EU) REGISTRATION_REQUIREMENTS[code] = EU_REQUIREMENTS;

/** The registration requirements for a country, or `[]` when none is defined. */
function requirementsFor(code) {
  return REGISTRATION_REQUIREMENTS[String(code || "").toUpperCase()] || [];
}

/** One country row by code, or undefined. */
const BY_CODE = new Map(COUNTRIES.map((c) => [c.code, c]));
function byCode(code) {
  return BY_CODE.get(String(code || "").toUpperCase());
}

/** The calling code for a country (bare digits, no `+`), or "" when unknown. */
function phoneCodeFor(code) {
  const c = byCode(code);
  return c ? c.phone : "";
}

/**
 * The full list a consumer renders: every country plus its `sortOrder`, sorted
 * priority-first then alphabetically. Computed once at module load.
 */
const CATALOGUE = COUNTRIES.map((c) => ({
  ...c,
  sort_order: sortOrder(c.code),
})).sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));

// Named `exports.x =` assignments, NOT `module.exports = { x }` — the client is
// bundled and cjs-module-lexer cannot see named exports through an object
// literal. See index.js.
exports.COUNTRIES = COUNTRIES;
exports.CATALOGUE = CATALOGUE;
exports.CEMAC = CEMAC;
exports.OHADA = OHADA;
exports.EU = EU;
exports.PRIORITY_ORDER = PRIORITY_ORDER;
exports.REGISTRATION_REQUIREMENTS = REGISTRATION_REQUIREMENTS;
exports.sortOrder = sortOrder;
exports.requirementsFor = requirementsFor;
exports.byCode = byCode;
exports.phoneCodeFor = phoneCodeFor;
