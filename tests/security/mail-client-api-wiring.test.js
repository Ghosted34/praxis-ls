/**
 * THE FIFTH SWEEP'S GATE: an endpoint with a client wrapper and no screen.
 *
 * ── THE CLASS ───────────────────────────────────────────────────────────────
 *
 * Four sweeps built four gates, one per kind of declaration that can go
 * unread: tables (`mail-orphan-sweep`), workers and event types
 * (`orphan-wiring-sweep`), send points (`mail-send-point-wiring`), feature
 * flags (`mail-feature-gating`). Every one of them asks its question of
 * `src/`. None of them can see the client, and three features had their last
 * mile missing there:
 *
 *   · §9.2's soft lock — table, service, both routes, the `locked_by_name`
 *     join and the "Marie is writing a reply" bar all shipped, and nothing
 *     ever called `takeThreadLock`. `email_thread_lock` could only ever hold
 *     zero rows, so the collision warning was structurally incapable of
 *     firing. `mail-orphan-sweep` was green throughout: the table IS
 *     referenced by a line of `src/`, which is the only question it asks.
 *   · §9.8's recipient check — `POST /mail/bounces/check` is gated
 *     `requireFeature("mail.composer")`, a route whose own gate names the one
 *     surface it exists for, with a header saying it is "what the composer
 *     calls before a send". No caller. And the Trust tab told the operator, on
 *     screen, that "the composer checks this list before a send".
 *   · §9.1's assignment — "unassigned until someone claims it OR A LEAD
 *     ASSIGNS IT". Claim shipped, assign did not, so a lead could only ask the
 *     person to go and claim it themselves.
 *
 * ── WHAT THIS ASSERTS ───────────────────────────────────────────────────────
 *
 * Every value exported from the mail client API is called from a screen. Not
 * "exists", not "has a route" — called, from `features/`, where a person can
 * reach it.
 *
 * The grandfathered list is the state this gate found, one line of reason
 * each, and it is CAPPED: it can shrink and it cannot grow. An allowance that
 * grows is the gate being routed around (§14.5).
 */
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const CLIENT = path.join(ROOT, "client", "src");
const API_FILES = [
  path.join(CLIENT, "lib", "mail-api.ts"),
  path.join(CLIENT, "lib", "mail-api-work.ts"),
];

/**
 * Wrappers with no screen at the moment this gate landed.
 *
 * Each is a real endpoint. None is a bug on its own — an endpoint ahead of its
 * screen is a normal state for a programme mid-flight. The bug is not knowing
 * which ones those are, which is what let three of them sit next to a UI that
 * claimed they ran.
 */
const GRANDFATHERED = new Map(Object.entries({
  /* Superseded by the 10731 thread model; the screens read threads. */
  listInbox: "superseded by the thread list (10731)",
  listSent: "superseded by the thread list (10731)",
  linkThread: "superseded by binding/, which writes entity_ref on the thread",
  clientTimeline: "superseded by the dossier drawer's Interactions tab",
  /* Duplicates of a wrapper that IS used. */
  microsoftStartUrl: "duplicate of startMicrosoft, which the setup screen uses",
  googleStartUrl: "duplicate of startGoogle, which has no button yet — see below",
  /* Microsoft's button is now on the setup screen, because for a Microsoft 365
   * mailbox OAuth is the ONLY way in: Exchange Online removed Basic auth for
   * IMAP/POP in 2022 and retired it for SMTP AUTH in April 2026. Google's is
   * not, and this is the honest record of that: its restricted mail scopes
   * need a security assessment that runs for weeks, and 12775 split the
   * feature flags so waiting for Google no longer holds Microsoft back. The
   * wrapper and the adapter stay tested; only the button is missing. */
  startGoogle: "Google Workspace is not enabled yet — awaiting restricted-scope verification",
  /* Endpoints ahead of their screen. */
  getDraft: "the Drafts list opens the row it already has, so nothing re-fetches by id",
  deleteLabel: "labels can be created and listed; no delete affordance yet",
  putSetting: "generic settings writer, unused by the comms screens",
  updateSender: "the senders tab is read-only today",
  addCatalogueEntry: "the mailbox catalogue is read-only today",
  toggleCatalogueEntry: "the mailbox catalogue is read-only today",
  accessLog: "the delegated-mailbox audit trail has no screen",
  deliverabilityHistory: "the health tab shows the current verdict, not a history",
  previewSignature: "the signature screens render their own preview",
  acceptSuggestionBatch: "the binding chip accepts one suggestion at a time",
  breakglass: "CEO override is deliberately not a button; §5.9 is a ledgered API path",
  cardReadiness: "action cards carry their readiness in the list payload",
  createFollowup: "the triage bar offers snooze, which is the same row with a preset due date",
  extractAttachment: "OCR is enqueued on ingest; no manual re-run affordance",
  listPendingExtractions: "no extraction-queue screen",
}));

