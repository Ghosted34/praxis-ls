/**
 * The legacy mail composer and its shadow surfaces are GONE, and this test is
 * the guard that keeps them gone.
 *
 * What was deleted (PR-1B cleanup): `ComposeModal` and the old
 * `ComposeIconButton` that lived in features/comms/mail.tsx, the "Message log"
 * surface (`ThreadsSection` / `ThreadMessage`) that reached it, and
 * `MailboxesSection` under its old name (its UI moved, verbatim, to
 * features/comms/setup/mailboxes.tsx as `ConnectionsTab`). The file
 * features/comms/mail.tsx itself no longer exists; the Mailbox hub tab renders
 * the PR-1 inbox directly.
 *
 * The only compose dialog in the product is NewMessageDialog around the Master
 * Composer; the only thing allowed to carry these names is that composer
 * directory (where the replacement icon-button shim lives) and this test.
 */
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
/** client/src — this file sits two levels below it (features/comms). */
const SRC_ROOT = path.resolve(here, "..", "..");

/** The replacement composer files — the ONLY place the names may survive. */
const COMPOSER_DIR = path.join("features", "comms", "inbox", "composer");
const SHIM_PATH = path.join("inbox/composer/compose-icon-button");

const LEGACY_TOKENS = [
  "ComposeModal",
  "ThreadsSection",
  "ThreadMessage",
  "MailboxesSection",
  "Message log",
];

/** Import specifiers that would drag the deleted module back in. */
const LEGACY_IMPORT =
  /from\s+["'](@\/features\/comms\/mail|\.\.\/mail|\.\/mail)["']/;

/** The legacy composer's send call — the new path is the send queue. */
const SENDMAIL_CALL = /api\.sendMail|sendMail\(/;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe("the legacy mail composer is gone", () => {
  const files = walk(SRC_ROOT).filter(
    (f) => !f.endsWith("mail.legacy-removed.test.tsx"),
  );

  it("features/comms/mail.tsx no longer exists", () => {
    expect(fs.existsSync(path.join(SRC_ROOT, "features/comms/mail.tsx"))).toBe(false);
  });

  it("NEITHER THE COMPOSER NOR THE MESSAGE LOG SURVIVE OUTSIDE THE NEW COMPOSER FILES", () => {
    const violations: string[] = [];
    for (const file of files) {
      const rel = path.relative(SRC_ROOT, file);
      const inComposerDir = rel.startsWith(COMPOSER_DIR + path.sep);
      // Test files may NAME the legacy surfaces in order to assert they are
      // gone (this one, and mail-tab.test.tsx) — naming is not surviving.
      if (/\.test\.(ts|tsx)$/.test(rel)) continue;
      const lines = fs.readFileSync(file, "utf8").split("\n");
      lines.forEach((line, i) => {
        for (const token of LEGACY_TOKENS) {
          if (line.includes(token) && !inComposerDir) {
            violations.push(`${rel}:${i + 1} — "${token}"`);
          }
        }
        // The name ComposeIconButton now belongs to the NEW shim. Outside the
        // composer directory it may only appear as an import OF that shim —
        // never as the legacy component the mail.tsx export used to be.
        if (
          line.includes("ComposeIconButton") &&
          !inComposerDir &&
          !line.includes(SHIM_PATH)
        ) {
          violations.push(`${rel}:${i + 1} — legacy ComposeIconButton`);
        }
      });
    }
    expect(violations, violations.join("\n")).toEqual([]);
  });

  it("nothing imports the deleted module", () => {
    const violations: string[] = [];
    for (const file of files) {
      const rel = path.relative(SRC_ROOT, file);
      const lines = fs.readFileSync(file, "utf8").split("\n");
      lines.forEach((line, i) => {
        if (LEGACY_IMPORT.test(line)) {
          violations.push(`${rel}:${i + 1} — ${line.trim()}`);
        }
      });
    }
    expect(violations, violations.join("\n")).toEqual([]);
  });

  it("no client surface calls the legacy send endpoint directly", () => {
    const violations: string[] = [];
    for (const file of files) {
      const rel = path.relative(SRC_ROOT, file);
      const lines = fs.readFileSync(file, "utf8").split("\n");
      lines.forEach((line, i) => {
        if (SENDMAIL_CALL.test(line)) {
          violations.push(`${rel}:${i + 1} — ${line.trim()}`);
        }
      });
    }
    expect(violations, violations.join("\n")).toEqual([]);
  });
});
