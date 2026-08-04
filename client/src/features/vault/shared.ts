/**
 * Vault & compliance — the one helper every screen here shares.
 *
 * Split out of `features/vault/pages.tsx` (1,023 lines) in Phase 4, audit F7.
 * It is shared because Reports and Signatures both have to tell two failures
 * apart, and getting that wrong told users to fix the wrong thing (see below).
 */

import { isFeatureDisabled } from "@/lib/use-resource";

/**
 * Is this failure "the tenant does not have this feature", or "you do not have
 * access to it"? Two different problems with two different remedies, and the
 * screen shows a different message for each.
 *
 * This used to regex the error SENTENCE:
 *
 *     /feature|not enabled|disabled|forbidden|permission/i.test(msg)
 *
 * `errMsg` renders every 403 as "You don't have permission to do this.", which
 * matches `/permission/`. So a user missing the reports GRANT was told the
 * tenant's reporting FEATURE was off, and sent to a developer-dashboard toggle
 * that was already on — while the real cause, their role, went unmentioned.
 * Found by the Phase 4 screen axe gate, which renders every screen's 403 state.
 *
 * The backend has always distinguished them (`FEATURE_DISABLED` from
 * middleware/feature-gate.js vs `FORBIDDEN`); the code was simply not reaching
 * the screen. `useList` now returns `errorCode` alongside `error`.
 */
export const isGated = isFeatureDisabled;
