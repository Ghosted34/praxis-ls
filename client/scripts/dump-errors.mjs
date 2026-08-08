#!/usr/bin/env node
/**
 * Dump all client test + typecheck output to test-errors.txt.
 *
 *   node scripts/dump-errors.mjs
 *
 * Writes client/test-errors.txt. Paste that file back.
 *
 * WHY BOTH. The failing new-screen test runs `tsc -b` in a child process and
 * only reports "Command failed" — the real type errors are on that child's
 * stderr, which the test throws away. So this runs `tsc -b` directly (that is
 * the actual diagnostic) AND the full vitest run, and captures every byte of
 * stdout+stderr from each into one file.
 */
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const clientRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(clientRoot, "test-errors.txt");

function run(label, cmd, args) {
  const r = spawnSync(cmd, args, {
    cwd: clientRoot,
    encoding: "utf8",
    shell: false,
    // Merge stdout+stderr in order isn't possible with spawnSync, so capture both.
  });
  const parts = [
    `\n${"=".repeat(78)}`,
    `## ${label}`,
    `## ran: ${cmd} ${args.join(" ")}`,
    `## exit code: ${r.status}${r.error ? "  (spawn error: " + r.error.message + ")" : ""}`,
    `${"=".repeat(78)}`,
    "--- stdout ---",
    r.stdout || "(empty)",
    "--- stderr ---",
    r.stderr || "(empty)",
  ];
  return parts.join("\n");
}

const sections = [];
sections.push(`Praxis client error dump — ${new Date().toISOString()}`);

// 1. The raw typecheck — THIS is what the new-screen test actually fails on.
sections.push(run("TYPECHECK  (node_modules/typescript/bin/tsc -b)", "node", [join("node_modules", "typescript", "bin", "tsc"), "-b", "--pretty", "false"]));

// 2. The full vitest run, non-watch, no colour.
sections.push(run("VITEST  (vitest run)", "node", [join("node_modules", "vitest", "vitest.mjs"), "run", "--no-color"]));

writeFileSync(out, sections.join("\n") + "\n", "utf8");
console.warn(`\nWrote ${out}\nPaste that file back.\n`);
