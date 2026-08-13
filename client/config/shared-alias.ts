/**
 * How `@praxis/shared` and Zod resolve for the client — in ONE place, imported
 * by both vite.config.ts and vitest.config.ts.
 *
 * WHY THIS FILE EXISTS. The two configs used to carry their own copies of this
 * alias block, and they drifted into disagreeing about what "resolves" means.
 * The result was a shared-schema package that **passed its tests and could not
 * be built** — Vitest transforms `packages/shared` one way, `vite build`
 * another, and only the test path was ever exercised because no routed screen
 * imports the form layer yet. The first screen that did would have broken the
 * production image build. Keeping the rule in one module is what stops the
 * build and the tests disagreeing again.
 *
 * Each config passes its own directory rather than this file deriving one:
 * Vite bundles a config and its local imports into a single file and injects
 * `__dirname` for the CONFIG's location, so a path derived here would silently
 * be wrong by one directory.
 */
import fs from "node:fs";
import path from "node:path";

/**
 * `packages/shared` is CommonJS on purpose — the backend requires it with no
 * build step (see packages/shared/README.md). But Vite only applies CommonJS
 * interop to files matching `build.commonjsOptions.include`, which defaults to
 * `[/node_modules/]`, and packages/shared is *source*, not a dependency.
 *
 * Without this, Rollup treats `module.exports = { common, finalInvoice }` as an
 * ES module with no named exports and the build dies with
 * `"finalInvoice" is not exported by "../packages/shared/index.js"`.
 *
 * `/node_modules/` must stay in the list: overriding `include` replaces the
 * default rather than extending it, and dropping it un-CJS-ifies every
 * dependency in the tree.
 */
/**
 * The package name the client depends on. Declared in client/package.json as a
 * `file:` dependency so npm links it into client/node_modules — which is what
 * lets Vite's dev server pre-bundle it. Without that link the dev server serves
 * `packages/shared/index.js` verbatim, `require()` and `module.exports` intact,
 * and the browser cannot execute it: `build.commonjsOptions` is build-only and
 * does nothing for `npm run dev`.
 */
export const SHARED_PACKAGE = "@praxis/shared";

/**
 * Linked packages are NOT pre-bundled by default — Vite treats them as source.
 * Naming it here makes esbuild convert the CommonJS entry to ESM for dev, the
 * dev-mode counterpart of SHARED_COMMONJS_INCLUDE.
 *
 * `zod` is listed alongside it deliberately. Pre-bundling @praxis/shared on its
 * own INLINES Zod into that bundle, so a screen importing both `zod` and
 * `@shared` gets two Zod instances and `instanceof z.ZodType` is false — the
 * exact breakage the single-instance alias exists to prevent, appearing only in
 * dev where it is hardest to attribute. Optimising both makes esbuild hoist Zod
 * into a chunk they share.
 */
export const SHARED_OPTIMIZE_INCLUDE = [SHARED_PACKAGE, "zod"];

export const SHARED_COMMONJS_INCLUDE = [/node_modules/, /packages[\\/]shared/];

/**
 * The ONE Zod copy the client bundle uses.
 *
 * Both client code (`import { z } from "zod"`) and packages/shared's
 * `require("zod")` go through this alias, so they get the same module instance
 * — which is what makes `instanceof z.ZodType` true across the boundary and
 * stops zodResolver being handed a schema from the "wrong" Zod. Two copies is
 * the failure this prevents, and it is not a theoretical one: the client was
 * briefly on Zod 4 while the API was on 3, and the test suite caught it.
 *
 * Preference order, and why it is a preference rather than a hard path:
 *
 *   1. The repo-root copy — the exact instance the Express API runs with, so a
 *      schema compiled into the bundle and the same schema parsed server-side
 *      cannot drift across a Zod version. This is what CI and the Docker image
 *      use (both install root dependencies for the client build).
 *
 *   2. The client's own copy — `zod` is a real entry in client/package.json, so
 *      a client-only `npm install` has one. This keeps a frontend-only workflow
 *      possible without the root install, which pulls puppeteer, sharp and
 *      argon2 for no frontend benefit.
 *
 * A hardcoded root path was the previous behaviour and it broke the Docker
 * `clientbuild` stage, which runs only `npm install --prefix client`:
 * `Could not load /app/node_modules/zod: ENOENT`. It went unnoticed only
 * because the whole Zod layer was tree-shaken out of a build nothing imported
 * it into.
 */
export type ZodTarget = "bundler" | "node";

