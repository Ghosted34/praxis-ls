/**
 * THE MAIL API SENDS OBJECTS, NOT STRINGS.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 *
 * Thirty-three writes in `mail-api.ts` were written as
 *
 *     tenant(path, { method: "POST", body: JSON.stringify(payload) })
 *
 * `api-client.ts` already does `JSON.stringify(body)` before it calls `fetch`.
 * So the server received a JSON *string literal* — `"\"{\\\"on\\\":true}\""` —
 * and Express's json parser, which runs `strict: true` by default and accepts
 * only an object or an array at the top level, rejected it with a 400 before it
 * reached any route.
 *
 * Every one of those calls was broken: starring a thread, moving it, labelling
 * it, creating a label, saving a draft, uploading an attachment, SENDING A
 * MESSAGE, running a slash command, the whole PR-3/4/5 surface. Nothing in the
 * type system objected, because `Opts["body"]` is `unknown` and a string is a
 * perfectly good `unknown`.
 *
 * ── WHY IT SURVIVED ────────────────────────────────────────────────────────
 *
 * The rest of the file — the older half — always used `body: payload`. The two
 * conventions sat side by side, and the broken one was written by someone
 * holding `fetch`'s signature in their head rather than this codebase's
 * wrapper. Both read as obviously correct in isolation.
 *
 * ── WHY IT IS A LINT TEST AND NOT A BEHAVIOUR TEST ─────────────────────────
 *
 * A behaviour test would need every one of the ~90 exported functions called
 * with a plausible payload, and would still only cover the ones somebody
 * remembered to add. Reading the source catches the next one on the day it is
 * written, which is the only time the fix is cheap.
 *
 * The symptom this prevents is also worth naming: a 400 with no server-side log
 * line, on every write in one feature area, reads as "the backend is broken"
 * and sends whoever hits it to the wrong half of the stack for an afternoon.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const FILES = ["mail-api.ts", "mail-api-work.ts"];
/**
 * Comments stripped before scanning. Both files DESCRIBE the anti-pattern in
 * their headers — this one does too — and a gate that cannot tell an example
 * from an instance fires on its own documentation.
 */
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const sources = FILES.map((f) => ({
  f,
  src: readFileSync(resolve(HERE, f), "utf8"),
  code: strip(readFileSync(resolve(HERE, f), "utf8")),
}));

describe("the mail API hands api-client an object", () => {
  it.each(FILES)("%s never double-encodes a request body", (f) => {
    const { code } = sources.find((s) => s.f === f)!;
    const offenders = code.match(/body:\s*JSON\.stringify\(/g) || [];
    expect(offenders).toEqual([]);
  });

  it("api-client is still the thing that stringifies", () => {
    const client = readFileSync(resolve(HERE, "api-client.ts"), "utf8");
    // If this ever stops being true the rule above inverts, and this test is
    // what makes that a failure rather than a silent second breakage.
    expect(client).toMatch(/body:\s*body === undefined \? undefined : JSON\.stringify\(body\)/);
  });

  it("every write declares a method", () => {
    for (const { f, code: src } of sources) {
      // A `body` with no `method` is a GET with a payload — silently dropped by
      // fetch, and the endpoint answers as though nothing was sent.
      const calls = src.match(/tenant<[^>]*>?\([^)]*\{[^}]*body:[^}]*\}/g) || [];
      for (const c of calls) {
        expect(`${f}: ${c}`).toMatch(/method:/);
      }
    }
  });
});

describe("the PR-3/4/5 surface matches the routes it calls", () => {
  const { src } = sources.find((s) => s.f === "mail-api-work.ts")!;

  it.each([
    ["/mail/threads/${threadId}/suggestions", "listSuggestions"],
    ["/mail/threads/${threadId}/cards", "listCards"],
    ["/mail/threads/${threadId}/convert", "convertPreview"],
    ["/mail/threads/${threadId}/intake", "listIntake"],
    ["/mail/assist/draft", "assistDraft"],
    ["/mail/assist/rewrite", "assistRewrite"],
    ["/mail/assist/translate", "assistTranslate"],
    ["/mail/assist/summary", "assistSummary"],
    ["/mail/assist/voice", "assistVoice"],
    ["/mail/assist/search", "assistSearch"],
    ["/mail/sla-policies", "listSlaPolicies"],
    ["/mail/verified-domains", "listVerifiedDomains"],
    ["/mail/bounces", "listBounces"],
    ["/mail/archive/verify", "verifyArchive"],
  ])("%s is reachable via %s", (path, fn) => {
    expect(src).toContain(path);
    expect(src).toMatch(new RegExp(`export const ${fn}\\b`));
  });

  it("the summary is a POST, because a cache miss spends money", () => {
    // A GET that can bill the tenant is a GET a proxy, a prefetcher or a retry
    // will bill them for twice.
    const block = src.slice(src.indexOf("export const assistSummary"));
    expect(block.slice(0, 300)).toMatch(/method: "POST"/);
  });

  it("secure-link minting does not pretend the token is recoverable", () => {
    // Only the SHA-256 is stored. Anything named `getSecureLinkToken` would be
    // a function that cannot work, and someone will build a "copy the link
    // again" button on top of it.
    expect(src).not.toMatch(/getSecureLinkToken|secureLinkToken\(/);
    expect(src).toMatch(/token comes back EXACTLY ONCE|EXACTLY ONCE/i);
  });
});
