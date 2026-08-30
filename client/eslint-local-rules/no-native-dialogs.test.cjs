/**
 * Tests for the no-native-dialogs rule.
 *
 * A lint rule is the one kind of code whose FALSE NEGATIVES are invisible: it
 * reports nothing, the build is green, and the thing it was written to prevent
 * ships anyway. That is not hypothetical here — the first draft of this rule
 * passed the whole tree and looked correct, while silently missing every bare
 * `alert(…)` and `confirm(…)` in it. The cause is the case pinned below as
 * "bare alert": globals declared through `languageOptions.globals` appear in
 * ESLint's scope `variables` exactly like source declarations, so the
 * "is this locally shadowed?" guard treated every global call as shadowed. Only
 * `defs.length` separates the two.
 *
 * So the negative cases here are not padding. Each is a shape that exists in
 * this codebase and MUST keep linting clean, and each is a way the rule could
 * be "fixed" into uselessness:
 *
 *   operations/place-picker.tsx  `async function confirm(...)`  — a real local
 *   finance/statements.tsx       `async function confirm()`     — another
 *   ui/dialog.tsx                `onConfirm` / `<ConfirmDialog>` — JSX props
 *
 * Run with:  node --test eslint-local-rules/
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert");
const { RuleTester } = require("eslint");
const parser = require("@typescript-eslint/parser");
const rule = require("./no-native-dialogs.cjs");

const ruleTester = new RuleTester({
  languageOptions: {
    parser,
    ecmaVersion: 2022,
    sourceType: "module",
    parserOptions: { ecmaFeatures: { jsx: true } },
    globals: {
      alert: "readonly",
      confirm: "readonly",
      prompt: "readonly",
      window: "readonly",
      globalThis: "readonly",
      self: "readonly",
    },
  },
});

test("no-native-dialogs", () => {
  ruleTester.run("no-native-dialogs", rule, {
    valid: [
      // A locally declared function that happens to be called `confirm`.
      // Both of these shapes are live in the tree today.
      { code: `async function confirm(a) { return a; }\nconfirm(1);` },
      { code: `const confirm = () => {};\nconfirm();` },
      // A method on something that is not the global object.
      { code: `api.confirm({ id: 1 });` },
      { code: `stage.suggestion.confirm();` },
      // An import that shadows the global name.
      { code: `import { confirm } from "./x";\nconfirm();` },
      // A parameter.
      { code: `function f(confirm) { confirm(); }` },
      // The design-system replacements must never trip the rule.
      { code: `const x = <ConfirmDialog onConfirm={() => {}} />;` },
      { code: `const x = <Dialog onClose={close} title="Discard draft?" />;` },
      // Destructuring something that is NOT a host object stays clean.
      { code: `const { confirm } = api;\nconfirm();` },
      // A computed access with a non-banned key.
      { code: `window["scrollTo"](0, 0);` },
    ],

    invalid: [
      // ── the bare globals: the class the first draft missed entirely ──
      {
        code: `alert("saved");`,
        errors: [{ messageId: "banned" }],
      },
      {
        code: `if (confirm("sure?")) { go(); }`,
        errors: [{ messageId: "banned" }],
      },
      {
        code: `const why = prompt("Reason?");`,
        errors: [{ messageId: "banned" }],
      },
      // ── the explicit member forms ──
      { code: `window.confirm("x");`, errors: [{ messageId: "banned" }] },
      { code: `window.alert(msg);`, errors: [{ messageId: "banned" }] },
      { code: `window.prompt("Link to:");`, errors: [{ messageId: "banned" }] },
      { code: `globalThis.alert("x");`, errors: [{ messageId: "banned" }] },
      { code: `self.confirm("x");`, errors: [{ messageId: "banned" }] },
      // Inside a catch, which is where alert() usually hides.
      {
        code: `try { go(); } catch (e) { alert(String(e)); }`,
        errors: [{ messageId: "banned" }],
      },
      // Negated, the most common confirm shape in this codebase.
      {
        code: `if (!window.confirm("Archive?")) return;`,
        errors: [{ messageId: "banned" }],
      },
      // Two on one line still report twice.
      {
        code: `const a = prompt("a"); const b = prompt("b");`,
        errors: [{ messageId: "banned" }, { messageId: "banned" }],
      },

      /* ── the three bypasses, each of which USED TO PASS ──────────────────
       *
       * These are not defensive padding. Every one of them opens the same
       * browser dialog the rule exists to remove, and every one of them was
       * green against the first version of the rule. The alias was even pinned
       * as a VALID case ("a property access that is not a call"), which is how
       * a gate ends up documenting its own hole: the access is not the dialog,
       * but it is the only part of the dialog a rule can still see.
       */

      // ALIAS. `ask` is a local binding, so the bare-identifier branch skips
      // it by design; the member access is where this has to be caught.
      {
        code: `const ask = window.confirm;\nif (ask("Archive?")) go();`,
        errors: [{ messageId: "banned" }],
      },
      // COMPUTED. The first rewrite anyone tries once the dotted form is red.
      {
        code: `window["confirm"]("Archive?");`,
        errors: [{ messageId: "banned" }],
      },
      { code: `globalThis["alert"](msg);`, errors: [{ messageId: "banned" }] },
      // DESTRUCTURING. Turns a banned member into an innocent identifier.
      {
        code: `const { confirm } = window;\nconfirm("x");`,
        errors: [{ messageId: "banned" }],
      },
      {
        code: `const { alert, prompt } = window;`,
        errors: [{ messageId: "banned" }, { messageId: "banned" }],
      },
      // MONKEY-PATCHING the global is not "removing the popup" either.
      {
        code: `window.confirm = myBrandedConfirm;`,
        errors: [{ messageId: "banned" }],
      },
    ],
  });

  assert.ok(true, "RuleTester assertions all passed");
});

test("the message names a concrete replacement per dialog kind", () => {
  const { Linter } = require("eslint");
  const linter = new Linter({ configType: "flat" });
  const config = [
    {
      files: ["**/*.tsx"],
      languageOptions: {
        parser,
        parserOptions: { ecmaFeatures: { jsx: true } },
        globals: { alert: "readonly", confirm: "readonly", prompt: "readonly" },
      },
      plugins: { praxis: { rules: { "no-native-dialogs": rule } } },
      rules: { "praxis/no-native-dialogs": "error" },
    },
  ];
  const msg = (code) =>
    linter.verify(code, config, "t.tsx").find((m) => m.ruleId)?.message ?? "";

  // The remedy has to be in the message. A rule that says "don't" without
  // saying "do this instead" gets disabled rather than obeyed.
  assert.match(msg(`confirm("x");`), /ConfirmDialog/);
  assert.match(msg(`alert("x");`), /Callout|useToast/);
  // The remedy must name something that EXISTS. `<Toast>` was in this message
  // and is not an export — the API is the `useToast()` hook — which is the same
  // class of defect (a doc naming a component that isn't there) that
  // client/scripts/check-docs.mjs exists to make impossible.
  assert.doesNotMatch(msg(`alert("x");`), /<Toast>/);
  assert.match(msg(`prompt("x");`), /Dialog.*Field|Field.*Input/);
});
