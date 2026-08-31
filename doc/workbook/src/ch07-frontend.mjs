import {
  page, band, h1, h2, lead, callout, val, bl, req, dod, chips, lete,
  rgroup, cards, flow, table, stack, liaison, cmd, ex, quiz,
  setChapter,
} from "./kit.mjs";

const F = (s) => `CHAPTER 7 &mdash; THE FRONT END &nbsp;&middot;&nbsp; ${s}`;

export function chapter() {
  setChapter(7);
  const out = [];

  out.push(page("", F("THE PAVED ROAD"), [
    band("07", "The Front End", "WEEK 3 &middot; <b>TEACH + BUILD</b> &middot; ~8 HOURS &middot; <b>FULL-STACK STARTS HERE</b>"),
    lead("React 18 + Vite + TypeScript, shipped as a PWA, white-labelled per tenant. If you have never written React, this is the chapter you were worried about. It will be fine &mdash; because this codebase has a <i>paved road</i>, and the road exists because of a failure worth studying first."),

    h2("Finding F5 &mdash; the root cause of everything else"),
    val("<code>doc/FE_DESIGN_RULES.md</code> told every new engineer that &ldquo;the default list screen is <code>&lt;ResourceList&gt;</code>&rdquo; and that &ldquo;write-capable lists use <code>&lt;CrudResource&gt;</code>&rdquo;. <strong><code>crud-resource.tsx</code> never existed. <code>resource-list.tsx</code> existed with zero call sites.</strong>"),

    flow([
      { t: "THE DOC", b: "pointed at a deleted component and a dead one" },
      { t: "SO", b: "every screen hand-rolled its own list + form" },
      { t: "RESULT", b: "<b>24 feature areas each paved their own road</b>" },
      { t: "AND", b: "that is the cause of most other findings in the audit" },
    ]),

    callout("<strong>Read that chain again, because it is a management lesson as much as a technical one.</strong> A single stale sentence in a document produced two dozen divergent implementations, and every downstream inconsistency &mdash; five loading idioms, 28 ad-hoc &ldquo;Loading&hellip;&rdquo; strings, 11 screens with no empty state &mdash; traces back to it. <b>A documented path that does not work is worse than no documentation</b>, because it consumes the good faith of everyone who follows it.", "red"),

    h2("What the audit found downstream"),
    table("mst", ["Finding", "The symptom"], [
      ["F3", "No agreed page width; every screen chose its own container"],
      ["F8", "Pagination reimplemented per screen, or missing where the endpoint pages"],
      ["F10", "<b>Five different loading idioms</b> and 28 ad-hoc &ldquo;Loading&hellip;&rdquo; strings"],
      ["F11", "<b>11 screens with no empty state at all</b> &mdash; a blank rectangle"],
      ["F12", "The client re-implemented validation as ad-hoc booleans, disagreeing with the API"],
      ["F13", "No consistent header, <code>&lt;h1&gt;</code> or primary-action placement"],
    ]),

    h2("The response: build the road, then build the on-ramp"),
    lete([
      ["1&ndash;4", "<b>Phases 1&ndash;4 built the road</b> &mdash; <code>ListPage</code>, <code>Form</code>, the design tokens, and the CI gates that keep them honest."],
      ["5", "<b>Phase 5 built the on-ramp</b> &mdash; <code>npm run new:screen</code>. Its header says it exactly: &ldquo;the thing that makes the paved road the path of least resistance rather than the path you take after reading a document.&rdquo;"],
    ]),

    callout("<strong>That is the whole philosophy.</strong> You do not get consistency by writing rules; you get it by making the correct thing the easiest thing. Every time you are tempted to write a convention document, ask first whether you could write a generator, a gate, or a component instead.", "green"),
  ].join("\n")));

  // ------------------------------------------------------- ListPage
  out.push(page("", F("&lt;ListPage&gt;"), [
    h1("<code>&lt;ListPage&gt;</code> &mdash; What It Owns"),
    lead("One component, composed once, so that a screen author stops re-deciding six things that have a correct answer."),

    h2("It owns"),
    bl([
      "<b>The page container and its width</b> (F3) &mdash; <code>wide</code>, <code>standard</code>, <code>reading</code>, <code>full</code>.",
      "<b>The header</b>, its <code>&lt;h1&gt;</code> and its primary action (F13).",
      "<b>All four states</b> &mdash; loading, error, empty, populated &mdash; routed to the right primitive every time (F10, F11).",
      "<b>The toolbar slot</b>, so filters sit in the same place on every screen.",
      "<b>Pagination</b>, when the endpoint pages (F8).",
    ]),

    h2("It deliberately does not own"),
    callout("<strong>Data fetching and forms.</strong> It takes a <code>useList</code> result rather than a path, &ldquo;because half the list screens in this app derive their rows &mdash; filtering, joining an id&rarr;name map, merging two endpoints &mdash; and <b>a component that fetched for them would be immediately escaped</b>.&rdquo; The header goes further: <code>&lt;CrudResource&gt;</code>'s promise of a declarative <code>fields</code> spec &ldquo;is exactly the abstraction that was documented, never built, and would not have fitted these screens.&rdquo;", "gold"),

    val("<strong>An abstraction that people escape is worse than no abstraction.</strong> It costs you the learning curve <i>and</i> the inconsistency, because now you have the framework's way, the escaped way, and an argument about which is correct. Design for the eighty percent and leave a clean exit for the rest."),

  ].join("\n")));

  out.push(page("", F("&lt;LISTPAGE&gt; &mdash; IN USE"), [
    h1("A Whole Screen, In One Component"),
    lead("This is a complete, production-shaped list screen. Read it and count what you did not have to decide."),

    cmd(`export function ClientsPage() {
  const { rows, error, loading, reload } = useList<Client>("/clients");
  const [q, setQ] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const shown = React.useMemo(
    () => (rows ?? []).filter((r) => r.name.toLowerCase().includes(q.toLowerCase())),
    [rows, q],
  );

  return (
    <ListPage
      title="Clients"
      description="Every party you invoice. Credit limits come from the master record."
      action={<Button onClick={() => setOpen(true)}>New client</Button>}
      toolbar={<Input value={q} onChange={(e) => setQ(e.target.value)}
                      placeholder="Search clients…" className="max-w-xs" />}
      columns={columns}
      rows={shown}
      error={error}
      loading={loading}
      rowKey={(r) => r.client_id}
      empty="No clients yet."
      emptyFiltered="No clients match that search."
    />
  );
}`),

    h2("The two empty states"),
    callout("<strong><code>empty</code> and <code>emptyFiltered</code> are separate props, and both are required.</strong> &ldquo;No clients yet&rdquo; invites you to create one. &ldquo;No clients match that search&rdquo; tells you to clear the filter. Showing the first when the second is true is how a user concludes their data has been deleted. Two words of copy, one support ticket avoided &mdash; <b>and making it a required prop is what guarantees the author thinks about it</b>.", "green"),

    quiz("Why does <code>ListPage</code> take <code>rows</code> rather than a path to fetch?",
      ["To keep the component synchronous",
       "Because half these screens derive their rows — filtering, joining, merging endpoints — so a fetching component would be escaped immediately, exactly as its predecessor was",
       "Because fetching in components is an anti-pattern",
       "For testability"],
      1,
      "The header names the precedent by file: a fetching scaffold was documented, one was built with zero call sites, and both are gone. The component draws its boundary at the point where screens genuinely agree &mdash; layout and states &mdash; and stops before the point where they genuinely differ."),
  ].join("\n")));

  // ------------------------------------------------------- forms
  out.push(page("", F("FORMS &amp; THE SHARED SCHEMA"), [
    h1("Forms &mdash; One Schema, Two Sides"),
    lead("The most valuable idea in the front end, and the direct answer to finding F12."),

    h2("F12 &mdash; the client disagreeing with the API"),
    val("&ldquo;The client used to re-implement the rules as ad-hoc booleans &mdash; e.g. <code>finance/pages.tsx:141</code>'s <code>canSubmit</code>.&rdquo; Two definitions of valid, in two languages, maintained by two people. They diverge on the first change, and the user finds out by having a form accepted and then rejected."),

    h2("The fix: <code>packages/shared</code>"),
    flow([
      { t: "packages/shared", b: "the Zod schema, written once" },
      { t: "API", b: "imports it to validate the request body" },
      { t: "CLIENT", b: "imports it via <code>useZodForm</code>" },
      { t: "RESULT", b: "they <b>cannot</b> disagree" },
    ]),

    cmd(`export function useZodForm<TSchema extends z.ZodType<FieldValues>>(
  schema: TSchema,
  options?: Omit<UseFormProps<z.input<TSchema>>, "resolver">,
) {
  return useForm<z.input<TSchema>>({
    resolver: zodResolver(schema),
    mode: "onTouched",     // ← see below
    ...options,
  });
}`),

    h2("<code>mode: \"onTouched\"</code>, and why not <code>onChange</code>"),
    callout("Straight from the source: it &ldquo;validates on <b>submit</b>, then re-validates a field as the user <b>leaves</b> it. Not onChange: <b>telling someone their date is malformed while they are still typing it is the single most disliked form behaviour there is.</b>&rdquo; A one-word config option, a real decision about how it feels to use the software, and a comment so the next person does not innocently &lsquo;improve&rsquo; it.", "gold"),

    h2("Two CI gates protect this"),
    table("mst", ["Gate", "What it checks"], [
      ["<b>Shared schema package</b>", "The package builds and its exports resolve from both sides."],
      ["<b>Shared-schema gate</b>", "The client is not re-implementing validation the shared package already defines &mdash; F12 cannot come back quietly."],
    ]),

    h2("The form primitives"),
    stack([
      ["<code>&lt;Form&gt;</code>", "The provider; wires the <code>useZodForm</code> instance."],
      ["<code>&lt;FormField&gt;</code>", "Label, input, description and error, in the right order, with the right <code>aria-</code> wiring."],
      ["<code>&lt;FormError&gt;</code>", "Field-level errors, populated from the API's <code>fields</code> object on a 422."],
      ["<code>&lt;FormButtons&gt;</code>", "Submit and cancel, consistently placed, with the disabled-while-submitting behaviour done once."],
      ["<code>&lt;Dialog&gt;</code>", "Writes happen in a dialog over the list, not on a separate route &mdash; so context is never lost."],
    ]),

    callout("<strong>Notice the loop closing.</strong> The API returns 422 with <code>fields</code> because <code>lead.validator.js</code> passes <code>p.error.flatten().fieldErrors</code> through. <code>&lt;FormError&gt;</code> exists to render exactly that. The two ends of a design decision made in Chapter 3 finally meet here &mdash; <b>this is what &ldquo;full-stack&rdquo; actually means</b>: seeing the whole arc of one idea.", "green"),
  ].join("\n")));

  // ------------------------------------------------------- gates
  out.push(page("", F("THE FRONTEND GATES"), [
    h1("Eleven Gates On The Front End Alone"),
    lead("The backend has its gates; the front end has its own, and several police things most teams never automate at all."),

    table("mst", ["Gate", "Command", "What it refuses"], [
      ["Lint (client)", "<code>eslint . --max-warnings 112</code>", "A second ratchet, at 112. Same rule: it only goes down."],
      ["<b>Design-token contrast</b>", "<code>check-contrast.mjs</code>", "Any token pair failing WCAG contrast. Accessibility as a build failure, not a review comment."],
      ["<b>Frontend guide is not lying</b>", "<code>check-docs.mjs</code>", "<b>Every component the guide references must exist and have call sites.</b> This gate <i>is</i> the fix for F5."],
      ["Motion budget", "<code>check-motion.mjs</code>", "Animation beyond the agreed budget, and motion that ignores <code>prefers-reduced-motion</code>."],
      ["Raw-palette gate", "<code>check-palette.mjs</code>", "A hex colour in a component. Semantic tokens only &mdash; that is what makes white-labelling work."],
      ["Test (vitest)", "<code>vitest run</code>", "&mdash;"],
      ["Build", "<code>tsc -b &amp;&amp; vite build</code>", "Type errors and build failures."],
      ["Shared schema &times;2", "<code>check-schemas.mjs</code>, <code>check-shared.mjs</code>", "Client-side revalidation of shared rules."],
      ["Bundle graph", "<code>check-bundle.mjs</code>", "Import cycles and unexpected bundle growth."],
      ["<code>screens.axe.test.tsx</code>", "vitest + axe", "A screen not registered in the accessibility register."],
    ]),

    callout("<strong>&ldquo;Frontend guide is not lying&rdquo; is the most quotable gate name in the repo</strong>, and it exists because of F5. The document that misled two dozen engineers now cannot mislead anyone: if it names a component, CI verifies that component exists and is used. <b>When documentation causes an incident, the fix is a gate on the documentation.</b>", "gold"),

    h2("A Node-version story worth reading"),
    cmd(`"//engines": "Mirrors the root package.json and .nvmrc. The client is linted,
 tested and built on Node 20 in CI and in the Docker image, so a dev tree on a
 newer Node can silently accept a dependency that CI cannot run — exactly how
 jsdom@30 (which needs undici@8 / Node >=22.19) got in and broke the frontend
 job. Declaring it here makes npm emit EBADENGINE locally instead."`),
    bl([
      "A developer on a newer Node installed a dependency their machine supported.",
      "CI runs Node 20. The frontend job broke, for everyone, on a change that looked unrelated.",
      "The fix is not a rule about which Node to use &mdash; it is <code>engines</code>, so <b>npm refuses locally</b>.",
      "<b>Move the failure from CI to the developer's terminal.</b> That is the whole art of this.",
    ]),

    quiz("Why does the raw-palette gate matter more here than in a typical app?",
      ["Hex colours are harder to read",
       "Because the app is white-labelled per tenant — a hardcoded hex is a colour that will not change when a client's brand is applied, producing a screen that is subtly off-brand for that one customer",
       "Tailwind requires tokens",
       "It reduces bundle size"],
      1,
      "Multi-tenancy has a front-end dimension people forget. Every hardcoded colour is a place where tenant branding silently fails, and it will be found by the client, not by you. The gate turns a class of bug that is invisible in development into a build failure."),
  ].join("\n")));

  // ------------------------------------------------------- offline
  out.push(page("", F("OFFLINE &mdash; THE OUTBOX"), [
    h1("The Outbox, and Why The Server Had To Change"),
    lead("<code>client/src/lib/outbox.ts</code> is the best full-stack story in the codebase: a front-end feature that could not be built until the backend grew a middleware. Read it and you understand why &ldquo;full-stack&rdquo; is a way of thinking, not a list of technologies."),

    h2("Two layers of rescue"),
    stack([
      ["<code>lib/form-draft.ts</code>", "Rescues what you <b>typed</b>. The tab closed, the browser crashed &mdash; the half-filled form comes back."],
      ["<code>lib/outbox.ts</code>", "Rescues what you <b>submitted</b>. You filled the form, pressed Save, and <b>the request never left the machine</b>. Before this: a red banner and a retyped form."],
    ]),

    h2("The problem that makes naive replay dangerous"),
    callout("<strong>&ldquo;A rejected <code>fetch</code> does NOT mean the request never arrived.&rdquo;</strong> It means no response came back &mdash; and &ldquo;the request died on the way out&rdquo; and &ldquo;the request was processed and the response died on the way back&rdquo; are <b>indistinguishable from the browser</b>. Replaying blindly risks posting a journal entry, an invoice or a payment <b>twice</b>. In an OHADA ledger that is not a rough edge, it is a material misstatement &mdash; and it would be a strictly worse bug than the one this feature set out to fix.", "red"),

    h2("The fix spans both sides"),
    flow([
      { t: "CLIENT", b: "generate an <code>Idempotency-Key</code> <b>once</b>, at first attempt" },
      { t: "REPLAY", b: "reuse the <b>same</b> key on every retry" },
      { t: "SERVER", b: "<code>middleware/idempotency.js</code> + migration 0662 store the outcome" },
      { t: "RESULT", b: "a replay of completed work returns the <b>original</b> response" },
    ]),

    val("Recall from Chapter 1 exactly where that middleware sits: <strong>above the module loader</strong>, so it covers all ~700 tenant writes without any module opting in; and <strong>below <code>tenantContext</code></strong>, because it needs <code>req.tenantDb</code>. Position in a middleware chain is an architectural decision, and this is what it buys."),

    h2("Two more rules from the same file"),
    lete([
      ["1", "<b>Order is preserved.</b> Entries replay oldest-first, one at a time."],
      ["2", "<b>Failures stop the line.</b> A network failure mid-flush leaves the rest queued. &ldquo;An ERP write sequence is frequently causal &mdash; create the dossier, then cost it, then invoice it &mdash; and replaying the third after the first has failed produces a <b>404 storm and a queue full of &lsquo;rejected&rsquo; entries that were never wrong</b>.&rdquo;"],
    ]),

    callout("<strong>And the counterfactual, stated plainly in the source:</strong> without server-side idempotency, &ldquo;this file would have to ask the user to confirm every queued write &mdash; which, at that point, is just the retyping we were avoiding.&rdquo; The feature would have existed, shipped, and delivered nothing. <b>Knowing when a front-end feature is impossible without a backend change is the single most valuable thing a full-stack engineer contributes.</b>", "green"),
  ].join("\n")));

  // ------------------------------------------------------- lab
  out.push(page("", F("LAB 7 &mdash; BUILD THE SCREEN"), [
    band("L7", "Lab &mdash; A Screen For Your Module", "WEEK 3 &middot; <b>HANDS ON</b> &middot; ~3 HOURS", "lab"),
    lead("Your API works. Now give it a face &mdash; on the paved road, through the on-ramp, past all eleven gates."),

    h2("Step 1 &mdash; Use the generator"),
    cmd(`cd client
node scripts/new-screen.mjs --area operations --name "Onboarding tasks" \\
  --path /onboarding-tasks --width wide

# It prints two things to PASTE rather than writing them:
#   1. the router entry
#   2. the axe-register entry for src/features/screens.axe.test.tsx`),

    callout("<strong>Read why it refuses to edit those files.</strong> &ldquo;Generators that edit existing files are the ones people stop trusting: a bad merge into <code>app.tsx</code> or <code>screens.axe.test.tsx</code> is a worse outcome than a copy-paste, and <b>the paste is where you notice the fixture paths are wrong</b>, which <code>PHASE4_CHECKLIST.md</code> §5 records as the mistake that was made <b>seven times</b>.&rdquo;", "gold"),

    h2("Step 2 &mdash; The list"),
    req([
      "Columns: title, client, status, owner, due date. Overdue rows visually distinct &mdash; <b>via a semantic token, never a hex</b>.",
      "Toolbar: a search input and a status filter.",
      "Both empty states, with copy that says something different.",
      "<code>rowKey</code> from the real primary key, never the array index.",
      "Loading and error routed through <code>ListPage</code>, not hand-rolled.",
    ]),

  ].join("\n")));

  out.push(page("", F("LAB 7 &mdash; THE FORM &amp; THE GATES"), [
    h1("Lab 7 &mdash; The Form, And The Gates"),
    lead("The write path, on the shared schema, past all eleven checks."),

    h2("Step 3 &mdash; The create dialog"),
    req([
      "<code>useZodForm</code> bound to the <b>shared</b> schema &mdash; if it is not in <code>packages/shared</code> yet, move it there.",
      "<code>&lt;Form&gt;</code> / <code>&lt;FormField&gt;</code> / <code>&lt;FormError&gt;</code> / <code>&lt;FormButtons&gt;</code> inside <code>&lt;Dialog&gt;</code>.",
      "A 422 from the API must land on the <b>right field</b>, using the <code>fields</code> object.",
      "Submit disabled while in flight; the list refreshes on success.",
      "<b>Zero client-side validation logic of your own.</b> If you write an <code>if</code>, you are recreating F12.",
    ]),

    h2("Step 4 &mdash; The gates"),
    cmd(`cd client
npm run lint          # ratchet at 112
npm run check:contrast
npm run check:palette
npm run check:motion
npm run check:docs    # "frontend guide is not lying"
npm run check:shared
npm run check:schemas
npm run check:bundle
npm test              # includes screens.axe.test.tsx
npm run build         # tsc -b && vite build

cd .. && npm run ci   # everything, both halves`),

    ex("The offline test", "30 min",
      "<p>With the app running, open devtools, set the network to <b>Offline</b>, and create a task. Record: what the UI does; whether the entry appears in the outbox; what happens on reconnect; and whether the <code>Idempotency-Key</code> is identical across attempts (check the network tab). Then reason about it: if you clicked Save <i>twice</i> while offline, how many tasks exist afterwards, and why?</p>",
      "Offline: … / On reconnect: … / Key stable? … / Two clicks &rArr; …"),

    dod(["Screen scaffolded via the generator", "Both empty states", "Shared schema, no local validation", "All 11 frontend gates green", "Offline behaviour verified"]),
  ].join("\n")));

  return out;
}
