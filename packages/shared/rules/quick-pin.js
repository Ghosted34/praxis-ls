"use strict";

/**
 * Quick PIN — what a PIN is, and which ones are refused.
 *
 * ── WHY THIS IS IN packages/shared ─────────────────────────────────────────
 *
 * The API refuses a weak PIN at registration and the My security screen tells
 * the user so AS THEY TYPE. Two copies of the list is two lists that disagree,
 * and the visible failure is a screen that accepts `1122` and a server that
 * answers 422 after the button was pressed.
 *
 * ── WHY A BLOCKLIST AT ALL ─────────────────────────────────────────────────
 *
 * A four-digit PIN is a 10,000-code space, and the device binding plus the
 * five-strikes revocation is what makes that acceptable — an attacker holding
 * the device gets five guesses before the PIN is revoked. Five guesses is only
 * a 0.05% chance against a RANDOM PIN. It is a coin toss against a human one:
 * published PIN-frequency studies put `1234`, `1111`, `0000`, `1212` and
 * `7777` alone at roughly a fifth of all real PINs. Refusing the patterns
 * people reach for first is what keeps five guesses meaning five in ten
 * thousand.
 *
 * What is refused, and nothing more (every rule costs the user a retry):
 *
 *   - one digit repeated            0000 1111 … 9999
 *   - a straight run, either way    0123 1234 … 6789, 9876 … 3210
 *   - a pair repeated               1212 2323 1010 6969
 *   - two doubles                   1122 7788 0011
 *   - the few single codes that top every published list beyond those shapes
 */

const PIN_LENGTH = 4;
const PIN_PATTERN = /^\d{4}$/;

const COMMON = new Set(["1004", "2000", "2001", "1998", "1999", "2468", "1357", "4321", "1122"]);

/**
 * Why a PIN is refused, in words a person can act on — or null when it is fine.
 * Shape errors (not four digits) are reported too, so a caller needs one check.
 */
function weakPinReason(pin) {
  const p = pin === null || pin === undefined ? "" : String(pin);
  if (!PIN_PATTERN.test(p)) return `Your PIN must be exactly ${PIN_LENGTH} digits.`;

  const d = p.split("").map(Number);
  if (d.every((x) => x === d[0])) return "A PIN can't be one digit repeated — pick something less guessable.";

  const up = d.every((x, i) => i === 0 || x === d[i - 1] + 1);
  const down = d.every((x, i) => i === 0 || x === d[i - 1] - 1);
  if (up || down) return "A PIN can't be a straight run like 1234 or 9876 — pick something less guessable.";

  if (d[0] === d[2] && d[1] === d[3]) return "A PIN can't be a repeated pair like 1212 — pick something less guessable.";
  if (d[0] === d[1] && d[2] === d[3]) return "A PIN can't be two doubles like 1122 — pick something less guessable.";

  if (COMMON.has(p)) return "That PIN is one of the most commonly used — pick something less guessable.";
  return null;
}

module.exports = { PIN_LENGTH, weakPinReason };
