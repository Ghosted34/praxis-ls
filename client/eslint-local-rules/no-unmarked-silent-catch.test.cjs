/**
 * The calls folder carries no unmarked silent catch (doc/ERROR_HANDLING.md).
 *
 * The rule is a warning tree-wide, so a new unmarked catch does not fail
 * `npm run lint`; PR-2's `call-upload-outbox.ts` shipped one. This holds the
 * call engine's folder at zero, through the project's own ESLint config.
 *
 * Run with:  node --test eslint-local-rules/
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const { ESLint } = require("eslint");

test("no unmarked silent catch in src/features/comms/call", async () => {
  const eslint = new ESLint({ cwd: path.resolve(__dirname, "..") });
  const results = await eslint.lintFiles(["src/features/comms/call/*.ts"]);
  const hits = results.flatMap((r) =>
    r.messages
      .filter((m) => m.ruleId === "praxis/no-unmarked-silent-catch")
      .map((m) => `${path.relative(process.cwd(), r.filePath)}:${m.line}`),
  );
  assert.deepStrictEqual(hits, []);
});
