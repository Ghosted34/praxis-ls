/**
 * Tests for the no-raw-upload rule.
 *
 * A lint rule's FALSE NEGATIVES are invisible — it reports nothing, the build
 * is green, and the thing it exists to prevent ships anyway. So the cases below
 * are the shapes this rule has to keep catching, and the shapes it must never
 * catch, written from what is actually in the tree.
 *
 * The valid cases matter as much as the invalid ones. `<input type="text">` and
 * `<Input type="file" />`-shaped custom components appear throughout the
 * client, and a rule that reddened those would be turned off within a week.
 *
 * Run with:  node --test eslint-local-rules/
 */
"use strict";

const test = require("node:test");
const { RuleTester } = require("eslint");
const parser = require("@typescript-eslint/parser");
const rule = require("./no-raw-upload.cjs");

const ruleTester = new RuleTester({
  languageOptions: {
    parser,
    ecmaVersion: 2022,
    sourceType: "module",
    parserOptions: { ecmaFeatures: { jsx: true } },
    globals: { document: "readonly", window: "readonly" },
  },
});

test("no-raw-upload", () => {
  ruleTester.run("no-raw-upload", rule, {
    valid: [
      // Other input types are none of this rule's business.
      { code: 'const a = <input type="text" />;', filename: "src/x.tsx" },
      { code: 'const a = <input type="checkbox" />;', filename: "src/x.tsx" },
      { code: "const a = <input type={kind} />;", filename: "src/x.tsx" },

      // The engine's own primitives hold the one real input each.
      {
        code: 'const a = <input type="file" />;',
        filename: "src/components/ui/image-upload.tsx",
      },
      {
        code: 'const a = <input type="file" />;',
        filename: "src/components/ui/file-drop.tsx",
      },
      // public-web's own engine file — that app cannot import the client's, so
      // it holds its own and is exempt by the same path rule.
      {
        code: 'const a = <input type="file" />;',
        filename: "public-web/src/components/ui/file-input.tsx",
      },

      // The sanctioned call site shape.
      {
        code: 'const a = <ImageUpload profile="document" send={send} />;',
        filename: "src/features/vault/documents.tsx",
      },

      // An unrelated `.type =` assignment must not be swept up.
      {
        code: 'el.type = "button";',
        filename: "src/x.tsx",
      },
      {
        code: 'const doc = { type: "file" };',
        filename: "src/x.tsx",
      },
    ],

    invalid: [
      // 1 — the literal attribute.
      {
        code: 'const a = <input type="file" accept="image/*" />;',
        filename: "src/features/hr/contracts.tsx",
        errors: [{ messageId: "banned" }],
      },
      // 2 — the expression container, which is the first rewrite anyone tries
      //     once the literal form is blocked.
      {
        code: 'const a = <input type={"file"} />;',
        filename: "src/features/hr/contracts.tsx",
        errors: [{ messageId: "banned" }],
      },
      // 3 — the imperative picker, which renders nothing and uploads the same
      //     bare bytes.
      {
        code: 'const el = document.createElement("input"); el.type = "file";',
        filename: "src/features/sales/quote-request-forms.tsx",
        errors: [{ messageId: "banned" }],
      },
      // Multiple inputs in one file each report.
      {
        code: 'const a = <><input type="file" /><input type="file" /></>;',
        filename: "src/features/vault/documents.tsx",
        errors: [{ messageId: "banned" }, { messageId: "banned" }],
      },
    ],
  });
});
