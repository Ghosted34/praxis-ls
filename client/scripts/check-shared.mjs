#!/usr/bin/env node
/**
 * Gate: prove the BUNDLER can actually consume `@praxis/shared`.
 *
 * WHY THIS EXISTS. The shared-schema package was written, tested and merged
 * without a single routed screen importing it — so it was tree-shaken out of
 * every build and no build ever touched it. It passed its Vitest suite the
 * whole time. When the probe that first pulled it into the graph was written,
 * `vite build` failed three different ways:
 *
 *   1. `"finalInvoice" is not exported by "../packages/shared/index.js"` —
 *      Vite applies CommonJS interop only to `build.commonjsOptions.include`,
 *      which defaults to `[/node_modules/]`, and packages/shared is source.
 *   2. `Could not load .../node_modules/zod: ENOENT` — the zod alias hardcoded
 *      the repo-root copy, which the Docker clientbuild stage does not have.
 *   3. In dev, `import { finalInvoice }` resolved to `undefined` — no bundler
 *      can see named exports through `module.exports = { a, b }`.
 *
 * None of those are visible to `npm test`, because Vitest loads that CommonJS
 * through Node rather than through Rollup. This script closes that gap: it
 * builds a tiny entry that imports the shared schemas and asserts the bundle
 * both resolves them AND ends up with ONE Zod instance.
 *
 * The single-instance assertion is not ceremony. Zod's exports map has separate
 * `import` (./index.js) and `require` (./index.cjs) entries, so client code and
 * packages/shared can each get their own copy from the same install — measured
 * behaviour before the fix, in dev and in the production build alike. When that
 * happens `instanceof z.ZodType` is false, which is what `useZodForm`'s type
 * contract and form.test.tsx both rest on.
 *
 * Usage: node scripts/check-shared.mjs   (npm run check:shared)
 */
import { build, loadConfigFromFile } from "vite";
import { writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const clientDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// Exercises all three failure modes above: a NAMED import from the CJS package,
// a bare `zod` import alongside it, and an identity check between the two.
const PROBE = `
import { z } from "zod";
import { common, finalInvoice } from "@shared";

const checks = {
  namedExportsResolve: Boolean(common && finalInvoice),
  schemaIsUsable: typeof finalInvoice.createDraft?.safeParse === "function",
  oneZodInstance: common.uuid instanceof z.ZodType,
};
globalThis.__sharedProbe = checks;
export default checks;
`;

async function main() {
  // The probe must live INSIDE the client root: `@shared` maps to the bare
  // specifier `@praxis/shared`, which Node resolves relative to the importing
  // file, so a probe in /tmp cannot see client/node_modules at all.
  const entry = path.join(clientDir, ".shared-probe.generated.js");
  await writeFile(entry, PROBE, "utf8");

  let output;
  try {
    // Load the REAL vite.config.ts — the point is to test the shipping resolver
    // config, not a reconstruction of it that could drift from it.
    const loaded = await loadConfigFromFile(
      { command: "build", mode: "production" },
      path.join(clientDir, "vite.config.ts"),
      clientDir,
    );
    if (!loaded) throw new Error("could not load client/vite.config.ts");

    // Drop the PWA plugin only: it demands an index.html and emits a service
    // worker, neither of which a library-mode probe has or wants. Everything
    // that matters here — the aliases, commonjsOptions, optimizeDeps — is config,
    // not plugins, and is kept exactly as shipped.
    const plugins = (loaded.config.plugins ?? [])
      .flat(Infinity)
      .filter((p) => p && !String(p.name ?? "").includes("pwa"));

    const result = await build({
      ...loaded.config,
      configFile: false,
      root: clientDir,
      logLevel: "silent",
      plugins,
      build: {
        ...loaded.config.build,
        write: false,
        lib: { entry, formats: ["es"], fileName: "probe" },
        rollupOptions: {},
      },
    });
    const chunks = Array.isArray(result) ? result[0].output : result.output;
    output = chunks.find((c) => c.type === "chunk").code;
  } catch (err) {
    await rm(entry, { force: true });
    console.error("\u2717 The client bundle cannot consume @praxis/shared.\n");
    console.error(`  ${err.message}\n`);
    console.error(
      "  See client/config/shared-alias.ts — commonjsOptions.include,",
    );
    console.error(
      "  the zod alias target, and the export shape in packages/shared",
    );
    console.error("  are the three things that make this work.");
    process.exit(1);
  }
  await rm(entry, { force: true });

  // Run the built bundle and read back what it observed.
  const mod = await import(
    `data:text/javascript;base64,${Buffer.from(output).toString("base64")}`
  );
  const checks = mod.default;

  const failed = Object.entries(checks).filter(([, ok]) => !ok);
  if (failed.length > 0) {
    console.error("\u2717 @praxis/shared builds, but not correctly:\n");
    for (const [name] of failed) console.error(`    ${name}: FAILED`);
    if (!checks.oneZodInstance) {
      console.error(
        "\n  oneZodInstance means client code and packages/shared were bundled with\n" +
          "  DIFFERENT Zod modules — zod ships separate ESM and CJS entries, so the\n" +
          "  alias must pin one entry file, not the package directory.",
      );
    }
    process.exit(1);
  }

  console.warn(
    `\u2713 @praxis/shared bundles cleanly — ${Object.keys(checks).length} checks, one Zod instance.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
