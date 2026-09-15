/**
 * no-raw-upload — a file picker must come from the upload engine, not from a
 * hand-rolled `<input type="file">`.
 *
 * WHY THIS IS A GATE AND NOT A CONVENTION. The same reason the dialog ban is
 * one: the asymmetry. `<input type="file">` is four characters of thought, and
 * doing it properly is a preview (an object URL somebody has to revoke), a
 * progress percentage (an XHR callback threaded back to a bar), a compression
 * pass, an error state and a retry. Every site that skipped those skipped them
 * because the raw input was closer to hand, not because anyone decided the user
 * did not need a preview.
 *
 * The evidence is in the tree. `FileDrop` has accepted `uploadProgress` and
 * `uploadSuccess` props since the day it was written, and of roughly thirty
 * upload sites in `client/`, TWO passed them. The props existing was not
 * enough. What changes the outcome is the good path being the only one that
 * compiles.
 *
 * WHAT THIS COSTS THE USER when it is skipped:
 *   · no preview — you upload a customs declaration and are shown a filename;
 *     picking the wrong scan is invisible until someone downloads it later;
 *   · no percentage — a 6 MB photo on a corridor connection looks identical to
 *     a frozen screen for forty seconds, so people re-click and double-upload;
 *   · no compression — the original lands in storage and is served back at full
 *     size into a 96px table cell, on every page load, forever.
 *
 * WHAT TO USE INSTEAD:
 *   images / documents  →  <ImageUpload profile="…" send={…}>
 *                          (components/ui/image-upload.tsx)
 *   inside a form with  →  <FileDrop> + useUpload() from lib/use-upload, when
 *   deferred submission     the bytes must not be sent until Save
 *
 * ESCAPE HATCH, deliberately narrow: `eslint-disable-next-line
 * praxis/no-raw-upload` with a written reason beside it, the same shape every
 * other exception in this config uses.
 *
 * DETECTION. Three shapes, because a ban one rewrite defeats teaches the
 * rewrite:
 *   1. a literal JSX attribute          <input type="file">
 *   2. a JSX expression container       <input type={"file"} />
 *   3. an imperative DOM construction   el.type = "file" after createElement,
 *      and createElement("input") followed by a "file" type assignment
 *
 * The engine's own primitives are exempt by PATH — they are the implementation
 * the rule points everyone at, and they must contain exactly one real input.
 */
"use strict";

/**
 * Files allowed to contain a raw file input: the engine itself, in each app.
 *
 * `file-input.tsx` is public-web's equivalent — that app cannot import the
 * client's engine (it installs only its own dependencies in CI), so it holds
 * its own `FileInput`/`FilePicker` pair and this is the one file in it allowed
 * to own the element.
 */
const ALLOWED = [
  "components/ui/image-upload.tsx",
  "components/ui/file-drop.tsx",
  "components/ui/file-upload.tsx",
  "components/ui/file-input.tsx",
];

function isAllowedFile(filename) {
  const normalised = String(filename || "").replace(/\\/g, "/");
  return ALLOWED.some((suffix) => normalised.endsWith(suffix));
}

/** The string value of a JSX attribute, whether literal or a simple expression. */
function attrStringValue(attr) {
  if (!attr || !attr.value) return null;
  if (attr.value.type === "Literal") {
    return typeof attr.value.value === "string" ? attr.value.value : null;
  }
  if (
    attr.value.type === "JSXExpressionContainer" &&
    attr.value.expression.type === "Literal" &&
    typeof attr.value.expression.value === "string"
  ) {
    return attr.value.expression.value;
  }
  return null;
}

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description:
        "A raw <input type=\"file\"> ships without a preview, an upload percentage or compression — use <ImageUpload> or useUpload() from the upload engine.",
    },
    schema: [],
    messages: {
      banned:
        "A raw file input has no preview, no upload percentage and no compression — the three things every upload in this product is supposed to have. In client/ and platform-console/ use <ImageUpload profile=\"…\" send={…}>, or <FilePicker> + <UploadList> + useUpload() when the bytes must wait for Save; in public-web/ use <FileInput> or <FilePicker> from components/ui/file-input. See doc/FRONTEND_GUIDE.md §3.13. If this is genuinely the exception, add `eslint-disable-next-line praxis/no-raw-upload` with a written reason.",
    },
  },

  create(context) {
    const filename =
      (context.filename || context.getFilename?.() || "").toString();
    if (isAllowedFile(filename)) return {};

    return {
      /** 1 and 2: <input type="file"> in either attribute form. */
      JSXOpeningElement(node) {
        if (
          node.name.type !== "JSXIdentifier" ||
          node.name.name !== "input"
        ) {
          return;
        }
        for (const attr of node.attributes) {
          if (
            attr.type === "JSXAttribute" &&
            attr.name.type === "JSXIdentifier" &&
            attr.name.name === "type" &&
            attrStringValue(attr) === "file"
          ) {
            context.report({ node: attr, messageId: "banned" });
          }
        }
      },

      /**
       * 3: the imperative escape. `const el = document.createElement("input");
       * el.type = "file";` is the standard way to open a picker without
       * rendering one, and it produces exactly the same bare upload.
       */
      AssignmentExpression(node) {
        const { left, right } = node;
        if (
          left.type === "MemberExpression" &&
          !left.computed &&
          left.property.type === "Identifier" &&
          left.property.name === "type" &&
          right.type === "Literal" &&
          right.value === "file"
        ) {
          context.report({ node, messageId: "banned" });
        }
      },
    };
  },
};
