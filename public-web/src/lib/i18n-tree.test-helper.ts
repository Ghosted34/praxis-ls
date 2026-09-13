import { en as baseEn, fr as baseFr } from "./i18n-dict";
import {
  en as careersEn,
  fr as careersFr,
} from "@/features/careers/careers-copy";

/**
 * The whole translation tree as it exists AT RUNTIME — for tests only.
 *
 * ── WHY THIS FILE EXISTS ──────────────────────────────────────────────────
 *
 * `i18n-dict.ts` stopped being the whole dictionary in 13792. `site.careers.*`
 * (~80 keys, reachable only from `/careers`) moved into the careers chunk so
 * that a visitor reading the home page no longer downloads it — the split
 * `check-bundle.mjs` names as the lever to reach for before raising the
 * first-paint budget.
 *
 * The two gates that assert things about "the dictionary" — parity across
 * languages, and that every `t()` call in the source resolves — are about the
 * tree i18next actually holds, which is the union. Reading `i18n-dict.ts` alone
 * would make them report the careers page as ~80 dangling calls; special-casing
 * those keys would make them blind to a real one.
 *
 * ── IT MUST NEVER BE IMPORTED BY APP CODE ─────────────────────────────────
 *
 * Doing so would statically pull the careers copy back into whatever chunk did
 * the importing, which for anything in `lib/` means the entry — undoing the
 * split. That is not merely a convention: `check:bundle` measures the entry's
 * gzipped size against a budget it currently fills 99% of, so an app import of
 * this file reddens a gate rather than passing quietly.
 *
 * A new feature dictionary goes in BOTH here and `FEATURE_DICTS` in
 * `scripts/check-i18n.mjs` — same list, two consumers, and a missing entry
 * shows up as dangling keys in whichever one was forgotten.
 */
export const en = {
  ...baseEn,
  site: { ...baseEn.site, careers: careersEn },
};

export const fr = {
  ...baseFr,
  site: { ...baseFr.site, careers: careersFr },
};
