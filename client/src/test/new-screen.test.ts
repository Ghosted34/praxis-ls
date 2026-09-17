/**
 * The new-screen generator produces code that passes the gates (Phase 5).
 *
 * WHY THIS TEST AND NOT A README. A scaffold is a template held in a string: it
 * is invisible to `tsc`, invisible to ESLint, and invisible to every other test
 * in the repo. The first time anyone finds out it has gone stale is when a new
 * engineer runs it, gets code that does not compile, and concludes the paved
 * road is broken — which is the exact failure F5 describes, one layer up:
 *
 *   "the documented on-ramp points at a deleted component and a dead one."
 *
 * Phase 2's deliverable made the same point about its own guide: "a 'Build a new
 * screen' guide that is VERIFIED BY A TEST asserting the example compiles and
 * renders." This is that, for the generator.
 *
 * It runs the real script into a temp directory inside `src/features` (the
 * generator resolves its own paths, and the aliases only work from there), type-
 * checks it against the real tsconfig, lints it against the real config, and
 * runs the palette gate over it — then removes it. If a primitive is renamed or
 * `ListPage`'s props change, this fails in the same commit rather than months
 * later in someone else's first hour.
 */
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { rmSync, existsSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const execFileAsync = promisify(execFile);

const clientRoot = join(__dirname, "..", "..");
const AREA = "__scaffold_check__";
const areaDir = join(clientRoot, "src", "features", AREA);
const file = join(areaDir, "widget-orders.tsx");

/**
 * Run a command ASYNCHRONOUSLY and await it — deliberately NOT `execFileSync`.
 *
 * This is the fix for a CI flake that reddened `main` with every test green
 * (runs 1371 and 1387): the client suite exited 1 on a single unhandled error,
 *
 *   [vitest-worker]: Timeout calling "onTaskUpdate"
 *
 * Vitest's worker->main RPC (birpc) has a fixed 60s deadline (DEFAULT_TIMEOUT).
 * The `tsc -b` below takes ~60s, and a SYNCHRONOUS `execFileSync` blocks the
 * worker's event loop for the whole of it — so the ack for an in-flight
 * `onTaskUpdate` can't be processed and that 60s RPC timer fires the instant
 * the loop unfreezes. It was load-dependent (the build crossed 60s only under
 * contention on the runner), which is why it flaked rather than failed every
 * time, and why the run before and after this one were green.
 *
 * An AWAITED `execFile` yields to the event loop while the child runs, so the
 * worker keeps answering RPC throughout the build and the deadline is never
 * reached. The contract is otherwise identical: the promise still rejects on a
 * non-zero exit and the rejection still carries stdout/stderr, so the
 * assertions below change only by being awaited. `maxBuffer` is raised from the
 * 1 MB default so a verbose failure surfaces as itself rather than as a
 * truncated-output error.
 */
function run(cmd: string, args: string[]) {
  return execFileAsync(cmd, args, {
    cwd: clientRoot,
    encoding: "utf8",
    maxBuffer: 10_000_000,
  });
}

/**
 * Run a local dev tool through `node` rather than `npx`.
 *
 * `execFile` does not use a shell, so on Windows it cannot launch `npx` —
 * that is `npx.cmd`, and the lookup fails with ENOENT exactly as `mkdir` did
 * below. Adding `shell: true` would fix the launch and break the arguments:
 * `--name "Widget orders"` would be re-split on the space.
 *
 * The bin scripts are plain JS and always present in an installed tree, so
 * calling them directly is both portable and a process faster than npx.
 */
function runTool(binRelPath: string, args: string[]) {
  return run("node", [join("node_modules", binRelPath), ...args]);
}

/**
 * Clean BEFORE as well as after.
 *
 * `afterAll` alone assumes the previous run got to the end. It does not always:
 * a worker killed by a timeout elsewhere in the suite, a Ctrl-C, a crashed
 * run — any of those leave `src/features/__scaffold_check__/widget-orders.tsx`
 * on disk. From then on EVERY run of this file fails on the first line of the
 * first test with
 *
 *   widget-orders.tsx already exists in src/features/__scaffold_check__.
 *   Pass --force to overwrite.
 *
 * which reads like the generator is broken when the only broken thing is a
 * leftover directory. It also cannot be fixed by re-running — that is the part
 * that costs an afternoon.
 *
 * Deliberately NOT `--force`: the second test asserts that the generator
 * refuses to overwrite, so this file needs the refusal to be real. Clearing the
 * ground first keeps both properties — a known-empty start, and a generator
 * that still says no.
 */
beforeAll(() => rmSync(areaDir, { recursive: true, force: true }));
afterAll(() => rmSync(areaDir, { recursive: true, force: true }));

describe("scripts/new-screen.mjs", () => {
  it("generates a screen, and the generated screen compiles and lints clean", async () => {
    // The generator refuses to write into an area that does not exist, which is
    // a real guard — so create it the way a real feature area is created.
    //
    // `mkdirSync`, not `execFile("mkdir", ["-p", …])`. There is no mkdir
    // BINARY on Windows — it is a cmd.exe builtin — and execFile does not
    // use a shell, so that line could only ever run on Linux and macOS. It
    // failed with `spawnSync mkdir ENOENT` for anyone developing on Windows,
    // and passed in CI, which is the worst combination: a test that is green on
    // the machine nobody reads and red on the machine everybody uses.
    mkdirSync(areaDir, { recursive: true });
    await run("node", [
      "scripts/new-screen.mjs",
      "--area",
      AREA,
      "--name",
      "Widget orders",
    ]);

    expect(existsSync(file), "the generator did not write the file").toBe(true);
    const src = readFileSync(file, "utf8");

    // The eight-item checklist, as it appears in the output.
    expect(src).toContain("<ListPage<Row>"); // 1 — container + width
    expect(src).toContain('width="wide"');
    expect(src).toContain("error={error}"); // 3 — all four states
    expect(src).toContain("loading={loading}");
    expect(src).toContain("empty={{");
    expect(src).toContain("emptyFiltered={{"); // both empties, not one
    expect(src).toContain("<Pill"); // 5/6 — primitives, semantic tone
    expect(src).toContain("<RowActions>");
    expect(src).toContain('label: ""'); // the actions column convention
    expect(src).toContain("errMsg(err)"); // never String(err)

    // TYPECHECK. `tsc -b` covers src, so the generated file is in scope. This is
    // the assertion that catches a renamed prop on ListPage or a moved import.
    await expect(runTool("typescript/bin/tsc", ["-b"])).resolves.toBeDefined();

    // LINT, including jsx-a11y at error — the scaffold must not ship a
    // violation for someone to inherit.
    await expect(
      runTool("eslint/bin/eslint.js", [
        `src/features/${AREA}/widget-orders.tsx`,
      ]),
    ).resolves.toBeDefined();

    // The palette gate scans untracked files too (Phase 4 fixed that), so a
    // scaffold that reached for a raw Tailwind colour would be caught here.
    await expect(
      run("node", ["scripts/check-palette.mjs"]),
    ).resolves.toBeDefined();
  }, 180_000);

  it("refuses to overwrite without --force, and rejects a bad width", async () => {
    // A generator that silently clobbers work is one nobody runs twice.
    await expect(
      run("node", [
        "scripts/new-screen.mjs",
        "--area",
        AREA,
        "--name",
        "Widget orders",
      ]),
    ).rejects.toThrow();
    await expect(
      run("node", [
        "scripts/new-screen.mjs",
        "--area",
        AREA,
        "--name",
        "Other",
        "--width",
        "enormous",
      ]),
    ).rejects.toThrow();
  }, 60_000);

  it("refuses an area that does not exist rather than inventing one", async () => {
    await expect(
      run("node", [
        "scripts/new-screen.mjs",
        "--area",
        "not-a-real-area",
        "--name",
        "X",
      ]),
    ).rejects.toThrow();
  }, 60_000);
});
