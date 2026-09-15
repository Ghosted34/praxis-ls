/**
 * Tests for the require-upload-progress rule.
 *
 * This rule exists because of a miss, and the miss is worth stating: the first
 * upload gate (`no-raw-upload`) banned hand-rolled `<input type="file">` and
 * passed the whole tree — while fourteen `<FileDrop>`s still showed a filename,
 * a spinner and then a tick, with no percentage between them. The gate was
 * green and the defect it was written for was still on screen.
 *
 * So the invalid cases below are the shapes that were actually in the tree, and
 * the valid ones are the two sanctioned fixes plus the bare-spread case that
 * must NOT count — a rule defeated by `{...props}` would look satisfied in
 * review while proving nothing.
 *
 * Run with:  node --test eslint-local-rules/
 */
"use strict";

const test = require("node:test");
const { RuleTester } = require("eslint");
const parser = require("@typescript-eslint/parser");
const rule = require("./require-upload-progress.cjs");

const ruleTester = new RuleTester({
  languageOptions: {
    parser,
    ecmaVersion: 2022,
    sourceType: "module",
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

test("require-upload-progress", () => {
  ruleTester.run("require-upload-progress", rule, {
    valid: [
      // 1 — the intended shape: one engine item supplies all four props.
      {
        code: "const a = <FileDrop {...fileDropProps(upload.items[0])} onPick={p} accept={A} />;",
        filename: "src/features/masterdata/service-type-web-tab.tsx",
      },
      // 2 — an explicit prop, for a site that drives its own state because the
      //     file rides inside a larger request.
      {
        code: "const a = <FileDrop file={cv} uploadProgress={cvProgress} onPick={p} accept={A} />;",
        filename: "src/features/hr/vacancy.tsx",
      },
      // null is a value: "nothing is uploading yet" is a real state.
      {
        code: "const a = <FileDrop uploadProgress={null} onPick={p} accept={A} />;",
        filename: "src/features/hr/vacancy.tsx",
      },
      // FileDrop's own implementation renders it bare.
      {
        code: "const a = <FileDrop onPick={p} accept={A} />;",
        filename: "src/components/ui/file-drop.tsx",
      },
      // Unrelated components are none of this rule's business.
      {
        code: "const a = <ImageUpload profile=\"document\" send={s} />;",
        filename: "src/features/vault/documents.tsx",
      },
      {
        code: "const a = <Input onChange={p} />;",
        filename: "src/features/hr/vacancy.tsx",
      },
    ],

    invalid: [
      // The shape every one of the fourteen had.
      {
        code: "const a = <FileDrop file={f} onPick={setF} accept={A} label=\"Cover\" />;",
        filename: "src/features/masterdata/service-type-web-tab.tsx",
        errors: [{ messageId: "missing" }],
      },
      // uploadSuccess alone is not enough — a tick with nothing before it is
      // precisely the reported defect.
      {
        code: "const a = <FileDrop file={f} uploadSuccess={done} onPick={setF} accept={A} />;",
        filename: "src/features/masterdata/service-type-web-tab.tsx",
        errors: [{ messageId: "missing" }],
      },
      // A BARE SPREAD must not satisfy it: the rule cannot know what is in it,
      // and accepting it would make the gate defeatable by one rename.
      {
        code: "const a = <FileDrop {...props} onPick={p} accept={A} />;",
        filename: "src/features/sales/success-stories.tsx",
        errors: [{ messageId: "missing" }],
      },
      // Nor a spread of some other call.
      {
        code: "const a = <FileDrop {...somethingElse(item)} onPick={p} accept={A} />;",
        filename: "src/features/sales/success-stories.tsx",
        errors: [{ messageId: "missing" }],
      },
      // Several drops in one file each report.
      {
        code: "const a = <><FileDrop onPick={p} accept={A} /><FileDrop onPick={q} accept={A} /></>;",
        filename: "src/features/settings/website-insight-editor.tsx",
        errors: [{ messageId: "missing" }, { messageId: "missing" }],
      },
    ],
  });
});
