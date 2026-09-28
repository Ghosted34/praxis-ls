/**
 * "Describe it in your own words" — the portal quote wizard's AI fill
 * (client portal redesign PR 2, owner decision: prefill + AI fill).
 *
 * A client types what they would say on the phone — "2×40HC of ceramic tiles,
 * Shanghai to Douala, FOB, about 48 tonnes, need it before December" — and the
 * wizard's three steps come back filled: mode, direction, route, incoterm,
 * cargo, weight. The client still walks the steps and sends it; nothing is
 * filed on their behalf.
 *
 * ── TWO READERS, ONE ANSWER ────────────────────────────────────────────────
 *
 * A rules reader (below) always runs: incoterms, weights, "from X to Y",
 * container counts and the words for each mode are regular enough to catch
 * without a model. The model runs only where the tenant's AI is on and within
 * budget (`governance.canUseFeature`, the gate every AI entry point uses), and
 * only on live data; its answer is validated field by field and fills what
 * the rules left blank or got wrong. So a tenant without AI still gets a
 * useful fill, and a model that answers nonsense costs a blank field, never a
 * wrong enum.
 *
 * The text leaves for the vendor through the STRICT redactor: the client's
 * phone number and email are not the vendor's business.
 */
"use strict";

const { z } = require("zod");
const llm = require("../../services/ai/llm.service");
const { redact } = require("../../services/ai/redact");
const governance = require("../ai/governance/governance.service");
const { logger } = require("../../config/logger");

const FEATURE = "portal_quote_fill";
const MODES = ["SEA", "AIR", "ROAD", "CUSTOMS", "STORAGE", "OTHER"];
const DIRECTIONS = ["IMPORT", "EXPORT", "LOCAL"];
const INCOTERMS = ["EXW", "FCA", "FAS", "FOB", "CFR", "CIF", "CPT", "CIP", "DAP", "DPU", "DDP"];

const place = z.string().trim().min(2).max(120);
const Fields = z.object({
  mode: z.enum(MODES).nullable().optional(),
  direction: z.enum(DIRECTIONS).nullable().optional(),
  origin: place.nullable().optional(),
  destination: place.nullable().optional(),
  incoterm: z.enum(INCOTERMS).nullable().optional(),
  cargo: z.string().trim().min(2).max(400).nullable().optional(),
  weight_kg: z.number().positive().max(10_000_000).nullable().optional(),
  containers: z.string().trim().max(60).nullable().optional(),
});

/* ── the rules reader ────────────────────────────────────────────────────── */

const MODE_WORDS = [
  ["AIR", /\b(air|by air|plane|flight|avion|a[ée]rien|fret a[ée]rien|awb)\b/i],
  ["SEA", /\b(sea|ship|vessel|ocean|maritime|bateau|navire|conteneurs?|containers?|20\s?(?:ft|'|pieds|gp|dv)|40\s?(?:ft|'|pieds|hc|gp|dv)|fcl|lcl|b\/?l)\b/i],
  ["ROAD", /\b(truck|road|lorry|trailer|camion|routier|route|remorque)\b/i],
  ["CUSTOMS", /\b(customs|clearance|d[ée]douanement|douanes?)\b/i],
  ["STORAGE", /\b(storage|warehouse|warehousing|entrep[oô]t|entreposage|stockage)\b/i],
];

const CUT = String.raw`(?=\s*(?:[,.;()]|\s(?:by|via|on|in|with|for|before|par|en|avec|pour|avant|using)\b|$))`;
const FROM_TO = [
  new RegExp(String.raw`\bfrom\s+([\p{L}][\p{L} .'-]{1,50}?)\s+to\s+([\p{L}][\p{L} .'-]{1,50}?)${CUT}`, "iu"),
  new RegExp(String.raw`\b(?:de|depuis)\s+([\p{L}][\p{L} .'-]{1,50}?)\s+(?:[àa]|vers|jusqu'?[àa])\s+([\p{L}][\p{L} .'-]{1,50}?)${CUT}`, "iu"),
  new RegExp(String.raw`\b([\p{L}][\p{L}.'-]{1,30}(?:\s[\p{L}][\p{L}.'-]{1,30})?)\s*(?:→|->|–|—)\s*([\p{L}][\p{L}.'-]{1,30}(?:\s[\p{L}][\p{L}.'-]{1,30})?)`, "iu"),
];

const cap = (s) => String(s || "").trim().replace(/\s+/g, " ").replace(/^\p{Ll}/u, (ch) => ch.toUpperCase());