/** Files a caller may live in: a screen, not the API layer and not a test. */
function screenFiles(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules") continue;
      screenFiles(p, acc);
    } else if (/\.tsx?$/.test(e.name) && !/\.(test|spec)\.tsx?$/.test(e.name)) {
      acc.push(p);
    }
  }
  return acc;
}

/** Exported VALUES (not types) from one API module. */
function exportedValues(file) {
  const src = fs.readFileSync(file, "utf8");
  const names = new Set();
  const re = /^export\s+(?:const|(?:async\s+)?function)\s+([A-Za-z0-9_]+)/gm;
  let m;
  while ((m = re.exec(src))) names.add(m[1]);
  return names;
}

const CALLERS = screenFiles(CLIENT)
  .filter((f) => !f.startsWith(path.join(CLIENT, "lib")) && !f.startsWith(path.join(CLIENT, "test")))
  .map((f) => ({ file: path.relative(ROOT, f).replace(/\\/g, "/"), src: fs.readFileSync(f, "utf8") }));

const calledSomewhere = (name) => {
  // `api.foo(`, `work.foo(`, `foo(` after a named import — any of them is a
  // call. Deliberately generous: this gate is about a wrapper NOBODY reaches,
  // and a false accusation costs more than a missed one.
  //
  // The cost of that generosity, stated so nobody mistakes it for coverage: a
  // hook under `features/` counts as a caller, so a wrapper reached only by a
  // hook that no component mounts still passes here. That is precisely the
  // shape §9.2 failed in, one level up — which is why the three call sites
  // below are asserted BY NAME rather than left to this sweep.
  const re = new RegExp(`\\b${name}\\s*\\(`);
  return CALLERS.some((c) => re.test(c.src));
};

const ALL = API_FILES.flatMap((f) => [...exportedValues(f)]);

describe("every mail endpoint with a client wrapper is reachable from a screen", () => {
  test("the API surface is the size we think it is", () => {
    // A sanity floor: if the parse ever silently matches nothing, every other
    // assertion in this file passes vacuously.
    expect(ALL.length).toBeGreaterThan(120);
  });

  test("NO WRAPPER IS CALLED BY NOTHING", () => {
    const unreached = ALL.filter((n) => !GRANDFATHERED.has(n) && !calledSomewhere(n));
    expect(unreached).toEqual([]);
  });

  test("the grandfathered list can only shrink", () => {
    // Its size is the ratchet. Adding a wrapper and parking it here is exactly
    // the move this gate exists to refuse.
    // 23 → 21. `listOutbox` and `discardDraft` came off when `pending.tsx`
    // gave the send queue and the draft list a screen; `listOutbox`'s entry was
    // also WRONG, not merely stale — it read "superseded by the thread list",
    // and the queue is precisely the mail that is NOT in the thread list yet.
    //
    // 21 -> 22, and this one is worth reading rather than waving through, since
    // the ratchet exists to make growth uncomfortable. No wrapper was added and
    // none was parked. `startGoogle` was ALREADY unwired; it counted as used
    // only because a commented-out `api.startGoogle()` sat in mailboxes.tsx,
    // and a commented call is a string this scanner cannot tell from a real
    // one. Wiring Microsoft's button meant deleting that comment block, which
    // removed the fake usage and left the truth behind. The number went up
    // because the count got HONEST — the alternative was keeping dead code
    // around purely to satisfy a gate, which is the failure mode this file is
    // meant to prevent, not an example of it.
    expect(GRANDFATHERED.size).toBeLessThanOrEqual(22);
  });

  test("nothing sits on the list that is now wired", () => {
    const wired = [...GRANDFATHERED.keys()].filter((n) => calledSomewhere(n));
    expect(wired).toEqual([]);
  });

  test("nothing sits on the list that no longer exists", () => {
    const gone = [...GRANDFATHERED.keys()].filter((n) => !ALL.includes(n));
    expect(gone).toEqual([]);
  });
});

