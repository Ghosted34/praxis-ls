/**
 * require-upload-progress — a `<FileDrop>` must show the user a percentage.
 *
 * WHY THIS EXISTS, AND WHY IT IS SEPARATE FROM no-raw-upload.
 *
 * `no-raw-upload` bans a hand-rolled `<input type="file">`, and it works: every
 * such input in the tree is now the upload engine's own. But it is blind to the
 * case that produced the original complaint, because `<FileDrop>` IS the
 * sanctioned primitive — so a site could use it correctly, pass no
 * `uploadProgress`, and lint clean while showing the user a filename, a spinner
 * and then "✓ Upload successful" with nothing in between.
 *
 * That is not hypothetical. `FileDrop` has accepted `uploadProgress` and
 * `uploadSuccess` since the day it was written; of its ten call sites, TWO
 * passed them. Adding the upload engine did not change that number, because
 * nothing failed when a site left them out. This is the rule that fails.
 *
 * WHAT SATISFIES IT:
 *
 *   1. `{...fileDropProps(upload.items[0])}` — the adapter in
 *      components/ui/file-drop.tsx, which supplies the file, the percentage,
 *      the success state and the error from one engine item. This is the
 *      intended shape and the shortest one.
 *   2. an explicit `uploadProgress={…}` attribute, for a site that drives its
 *      own state for a reason.
 *
 * A BARE SPREAD IS NOT ENOUGH. `{...props}` would make this rule trivially
 * defeatable and, worse, would make it *look* satisfied in review. Only a
 * spread of a `fileDropProps(…)` call counts, because that is the one
 * expression whose contents this rule can actually know.
 */
"use strict";

/** The component this rule governs. */
const COMPONENT = "FileDrop";

/** The adapter whose spread supplies the prop. */
const ADAPTER = "fileDropProps";

/** FileDrop's own implementation and its tests may render it bare. */
const ALLOWED = ["components/ui/file-drop.tsx", "components/ui/file-drop.test.tsx"];

function isAllowedFile(filename) {
  const normalised = String(filename || "").replace(/\\/g, "/");
  return ALLOWED.some((suffix) => normalised.endsWith(suffix));
}

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description:
        "A <FileDrop> must report upload progress — spread fileDropProps(item) from the upload engine, or pass uploadProgress explicitly.",
    },
    schema: [],
    messages: {
      missing:
        "This <FileDrop> never shows an upload percentage, so the user sees a filename and then a tick with nothing in between — on a slow connection that is indistinguishable from a frozen screen. Spread `{...fileDropProps(upload.items[0])}` from an `useUpload()` item (components/ui/file-drop.tsx), which supplies the file, the percentage, the success state and the error together — or pass `uploadProgress` explicitly if this site drives its own. See doc/FRONTEND_GUIDE.md §3.13.",
    },
  },

  create(context) {
    const filename = (context.filename || context.getFilename?.() || "").toString();
    if (isAllowedFile(filename)) return {};

    return {
      JSXOpeningElement(node) {
        if (
          node.name.type !== "JSXIdentifier" ||
          node.name.name !== COMPONENT
        ) {
          return;
        }

        for (const attr of node.attributes) {
          // An explicit prop satisfies it.
          if (
            attr.type === "JSXAttribute" &&
            attr.name.type === "JSXIdentifier" &&
            attr.name.name === "uploadProgress"
          ) {
            return;
          }
          // So does a spread of the adapter call — and only that.
          if (
            attr.type === "JSXSpreadAttribute" &&
            attr.argument.type === "CallExpression" &&
            attr.argument.callee.type === "Identifier" &&
            attr.argument.callee.name === ADAPTER
          ) {
            return;
          }
        }

        context.report({ node, messageId: "missing" });
      },
    };
  },
};