/** What regular expressions can read with confidence. Anything unsure stays null. */
function rules(text) {
  const t = String(text || "");
  const out = { mode: null, direction: null, origin: null, destination: null, incoterm: null, cargo: null, weight_kg: null, containers: null };

  for (const [mode, re] of MODE_WORDS) {
    if (re.test(t)) {
      out.mode = mode;
      break;
    }
  }
  const inc = new RegExp(`\\b(${INCOTERMS.join("|")})\\b`, "i").exec(t);
  if (inc) out.incoterm = inc[1].toUpperCase();

  if (/\b(import|importing|importation|importer)\b/i.test(t)) out.direction = "IMPORT";
  else if (/\b(export|exporting|exportation|exporter)\b/i.test(t)) out.direction = "EXPORT";
  else if (/\b(local|domestic|intra-?city|within)\b/i.test(t)) out.direction = "LOCAL";

  for (const re of FROM_TO) {
    const m = re.exec(t);
    if (m) {
      // "3 conteneurs de riz de Bangkok à Douala": the pattern anchors at the
      // FIRST "de", so the place is what follows the last one.
      out.origin = cap(m[1].split(/\s(?:de|depuis|from|du|des)\s/iu).pop());
      out.destination = cap(m[2]);
      break;
    }
  }
  if (!out.destination) {
    const arrive = new RegExp(String.raw`\b(?:arriving (?:at|in)|delivered (?:to|at)|arrivant [àa]|livr[ée]e? [àa]|au port de)\s+([\p{L}][\p{L} .'-]{1,40}?)(?:\s+port)?${CUT}`, "iu").exec(t);
    if (arrive) out.destination = cap(arrive[1]);
  }

  // "48 t", "48 tonnes", "48,5 tons", "12000 kg", "12 000 kilos".
  const w = /(\d{1,3}(?:[ \u202f\u00a0]\d{3})+|\d+(?:[.,]\d+)?)\s*(t|tonnes?|tons?|mt|kg|kgs|kilos?|kilogrammes?)\b/i.exec(t);
  if (w) {
    const n = Number(w[1].replace(/[ \u202f\u00a0]/g, "").replace(",", "."));
    if (Number.isFinite(n) && n > 0) out.weight_kg = /^(t|tonnes?|tons?|mt)$/i.test(w[2]) ? Math.round(n * 1000) : Math.round(n);
  }

  // "2×40HC", "2 x 40'", "3 conteneurs de 20 pieds".
  const box = /(\d{1,3})\s*(?:[x×*]|conteneurs?\s+de)\s*(20|40|45)\s*(?:'|ft|pieds)?\s*(hc|gp|dv|rf|ot)?/i.exec(t);
  if (box) out.containers = `${box[1]}×${box[2]}${(box[3] || "").toUpperCase()}`;
  // Containers are a sea job unless the text said otherwise.
  if (box && !out.mode) out.mode = "SEA";

  // The cargo, until something better reads it: the description itself,
  // which is what the team would have typed into the field anyway.
  const plain = t.replace(/\s+/g, " ").trim();
  if (plain.length >= 3) out.cargo = plain.slice(0, 400);
  return out;
}

/* ── the model ───────────────────────────────────────────────────────────── */

const PROMPT = `You read a shipper's description of a freight job and return ONLY JSON:
{"mode":"SEA|AIR|ROAD|CUSTOMS|STORAGE|OTHER|null","direction":"IMPORT|EXPORT|LOCAL|null",
 "origin":"city or port, as written, or null","destination":"city or port, as written, or null",
 "incoterm":"one of ${INCOTERMS.join(", ")} or null","cargo":"what the goods are, 3-12 words, in the writer's language, or null",
 "weight_kg":number or null,"containers":"like 2×40HC, or null"}
Rules: use null for anything the text does not say — never guess a place, an incoterm or a weight.
Convert tonnes to kilograms. The text may be English or French.`;

function merge(base, ai) {
  const out = { ...base };
  for (const [k, v] of Object.entries(ai || {})) {
    if (v !== null && v !== undefined && v !== "") out[k] = v;
  }
  return out;
}

/**
 * Fill the wizard from a description. Returns the fields and where they came
 * from (`ai` when the model answered and validated, `rules` otherwise), so the
 * portal can say "filled for you — check each step" either way.
 */
async function fill(c, { text, env = "live" }) {
  const clean = String(text || "").replace(/\s+/g, " ").trim().slice(0, 2000);
  const base = rules(clean);
  if (env !== "live" || clean.length < 8) return { fields: base, source: "rules" };

  let gate;
  try {
    gate = await governance.canUseFeature(c, { userId: null, featureKey: FEATURE });
  } catch (err) {
    logger.warn({ err: err && err.message }, "portal quote fill: AI gate unavailable, rules only");
    return { fields: base, source: "rules" };
  }
  if (!gate || !gate.allowed) return { fields: base, source: "rules" };

  const started = Date.now();
  let out = null;
  let parsed = null;
  try {
    out = await llm.chat({
      client: c,
      messages: [
        { role: "system", content: PROMPT },
        { role: "user", content: redact(clean) },
      ],
      temperature: 0,
      maxTokens: 300,
      timeoutMs: 15_000,
      singleVendor: true,
      responseFormat: { type: "json_object" },
    });
    const json = JSON.parse(String((out && out.text) || "").replace(/^```(?:json)?|```$/g, "").trim());
    // Field by field: one bad value costs that field, not the whole answer.
    const safe = {};
    for (const key of Object.keys(Fields.shape)) {
      const one = Fields.shape[key].safeParse(json[key] === "null" ? null : json[key]);
      if (one.success && one.data !== undefined) safe[key] = one.data;
    }
    parsed = safe;
  } catch (err) {
    logger.warn({ err: err && err.message }, "portal quote fill: the model's answer was not usable, rules only");
  }

  await governance.recordUsage(c, {
    userId: null,
    featureKey: FEATURE,
    provider: out && out.provider,
    model: out && out.model,
    callType: FEATURE,
    inputTokens: Number((out && out.usage && out.usage.prompt_tokens) || 0),
    outputTokens: Number((out && out.usage && out.usage.completion_tokens) || 0),
    latencyMs: Date.now() - started,
    wasSuccessful: !!parsed,
    errorCode: parsed ? null : "UNUSABLE_ANSWER",
  }).catch(() => {
    /* @silent:storage — metering is an enrichment on an answer already given */
  });

  return parsed ? { fields: merge(base, parsed), source: "ai" } : { fields: base, source: "rules" };
}

module.exports = { fill, rules, FEATURE };
