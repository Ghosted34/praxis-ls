import i18n from "@/lib/i18n";
import { en, fr } from "./careers-copy";

/**
 * Register the careers copy when the careers chunk loads (13792).
 *
 * ── WHY THIS IS A SEPARATE FILE FROM THE DATA ─────────────────────────────
 *
 * `careers-copy.ts` is read as DATA by two build scripts, one of which
 * evaluates it and refuses a file carrying an import. So the import lives here
 * and that file stays a pair of object literals.
 *
 * ── WHY A MODULE SIDE EFFECT AND NOT A HOOK ───────────────────────────────
 *
 * This runs when the chunk is evaluated, which is strictly before React renders
 * anything the chunk exports. A `useEffect` would run AFTER the first paint, so
 * the careers page would show raw dictionary keys for one frame — on the page a
 * job applicant reads twice before they trust it.
 *
 * ── `overwrite = false`, AND IT IS THE WHOLE CORRECTNESS ARGUMENT ─────────
 *
 * A tenant's own words for these strings arrive separately, through
 * `site-copy.ts`, which merges them over the dictionary with `overwrite = true`.
 * The two can land in either order:
 *
 *   · overlay first, then this chunk — `overwrite: false` keeps every key the
 *     tenant has already overridden and fills in only the ones they have not.
 *   · this chunk first, then the overlay — the overlay's own `true` wins, which
 *     is the behaviour every other `site.*` string already has.
 *
 * Either way the tenant's sentence beats ours and ours beats nothing, which is
 * the rule `site-api.ts` states for the whole model: the dictionary is the
 * DEFAULT, the tenant is the OVERRIDE. Using `true` here would have inverted it
 * for one page, and only for visitors who arrived at that page first.
 *
 * No `emit("languageChanged")`: nothing is mounted yet when this runs. The
 * overlay emits one because it can land under a rendered page; this cannot.
 */
i18n.addResourceBundle("en", "translation", { site: { careers: en } }, true, false);
i18n.addResourceBundle("fr", "translation", { site: { careers: fr } }, true, false);