/* ── The three call sites this sweep restored ─────────────────────────────── */

const read = (rel) => fs.readFileSync(path.join(CLIENT, rel), "utf8");

describe("§9.2 · the composer takes the soft lock", () => {
  const composer = read("features/comms/inbox/composer/index.tsx");

  test("THE COMPOSER CALLS useThreadLock — the missing call site itself", () => {
    expect(composer).toMatch(/useThreadLock\s*\(/);
    expect(composer).toMatch(/from "\.\.\/work\/use-thread-lock"/);
  });

  test("the lock is taken for a thread and not for a brand-new message", () => {
    // A new message has no thread to lock, and a POST per composer-open on
    // nothing is a request that can only ever 404.
    expect(composer).toMatch(/useThreadLock\(\{\s*threadId,\s*enabled:\s*!!threadId\s*\}\)/);
  });

  test("the hook heartbeats inside the server's lease and releases on unmount", () => {
    const hook = read("features/comms/inbox/work/use-thread-lock.ts");
    expect(hook).toMatch(/setInterval\(/);
    expect(hook).toMatch(/releaseThreadLock\(/);
    // workflow.service's LOCK_SECONDS is 120. A heartbeat that does not divide
    // it several times over drops the lock between beats.
    const ms = Number(/LOCK_HEARTBEAT_MS\s*=\s*([\d_]+)/.exec(hook)[1].replace(/_/g, ""));
    expect(ms).toBeLessThanOrEqual(40_000);
  });

  test("the server still speaks the shape the hook reads", () => {
    const service = fs.readFileSync(
      path.join(ROOT, "src/modules/mail/triage/workflow.service.js"), "utf8",
    );
    expect(service).toMatch(/held_by_other/);
    expect(service).toMatch(/locked_by_name/);
  });
});

describe("§9.8 · the composer checks the recipients", () => {
  const composer = read("features/comms/inbox/composer/index.tsx");

  test("THE COMPOSER CALLS useRecipientHealth", () => {
    expect(composer).toMatch(/useRecipientHealth\s*\(/);
  });

  test("it checks Cc as well as To — a bounce does not care which field it was in", () => {
    expect(composer).toMatch(/splitAddresses\(to\), \.\.\.splitAddresses\(cc\)/);
  });

  test("a hard bounce is named on screen and disables nothing", () => {
    expect(composer).toMatch(/hard-bounced/);
    // §7.3's rule, applied here: the button stays live and carries a reason.
    // `canSend` must not learn about recipient health.
    expect(composer).not.toMatch(/canSend[^\n]*recipients/);
  });

  test("THE TRUST TAB'S CLAIM IS NOW TRUE", () => {
    // "The composer checks this list before a send." It did not, for two PRs.
    // If the caller is ever removed, this sentence becomes a lie again — so
    // the sentence and the call site are pinned together.
    const trust = read("features/comms/setup/trust.tsx");
    expect(trust).toMatch(/composer checks this list before a send/i);
    expect(composer).toMatch(/useRecipientHealth/);
  });

  test("the server no longer answers a broken check with an empty list", () => {
    const service = fs.readFileSync(
      path.join(ROOT, "src/modules/mail/triage/workflow.service.js"), "utf8",
    );
    const fn = service.slice(service.indexOf("const addressStatus"));
    expect(fn.slice(0, 900)).not.toMatch(/\.catch\(\(\)\s*=>\s*\[\]\)/);
  });
});

describe("§9.1 · a lead can hand a thread over", () => {
  test("THE TRIAGE BAR CALLS assignThread", () => {
    const triage = read("features/comms/inbox/work/triage.tsx");
    expect(triage).toMatch(/api\.assignThread\(/);
    // And says what it is, in the words the panel's own header uses.
    expect(triage).toMatch(/Hand over/);
  });
});

/* ── The blind spot this gate had, and what now covers it ─────────────────── */

/**
 * AN ENDPOINT WITH NO WRAPPER AT ALL WAS INVISIBLE HERE.
 *
 * Everything above walks the wrappers in `mail-api.ts` and asks who calls them.
 * That question cannot be asked of an endpoint that has no wrapper — and that
 * is precisely how §H-1's deletion hid: `DELETE /mail/threads/:id` and
 * `POST /mail/folders/empty` were built, retention-aware, ledgered, and told to
 * the mail server so a deleted message would not come back on the next sync.
 * `thread.service` even documents the second as "the Empty Trash the product
 * did not have". Neither had a wrapper, so this file was green while the whole
 * feature was unreachable, Trash accumulated for ever, and §9.6's promise that
 * "deletion of an archived message is blocked in the service layer" protected
 * nothing, because nothing could delete anything.
 *
 * So the question is now asked from the OTHER end as well: every route this
 * module declares has a wrapper, or is named below with a reason. The two
 * directions together are the property that actually matters — a route reaches
 * a screen, and a screen reaches a route.
 */
describe("every mail ROUTE has a client wrapper", () => {
  const ROUTE_DIR = path.join(ROOT, "src", "modules", "mail");

  function routeFiles(dir, acc = []) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) routeFiles(p, acc);
      else if (/\.routes\.js$/.test(e.name)) acc.push(p);
    }
    return acc;
  }

  // Turn a route's params into wildcards, so a wrapper's `${id}` template and
  // a route's `:id` normalise to the same string: `/mail/threads/:id/star`
  // becomes the same shape as `` `/mail/threads/${id}/star` ``.
  // (A line comment, not a block one: the shape contains a star and a slash,
  //  which would close a block comment early.)
  const shape = (basePath, routePath) =>
    `${basePath}${routePath}`.replace(/:[A-Za-z0-9_]+/g, "*").replace(/\/+$/, "") || "/";

  const declared = [];
  for (const file of routeFiles(ROUTE_DIR)) {
    const src = fs.readFileSync(file, "utf8");
    const base = /basePath:\s*"([^"]+)"/.exec(src);
    if (!base) continue;
    for (const m of src.matchAll(
      /router\.(get|post|put|patch|delete)\(\s*"([^"]+)"/g,
    )) {
      declared.push({
        file: path.relative(ROOT, file).replace(/\\/g, "/"),
        method: m[1].toUpperCase(),
        path: shape(base[1], m[2]),
      });
    }
  }

  /**
   * The same normalisation, over every path literal in the API modules.
   *
   * `${…}` is consumed by counting braces rather than by a regex, because the
   * interpolations in this file NEST: `` `/mail/sent${id ? `?identity_id=${id}`
   * : ""}` `` has a template inside a ternary inside a template. A
   * `\$\{[^}]*\}` stops at the first `}` and leaves a fragment that matches
   * nothing, which reads as six perfectly wired routes being orphans.
   */
  function normalise(literal) {
    let out = "";
    for (let i = 0; i < literal.length; i += 1) {
      if (literal[i] === "$" && literal[i + 1] === "{") {
        let depth = 1;
        i += 2;
        while (i < literal.length && depth > 0) {
          if (literal[i] === "{") depth += 1;
          else if (literal[i] === "}") depth -= 1;
          i += 1;
        }
        i -= 1;
        out += "*";
      } else {
        out += literal[i];
      }
    }
    return out
      .replace(/\?.*$/, "")            // a literal query string
      // A trailing `*` NOT after a slash came from a query builder, not a path
      // segment: `/mail/threads${qs(q)}` is the route `/mail/threads`, while
      // `/mail/threads/${id}` is `/mail/threads/*`.
      .replace(/([^/])\*$/, "$1")
      .replace(/\/+$/, "");
  }

  const wrapperPaths = new Set();
  for (const f of API_FILES) {
    const src = fs.readFileSync(f, "utf8");
    for (const m of src.matchAll(/["'`](\/(?:mail|public)\/[^"'`]*)["'`]/g)) {
      wrapperPaths.add(normalise(m[1]));
    }
  }

  /**
   * Routes the mail client does not call, each with the reason.
   *
   * Two kinds, kept apart because they mean different things. The first is
   * "nothing in a browser calls this and nothing should" — a webhook, an OAuth
   * redirect target, a page served outside the app shell. A wrapper for one of
   * those would be the bug.
   *
   * The second is the same admission the wrapper-side `GRANDFATHERED` map
   * makes: an endpoint whose screen has not been built. It is capped for the
   * same reason — an allowance that grows is the gate being routed around.
   */
  const NOT_FOR_THE_CLIENT = new Map(
    Object.entries({
      "/mail/oauth/microsoft/callback": "the provider redirects the browser here; there is nothing to call",
      "/mail/oauth/google/callback": "the provider redirects the browser here",
      "/mail/webhook/microsoft": "Microsoft Graph change notifications",
      "/mail/webhook/google": "Google Pub/Sub push",
      "/public/secure/*": "the public secure-link page — served outside the app shell, to a recipient with no session",
      "/public/secure/*/download": "the same page's download, opened as a plain link",
    }),
  );

  /** Endpoints ahead of their screen. Capped, and it can only shrink. */
  const NO_SCREEN_YET = new Map(
    Object.entries({
      /* The pre-10731 per-MESSAGE surface. `listInbox` / `listSent` are
       * grandfathered on the wrapper side for the same reason: the screens read
       * the thread model now. Still mounted because `email_inbound` survives as
       * a compat view and something outside the client may still read it. */
      "/mail/thread": "superseded by the thread list (10731)",
      "/mail/thread/*": "superseded by GET /mail/threads/:id",
      "/mail/thread/*/read": "superseded by POST /mail/threads/:id/read",
      "/mail/thread/*/reply": "superseded by the composer's POST /mail/send",
      /* Q15's templates are admin-curated and seeded; the screen that edits a
       * template's department default has not been built. Read is wired
       * (`listSignatureTemplates`); only the PATCH is unreachable. */
      "/mail/signature/templates/*": "no template-admin screen: templates are seeded, and only their department default is editable",
    }),
  );

  test("the endpoints-ahead-of-their-screen list can only shrink", () => {
    expect(NO_SCREEN_YET.size).toBeLessThanOrEqual(5);
  });

  test("the route sweep found the routes it thinks it did", () => {
    // A floor, so a broken parse cannot make the assertion below pass vacuously.
    expect(declared.length).toBeGreaterThan(60);
  });

  test("NO ROUTE IS UNREACHABLE FROM THE CLIENT", () => {
    const orphans = declared
      .filter((r) => !NOT_FOR_THE_CLIENT.has(r.path) && !NO_SCREEN_YET.has(r.path))
      .filter((r) => !wrapperPaths.has(r.path))
      .map((r) => `${r.method} ${r.path}  (${r.file})`);

    expect(orphans).toEqual([]);
  });

  test("the two deletion routes that hid here are reachable now", () => {
    // Named rather than left to the sweep, because they are the ones that
    // taught us the sweep was needed.
    expect(wrapperPaths.has("/mail/threads/*")).toBe(true);
    expect(wrapperPaths.has("/mail/folders/empty")).toBe(true);
    const api = fs.readFileSync(API_FILES[0], "utf8");
    expect(api).toMatch(/export const deleteThread/);
    expect(api).toMatch(/export const emptyFolder/);
  });
});