/**
 * One declared entry point out of a package.json, by condition.
 *
 * `kind` is `"import"` / `"require"` for the conditional exports map, or
 * `"module"` / `"main"` for the legacy top-level fields. Returns null when the
 * package does not declare that shape, so the caller can fall back to the
 * directory rather than resolving to a path that does not exist.
 */
function readEntry(
  dir: string,
  kind: "import" | "require" | "module" | "main",
): string | null {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(dir, "package.json"), "utf8"),
  ) as {
    main?: string;
    module?: string;
    exports?: { "."?: { import?: string; require?: string } | string };
  };
  if (kind === "main" || kind === "module") return pkg[kind] ?? null;
  const dot = pkg.exports?.["."];
  if (!dot || typeof dot === "string") return null;
  return dot[kind] ?? null;
}

export function resolveZod(clientDir: string, target: ZodTarget): string {
  const candidates = [
    path.resolve(clientDir, "../node_modules/zod"),
    path.resolve(clientDir, "node_modules/zod"),
  ];

  const found = candidates.find((dir) => fs.existsSync(dir));
  if (!found) {
    throw new Error(
      "Cannot resolve a Zod install for the client bundle. Looked in:\n" +
        candidates.map((c) => `  ${c}`).join("\n") +
        "\n\nRun `npm install` at the repo root (preferred — it is the copy the API " +
        "runs with) or `npm install --prefix client`. packages/shared declares zod as " +
        "a PEER dependency on purpose, so it never brings its own second copy.",
    );
  }
  // WHICH ENTRY, and why it differs per toolchain. Zod's exports map has
  // separate `import` (./index.js, ESM) and `require` (./index.cjs, CJS)
  // entries — so "one copy on disk" is NOT the same thing as "one instance".
  //
  //   bundler (vite build / vite dev): pin the ESM entry FILE. A directory
  //     alias lets client code's `import` take ./index.js while
  //     packages/shared's `require("zod")` takes ./index.cjs — two modules, and
  //     `instanceof z.ZodType` false between them. Measured, not assumed: with
  //     a directory alias the probe reported instanceofZodType=false in both
  //     the dev server AND the production build. Pinning the file makes both
  //     sides resolve to the same module and the check passes.
  //
  //   node (Vitest): pin the CJS entry FILE, for the mirror-image reason.
  //
  //     This used to return the DIRECTORY, on the stated grounds that "Vitest
  //     externalises node_modules and loads them through Node, whose exports
  //     map hands BOTH sides ./index.cjs — already one instance". That is not
  //     what Node does, and it is measurable in four lines:
  //
  //       require("zod")        -> zod/index.cjs
  //       await import("zod")   -> zod/index.js
  //       cjs.z.ZodType === esm.z.ZodType   ->   false
  //
  //     The conditional exports map answers `require` with ./index.cjs and
  //     `import` with ./index.js, so a directory alias gives the test file's
  //     `import { z } from "zod"` one module and packages/shared's
  //     `require("zod")` another — two instances, and
  //     form.test.tsx's `toBeInstanceOf(z.ZodType)` false. It held while the
  //     client was on vitest 4, whose loader put both sides through CJS
  //     interop, and stopped when the client was pinned to vitest 3 to match
  //     vite 5. A resolution rule that depends on the runner's interop is a
  //     rule that will break again on the next bump.
  //
  //     Naming ./index.cjs makes it one instance BY CONSTRUCTION, whatever the
  //     runner does: Node's ESM-CJS interop hands an `import` of a .cjs file
  //     the very same module object the CJS cache holds. Also measured —
  //     with both sides on index.cjs, `instanceof` is true.
  if (target === "node") {
    const cjsEntry = readEntry(found, "require") ?? readEntry(found, "main");
    return cjsEntry ? path.resolve(found, cjsEntry) : found;
  }

  const esmEntry = readEntry(found, "import") ?? readEntry(found, "module");
  // No ESM entry declared — a future Zod that ships ESM-only would land here,
  // and the directory is then already unambiguous.
  return esmEntry ? path.resolve(found, esmEntry) : found;
}

/** The `@shared` + `zod` alias pair. `@` stays in each config; it differs per tool. */
export function sharedAlias(
  clientDir: string,
  target: ZodTarget,
): Record<string, string> {
  return {
    // packages/shared — the Zod schemas the Express API validates with, so the
    // client enforces the SAME rules rather than a re-statement of them (F12).
    // Mapped to the PACKAGE NAME, not a relative path: client/package.json
    // declares `"@praxis/shared": "file:../packages/shared"`, so this resolves
    // through node_modules and Vite can pre-bundle it (see SHARED_PACKAGE).
    "@shared": SHARED_PACKAGE,
    zod: resolveZod(clientDir, target),
  };
}
