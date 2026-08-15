/**
 * R1 — no-unmarked-silent-catch.
 *
 * Every `catch` block whose body is empty or comment-only MUST carry a
 * taxonomy marker inside a block comment in the catch body — one of
 * `@silent:storage`, `@silent:parse`, or `@silent:teardown`. Same rule for
 * `.catch(() => { ... })` / `.catch(() => value)` shapes with a constant
 * no-op body.
 *
 * See doc/ERROR_HANDLING.md — silent handling is class A / B / C, and each
 * has a marker string. Everything else must either produce a toast (class F,
 * G) or record at `notice`/`warning`/`error` via useAction's `onError` opt
 * (class D, E).
 *
 * FALSE-POSITIVE GUARD. A catch that RE-THROWS is not silent (the point of
 * the swallow is to strip a specific message and rethrow; the rethrow is
 * not silence). A catch that calls the reporter or a logger is not silent
 * either — the whole point of the guard is that "did not tell the user"
 * and "did not tell engineering" have to be distinct decisions.
 */
"use strict";

const MARKER_RE = /@silent:(storage|parse|teardown)\b/;

/** True when a statement list resolves to no runtime effect other than a
 *  return/undefined — i.e. it's a swallow. Anything that logs, reports,
 *  rethrows, or calls a method is real handling and this returns false. */
function isSilentBody(body) {
  if (!body || !Array.isArray(body)) return true;
  for (const stmt of body) {
    if (stmt.type === "EmptyStatement") continue;
    if (
      stmt.type === "ReturnStatement" &&
      (stmt.argument === null ||
        (stmt.argument.type === "Identifier" &&
          stmt.argument.name === "undefined"))
    )
      continue;
    // Anything else is not silent.
    return false;
  }
  return true;
}

/** True when the range of comments contains a taxonomy marker. */
function hasMarker(comments) {
  return comments.some((c) => MARKER_RE.test(c.value));
}

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Every silent catch must carry /* @silent:storage|parse|teardown */. See doc/ERROR_HANDLING.md.",
    },
    schema: [],
    messages: {
      needsMarker:
        "This silent catch has no taxonomy marker. Add /* @silent:storage|parse|teardown */ inside the catch body naming the class from doc/ERROR_HANDLING.md, or convert to real handling (toast, throw, or route through useAction's onError).",
    },
  },

  create(context) {
    const source = context.sourceCode || context.getSourceCode();

    function checkBlockBody(node) {
      // node is a BlockStatement (a catch clause's body or a .catch(() => {}) body)
      if (!isSilentBody(node.body)) return;
      // Grab any comments inside the block body (including trailing comments
      // between the last statement and the closing brace).
      const comments = source.getCommentsInside
        ? source.getCommentsInside(node)
        : source
            .getAllComments()
            .filter(
              (c) => c.range[0] > node.range[0] && c.range[1] < node.range[1],
            );
      if (hasMarker(comments)) return;
      context.report({ node, messageId: "needsMarker" });
    }

    return {
      CatchClause(node) {
        checkBlockBody(node.body);
      },

      // `foo.catch(() => { … })` — flag when the body is silent.
      CallExpression(node) {
        if (
          node.callee.type !== "MemberExpression" ||
          node.callee.property.type !== "Identifier" ||
          node.callee.property.name !== "catch"
        )
          return;
        const arg = node.arguments[0];
        if (!arg) return;
        if (
          arg.type === "ArrowFunctionExpression" ||
          arg.type === "FunctionExpression"
        ) {
          // If the arrow returns a value directly (`.catch(() => [])`) that
          // constant IS the swallow — same class as an empty block, so
          // require a marker. Non-constant returns (variable, call) are
          // real handling and we skip.
          if (arg.body.type === "BlockStatement") {
            checkBlockBody(arg.body);
          } else if (
            arg.body.type === "ArrayExpression" ||
            arg.body.type === "ObjectExpression" ||
            arg.body.type === "Literal" ||
            (arg.body.type === "Identifier" && arg.body.name === "undefined")
          ) {
            // Same treatment: look for the marker on adjacent comments.
            const comments = [
              ...source.getCommentsBefore(arg.body),
              ...source.getCommentsAfter(arg.body),
            ];
            if (hasMarker(comments)) return;
            context.report({ node: arg, messageId: "needsMarker" });
          }
        }
      },
    };
  },
};
