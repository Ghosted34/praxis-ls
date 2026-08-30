/**
 * `discard()` must stop the autosave BEFORE it asks the question.
 *
 * This is a source-level assertion rather than a behavioural one, and that is a
 * deliberate trade rather than laziness: nothing in this repo mounts the real
 * Composer, because TipTap needs a ProseMirror DOM jsdom does not implement
 * (see the header of composer.test.tsx). Driving this race through the real
 * component would mean mounting the editor, faking timers across an awaited
 * dialog and stubbing the draft API — a large, slow test whose failure mode is
 * "TipTap changed" far more often than "somebody moved the clearTimeout".
 * The ordering IS the fix, so the ordering is what gets pinned.
 *
 * THE RACE. `window.confirm` blocked the event loop, so while the question was
 * on screen no timer could fire, and clearing the autosave timer AFTER the
 * answer was sufficient. An awaited dialog blocks nothing. The 1500ms autosave
 * keeps running behind it, and the person who actually reads a destructive
 * warning is precisely the one who outlasts it.
 *
 * Why that is worse than a wasted request: `saveDraft` is an UPSERT. Called
 * with no `email_draft_id` it CREATES a row. `discard()` nulls the id, and a
 * flush that failed against the just-deleted draft puts its payload back on
 * `dirtyRef` to be retried — so the retry writes a brand-new copy of the draft
 * the person just threw away. That is the exact defect the `clearTimeout` was
 * added for, reintroduced by making the dialog asynchronous.
 */
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, "index.tsx"), "utf8");

/** The body of `async function discard()`, up to the next top-level function. */
function discardBody(): string {
  const start = source.indexOf("async function discard()");
  expect(start, "discard() should still exist in the composer").toBeGreaterThan(-1);
  const rest = source.slice(start);
  const next = rest.indexOf("\n  async function ", 1);
  return next === -1 ? rest : rest.slice(0, next);
}

describe("discard() and the autosave timer", () => {
  it("CLEARS THE TIMER BEFORE AWAITING THE CONFIRM, NOT AFTER", () => {
    const body = discardBody();
    const cleared = body.indexOf("clearTimeout");
    const asked = body.indexOf("await confirm(");

    expect(cleared, "discard() must still clear the autosave timer").toBeGreaterThan(-1);
    expect(asked, "discard() must still ask before deleting").toBeGreaterThan(-1);
    expect(
      cleared,
      "clearTimeout must come BEFORE `await confirm(...)`. After it, the 1500ms " +
        "autosave can fire while the dialog is open and recreate the discarded draft.",
    ).toBeLessThan(asked);
  });

  it("re-arms the autosave when the person keeps editing", () => {
    // Clearing the timer up front is only safe if declining puts it back —
    // otherwise "Keep editing" silently turns autosave off for the rest of the
    // session, which trades a rare race for a guaranteed loss of work.
    const body = discardBody();
    expect(body).toMatch(/if \(!ok\) \{[^}]*touch\(\)[^}]*return;[^}]*\}/);
  });

  it("still asks before deleting, and names the action", () => {
    const body = discardBody();
    expect(body).toContain("destructive: true");
    expect(body).toContain('confirmLabel: tr("Discard draft")');
    // Never the browser's own box — that is the whole point of the change.
    expect(body).not.toMatch(/window\.confirm|(?<![.\w])confirm\("/);
  });
});
