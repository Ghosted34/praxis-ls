import {
  page, band, h1, h2, lead, callout, val, bl, req, dod, chips, lete,
  rgroup, cards, flow, table, stack, liaison, cmd, ex, quiz,
  setChapter,
} from "./kit.mjs";

const F = (s) => `CHAPTER 10 &mdash; NOTIFICATIONS, EMAIL &amp; PUSH &nbsp;&middot;&nbsp; ${s}`;

export function chapter() {
  setChapter(10);
  const out = [];

  // ------------------------------------------------------------------ opener
  out.push(page("", F("REACHING A HUMAN"), [
    band("10", "Notifications, Email &amp; Push", "WEEK 3 &middot; <b>TEACH + LAB</b> &middot; ~5 HOURS &middot; <b>THE OUTBOUND EDGE</b>"),
    lead("Everything you have built so far happens while someone is looking at the screen. This chapter is about the opposite case: the invoice was approved at 23:40, the person who needs to know is asleep, and the system has to reach them. Three channels, one producer, and a set of rules about which of them a user is allowed to switch off."),

    h2("One producer, three channels"),
    val("Every notification in this system goes through <b>one function</b>: <code>notify()</code> in <code>src/modules/notification/notification.service.js</code>, with a bulk sibling <code>notifyMany()</code>. Nothing in the codebase sends a user-facing alert any other way. That single door is what makes preferences, categories, dedupe and security rules enforceable at all &mdash; a second door would be a second place to forget them."),
    table("", ["Channel", "Storage", "Opt-in model", "Failure behaviour"], [
      ["<b>IN_APP</b>", "Tenant <code>notification</code> table &mdash; <b>the source of truth</b>", "Default <b>ON</b>", "Part of the caller's transaction. If this fails, the business write fails."],
      ["<b>EMAIL</b>", "SMTP via <code>email.service</code>", "Default <b>OFF</b> &mdash; explicitly opt-in", "Best effort. Logged, never thrown."],
      ["<b>PUSH</b>", "Web-Push / VAPID to registered devices", "<b>Subscribing is the opt-in</b>", "Best effort. Logged, never thrown."],
    ]),

    callout("<strong>Read the defaults column again, because it encodes a judgement.</strong> In-app is on by default because it costs the user nothing &mdash; it waits in a list until they look. Email is off by default because it arrives in a place they did not choose to open, and a system that emails by default trains people to filter it. Push has no default at all: the act of granting permission and subscribing a device <em>is</em> consent, so there is nothing separate to switch on.", "gold"),

    h2("The one thing a user cannot switch off"),
    val("Categories are declared in <code>src/shared/notifications/categories.js</code>, and exactly one of them carries <code>security: true</code>."),
    cmd(`const CATEGORIES = [
  { key: "security",   label: "Security",     security: true  },
  { key: "approvals",  label: "Approvals",    security: false },
  { key: "finance",    label: "Finance",      security: false },
  { key: "operations", label: "Operations",   security: false },
  { key: "sales",      label: "Sales & CRM",  security: false },
  { key: "compliance", label: "Compliance",   security: false },
  { key: "system",     label: "System",       security: false },
];`),
    bl([
      "<b>Security notifications ignore every preference</b>, on every channel. The service comment states the rule in one line: a user cannot silence &ldquo;your password changed&rdquo;.",
      "That is not paternalism. The whole value of a breach alert is that the attacker &mdash; who may now be holding the account &mdash; <b>cannot turn it off</b>.",
      "Everything else is tunable per <b>(channel, category)</b>, which is the grain a human actually thinks in. Nobody wants a switch per event type.",
    ]),
  ].join("\n")));

  // ------------------------------------------------------- categories/derive
  out.push(page("", F("CATEGORIES, DERIVED NOT TYPED"), [
    h1("Why Categories Are Derived"),
    lead("Event types are fine-grained and there are hundreds of them. Categories are the seven buckets a person will actually sit down and configure. The bridge between them is a lookup on the first segment of the event key, and its fallback is the interesting part."),

    h2("The mapping"),
    cmd(`// Leading domain segment (before the first ".") -> category.
const DOMAIN_TO_CATEGORY = {
  auth: "security", permission: "security", role: "security", session: "security",
  approval: "approvals", workflow: "approvals", cash_request: "approvals",
  invoice: "finance", payment: "finance", journal: "finance", payroll: "finance",
  dossier: "operations", vehicle: "operations", grn: "operations", po: "operations",
  // ...
};

// "invoice.posted"  -> "invoice"  -> finance
// "vehicle.insurance.expiring" -> "vehicle" -> operations
// "widget.exploded" -> "widget"   -> NOT MAPPED -> "system"`),

    callout("<strong>The unmapped case falls back to <code>system</code>, and that choice is doing real work.</strong> The alternative &mdash; throwing on an unknown event type &mdash; means the day someone adds <code>widget.exploded</code> without touching this file, the notification is <em>lost</em>, or worse, the business transaction that triggered it rolls back. Falling back means the alert still arrives; it just lands in the general bucket until somebody classifies it. <b>An unclassified notification is a papercut. A dropped one is a bug you find out about from a client.</b>", "green"),

    h2("Why the front end fetches this list"),
    val("The preferences screen does <b>not</b> hardcode the seven categories. It calls <code>GET /notifications/categories</code>. The file comment says why: &ldquo;so the UI and the enforcement logic never drift apart.&rdquo;"),
    bl([
      "Add a category to the array &rarr; it appears in the preferences UI on next load, with its label and its display order.",
      "Mark one <code>security: true</code> &rarr; the UI can render it as locked, <b>because it genuinely is</b>, server-side.",
      "This is the same principle as the AI action registry in Chapter 9 and the <code>&lt;ListPage&gt;</code> paved road in Chapter 7: <b>one declaration, many consumers</b>.",
    ]),

    quiz("A developer adds the event <code>subscription.renewed</code> and does not update <code>DOMAIN_TO_CATEGORY</code>. What happens?",
      [
        "The notify() call throws and the triggering transaction rolls back",
        "The notification is silently dropped",
        "It is delivered, categorised as <code>system</code>",
        "It is delivered as <code>security</code>, to be safe",
      ], 2,
      "Unmapped domains fall back to <code>system</code>. The alert still reaches the user; it is just in the general bucket until someone classifies it. Neither losing it nor failing the caller's transaction would be an acceptable price for a missing dictionary entry."),

    ex("Exercise 10.1 — Classify five events", "10 min",
      "<p>For each of these real event keys, name the category the code derives, without guessing at the meaning &mdash; trace the <b>first segment</b> through the map: <code>payment.received</code>, <code>role.granted</code>, <code>milestone.completed</code>, <code>tax_declaration.filed</code>, <code>backup.failed</code>. Which of the five cannot be silenced by the recipient, and why is that the right call?</p>",
      "payment.received → … · role.granted → … · milestone.completed → … · tax_declaration.filed → … · backup.failed → …"),
  ].join("\n")));

  // ------------------------------------------------------------------ PERF S5
  out.push(page("", F("THE 250-QUERY NOTIFICATION"), [
    h1("PERF S5 &mdash; The 250-Query Notification"),
    lead("This is the best performance war story in the repository, and it is worth studying not for the fix, which is obvious in hindsight, but for how ordinary the bug looked. Nobody wrote anything stupid. Somebody wrote a loop."),

    h2("The code that was wrong"),
    cmd(`// The obvious, readable, correct-looking version:
for (const userId of recipients) {
  await notify(client, userId, { ... });
}`),
    val("<code>notify()</code> issues roughly four to five queries: check the IN_APP preference, insert the row, check the EMAIL preference, look up the address, then send. Per recipient."),

    h2("What that costs on a real event"),
    bl([
      "<code>invoice.posted</code> notifies the finance group. Call it <b>50 users</b>.",
      "50 &times; ~5 queries = <b>~250 sequential round-trips</b>.",
      "All of them <b>inside an open write transaction</b>, because the in-app row must join the caller's transaction.",
      "Which means: one of the <b>eight pooled connections</b> pinned for the duration, and a <b>row lock held on the invoice</b> for the whole time.",
    ]),
    callout("<strong>The pathology is not the 250 queries. It is what they are holding while they run.</strong> A slow read is a slow read. A slow read inside a write transaction is a <b>lock-duration bug</b> wearing a performance bug's clothing, and it degrades everyone touching that row &mdash; not just the user who triggered it. This is the single most common way a healthy system falls over under load: not one catastrophic query, but a reasonable loop in a transaction that used to have three recipients and now has fifty.", "red"),

    quiz("Why is holding a write transaction open across 250 queries worse than running 250 queries with no transaction?",
      [
        "It is not worse — the same work happens either way",
        "It pins a pooled connection and holds row locks, degrading other users touching the same rows",
        "Transactions make each individual query slower",
        "Postgres caps transactions at 100 statements",
      ], 1,
      "The cost is contention, not raw speed. One of eight pooled connections is unavailable to everybody else, and the lock on the invoice row is held for the entire fan-out — so the blast radius is every other user touching that row, not just the one who triggered it."),
  ].join("\n")));

  out.push(page("", F("THE FOUR-QUERY REWRITE"), [
    h1("The Rewrite, And What It Left Alone"),
    lead("Four queries, any number of recipients. But the more instructive half of this change is the fix the author could see and deliberately did not make."),

    h2("Four queries, any number of recipients"),
    lete([
      ["1", "<b>All preferences, everyone, both channels &mdash; one statement.</b> <code>repo.preferencesFor(client, ids, [\"IN_APP\",\"EMAIL\"], cat)</code>"],
      ["2", "<b>One multi-row INSERT</b> for every in-app row. <code>repo.insertForUsers(...)</code>"],
      ["3", "<b>All addresses &mdash; one lookup.</b> <code>repo.activeEmailsFor(client, emailUsers)</code>"],
      ["4", "<b>Then the sends</b>, which are external I/O, not database work."],
    ]),
    val("Absence of a preference row is read as <b>IN_APP enabled, EMAIL disabled</b> &mdash; deliberately identical to the per-user defaults the old path passed to <code>isChannelEnabled</code>. A bulk rewrite that quietly changed a default would be a behaviour change smuggled inside a performance fix."),

    h2("The part the author refused to fix"),
    val("Read this comment from the source and note what it declines to do:"),
    cmd(`// The sends stay inside the caller's transaction rather than being deferred.
// That is a deliberate limit on the scope of this change: moving them out
// means deciding what happens when the transaction rolls back after an email
// has gone, which is a correctness question, not a performance one. The queue
// already exists (BullMQ) and is the right home for them; this change removes
// the ~246 unnecessary DATABASE round-trips without touching that question.`),
    callout("<strong>This is senior behaviour, written down.</strong> The author could see a bigger, better fix &mdash; push the sends onto the queue from Chapter 8 &mdash; and deliberately did not take it, because it opens a correctness question (what does a sent email mean after a rollback?) that has nothing to do with the performance problem being solved. <b>A PR that fixes one thing completely is reviewable. A PR that fixes one thing and half of another is not.</b> Name the adjacent problem in a comment, leave it, and let it be its own decision.", "green"),

    quiz("The rewrite leaves the email sends inside the caller's transaction. Why is that the right call for this PR?",
      [
        "Moving them out is impossible without a queue",
        "It would be slower to move them",
        "Deferring them raises a correctness question — what a sent email means after a rollback — that is a separate decision",
        "Emails must be transactional to be reliable",
      ], 2,
      "The queue already exists and is the right eventual home. But deferring the send means deciding what happens when the transaction rolls back after the email has left, which is a correctness question, not a performance one. The PR removes 246 unnecessary round-trips and names the adjacent problem rather than half-solving it."),
  ].join("\n")));

  // --------------------------------------------------------------- SMTP page
  out.push(page("", F("EMAIL: TWO CONFIGURATIONS"), [
    h1("Email: Two Configurations, Deliberately"),
    lead("SMTP is where most onboarding stalls, because there are two entirely different email systems in this product and the words for them overlap. Get the distinction straight now and the configuration is twenty minutes; get it wrong and you will debug the wrong one for a day."),

    h2("The two, side by side"),
    table("", ["", "System email", "Tenant mailboxes"], [
      ["<b>Whose identity</b>", "The deployment's (<code>no-reply@…</code>)", "A real human's or team's mailbox"],
      ["<b>What it sends</b>", "Password resets, notification fan-out, alerts", "Actual correspondence, threads, replies"],
      ["<b>Configured in</b>", "Platform Console, deploy-wide", "Mail UI, per connection (<code>email_connection</code>)"],
      ["<b>Protocols</b>", "SMTP out only", "IMAP + SMTP, or Microsoft/Google OAuth"],
      ["<b>Env keys</b>", "<code>SMTP_HOST/PORT/USER/PASS</code>", "None &mdash; stored per tenant, encrypted"],
    ]),
    callout("<strong>These are independent.</strong> A deployment can send every password reset perfectly while no tenant has connected a single mailbox, and a tenant can be running their whole sales inbox through the Mail module while the system-email fallback is unconfigured. When someone says &ldquo;email is broken&rdquo;, <b>your first question is which of the two</b>.", "gold"),

    h2("The env block"),
    cmd(`# ---- Email / SMTP ---- (see doc/EMAIL_TWO_CONFIGS.md)
SMTP_HOST=__host__
SMTP_PORT=587                    # 587 STARTTLS or 465 SSL
SMTP_USER=__user__
SMTP_PASS=__rotate_me__
MAIL_FALLBACK_DOMAIN=praxisls.com
MAIL_DEFAULT_FROM=no-reply@praxisls.com
MAIL_SUPPORT_FROM=support@praxisls.com
MAIL_FALLBACK_FROM_NAME=Praxis`),
    val("Every one of these has a <code>.default()</code> in <code>src/config/env.js</code>, so a deployment with no SMTP at all <b>boots</b>. Email degrades; the process does not die. That is the same degradation rule you met with AI keys in Chapter 9."),

    h2("Precedence: platform store first, env second"),
    flow([
      { t: "platform_setting", b: "<code>mail.fallback</code> &mdash; set and live-tested in the Platform Console. SMTP password stored <b>encrypted</b>." },
      { t: "env fallback", b: "<code>SMTP_*</code> from the environment, for deployments configured before the console existed." },
      { t: "degrade", b: "Neither present &rarr; sends no-op with a reason. Nothing throws." },
    ]),
    val("Note which way round that is. <b>The runtime-editable store wins over the environment</b>, so rotating a password is a console action, not a redeploy &mdash; the same principle that makes client go-live in Chapter 13 a sequence of clicks rather than a release."),
  ].join("\n")));

  // ------------------------------------------------------------- smtp probe
  out.push(page("", F("TESTING SMTP HONESTLY"), [
    h1("A Test Button That Actually Tests"),
    lead("&ldquo;Save&rdquo; is not a test. The Platform Console has a Test button beside every integration, and the SMTP one opens a real connection. Read what it does and, more importantly, what it refuses to conclude."),

    cmd(`async function smtp(cfg) {
  if (!cfg.smtp_host) throw new Error("no SMTP host configured");
  const port = Number(cfg.smtp_port || 587);
  const nodemailer = require("nodemailer");
  const transport = nodemailer.createTransport({
    host: cfg.smtp_host,
    port,
    secure: cfg.smtp_secure === true || port === 465,
    auth: cfg.smtp_user && cfg.smtp_pass
      ? { user: cfg.smtp_user, pass: cfg.smtp_pass }
      : undefined,     // some relays authenticate by IP allowlist
  });
  await transport.verify();   // opens, EHLO/AUTH, sends nothing
  return { smtp_host: cfg.smtp_host, smtp_port: port, smtp_user: cfg.smtp_user || null };
}`),

    h2("Four decisions in fifteen lines"),
    lete([
      ["a", "<b><code>secure</code> is derived, not just declared.</b> <code>port === 465</code> implies SSL, because the single most common misconfiguration is 465 with <code>secure:false</code>, which hangs rather than errors."],
      ["b", "<b>Auth is optional.</b> Passing <code>undefined</code> rather than empty credentials supports relays that authenticate by IP allowlist &mdash; common for on-premise clients."],
      ["c", "<b><code>verify()</code> sends nothing.</b> It proves connect + EHLO + AUTH. A test button that emitted real mail on every click would be a spam cannon wired to a UI control."],
      ["d", "<b>It returns what it proved</b> &mdash; host, port, user &mdash; and no more. It does not report &ldquo;email works&rdquo;, because it has not shown that."],
    ]),

    callout("<strong>Point (d) is the honesty rule, and it recurs everywhere in this codebase.</strong> <code>verify()</code> proves the relay will accept a connection from you. It does <em>not</em> prove that mail you send will arrive, or survive SPF/DKIM, or stay out of spam. So the separate real-send probe returns a message with a deliberately humble note: <b>&ldquo;test email sent &mdash; check it arrives, and check the spam folder.&rdquo;</b> Compare the health endpoint in Chapter 11 that returned <code>{ok:true}</code> unconditionally. <b>A check that cannot fail is not a check, and a check that overstates what it proved is worse than none, because it stops people from looking.</b>", "red"),

    h2("Failures are classified, not dumped"),
    val("When <code>verify()</code> throws, the error is passed through <code>mapSmtpError()</code>, which turns raw SMTP codes into an actionable verdict &mdash; 535 is a credentials problem, 550 is a sender-verification problem &mdash; so the Platform Console can render the same fix guide the tenant console does. <b>The user is not shown a stack trace and asked to guess.</b>"),

    quiz("The SMTP Test button returns success. What have you actually proven?",
      [
        "Email from this system will reach a user's inbox",
        "The relay accepts a connection and the credentials authenticate",
        "SPF and DKIM are correctly configured for the domain",
        "The From address is authorised to send",
      ], 1,
      "<code>verify()</code> does connect, EHLO and AUTH, then stops. Deliverability — SPF, DKIM, reputation, spam placement — is untested by it, which is exactly why the real-send probe tells you to go and look in the spam folder."),
  ].join("\n")));

  // -------------------------------------------------------------- VAPID page
  out.push(page("", F("WEB PUSH: WHAT VAPID IS"), [
    h1("Web Push and VAPID, From Zero"),
    lead("Push notifications are the one part of this stack that beginners consistently believe is magic. It is not. It is four parties, one keypair, and a browser that will refuse to co-operate unless you get the order right."),

    h2("The four parties"),
    cards([
      { name: "Your server", role: "THE SENDER", items: ["Holds the VAPID <b>private</b> key", "Signs each push request", "Knows which user owns which device"] },
      { name: "The push service", role: "GOOGLE / MOZILLA / APPLE", items: ["Run by the browser vendor, not you", "Verifies your signature", "Holds the message until the device is online"] },
      { name: "The browser", role: "THE SUBSCRIBER", items: ["Grants or denies permission", "Produces the subscription: endpoint + two keys", "Wakes the service worker on delivery"] },
      { name: "The service worker", role: "THE DISPLAYER", items: ["Runs with no tab open", "Handles the <code>push</code> event", "Calls <code>showNotification()</code>"] },
    ]),

    h2("What VAPID actually is"),
    val("<b>V</b>oluntary <b>A</b>pplication <b>S</b>erver <b>Id</b>entification. It is a P-256 elliptic-curve keypair that identifies <em>your server</em> to the push service. That is its whole job &mdash; and note what it is <b>not</b>."),
    bl([
      "It is <b>not</b> encryption of the message body. That is a separate pair of keys (<code>p256dh</code> and <code>auth</code>) generated by the <em>browser</em> and handed to you in the subscription.",
      "It is <b>not</b> per-user. <b>One keypair per deployment</b>, shared by every tenant and every device.",
      "It is <b>not</b> a secret you buy or register. You generate it yourself, in one call, and the push service trusts it on first use.",
    ]),
    callout("<strong>The consequence of &ldquo;one keypair per deployment&rdquo; is the one that bites.</strong> Every existing subscription is bound to the public key it was created with. <b>Rotate the VAPID keypair and every device on the deployment silently stops receiving push</b> &mdash; no error, no bounce; the push service simply rejects the signature. There is no migration path: users must re-subscribe. Treat the keypair as permanent infrastructure, generate it once at go-live, and back up the private half with the same seriousness as a database credential.", "red"),

    h2("Generating it"),
    cmd(`async function generateVapid({ subject, actor = null } = {}) {
  const webpush = require("web-push");
  const keys = webpush.generateVAPIDKeys();
  const subj = subject || "mailto:admin@praxisls.com";
  await put({
    section: "push", key: "vapid",
    value:  { public_key: keys.publicKey, subject: subj },  // readable
    secret: keys.privateKey,                                // AES-256-GCM at rest
    actor,
  });
  return { public_key: keys.publicKey, subject: subj };     // public half only
}`),
    val("The split is the lesson: <b>public key and subject go in <code>value</code></b> because the browser needs the first and the push service needs the second; <b>the private key goes in <code>secret</code></b>, encrypted at rest with the same key as tenant secrets, and is <b>never returned over HTTP</b> &mdash; reads yield presence and last-4 only. The <code>subject</code> is a <code>mailto:</code> the push service can use to contact you if your traffic misbehaves."),
  ].join("\n")));

  // ------------------------------------------------------- push end-to-end
  out.push(page("", F("PUSH, END TO END"), [
    h1("The Whole Push Path"),
    lead("Six hops, each in a file you can open. This is the flow to draw on a whiteboard when someone says push is broken, because the fault is always at one specific hop and the symptoms differ."),

    flow([
      { t: "Opt in", b: "<code>push-opt-in.tsx</code> &mdash; <code>GET /notifications/push/public-key</code>, then <code>Notification.requestPermission()</code>." },
      { t: "Subscribe", b: "<code>reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })</code> returns endpoint + <code>p256dh</code> + <code>auth</code>." },
      { t: "Register", b: "<code>POST /notifications/push/subscribe</code> writes the tenant <code>push_subscription</code> row." },
      { t: "Trigger", b: "Something happens. <code>notify()</code> writes the in-app row and calls <code>deliverPush()</code>." },
      { t: "Send", b: "<code>push.service.sendToUser()</code> reads the subscriptions and posts via <code>web-push</code>." },
      { t: "Display", b: "<code>push-handler.js</code>, imported into the Workbox SW, shows the notification and handles the tap." },
    ]),

    h2("Hop 1, and the base64url conversion nobody expects"),
    cmd(`function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64  = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}`),
    val("The key is transmitted as <b>base64url</b> (web-safe: <code>-</code> and <code>_</code>, no padding). <code>PushManager.subscribe</code> demands a <code>Uint8Array</code>. Every web-push tutorial contains this exact function because there is no built-in for it, and skipping it produces an <code>InvalidCharacterError</code> that reads like a bug in your key rather than in your encoding."),

    h2("Three states, not two"),
    val("Read the opt-in component's state and notice it distinguishes cases most implementations collapse:"),
    table("", ["State", "Meaning", "What the user is shown"], [
      ["<code>!supported</code>", "No service worker or PushManager &mdash; e.g. an old browser", "The control is not offered at all"],
      ["<code>unavailable</code>", "<b>Deployment has no VAPID keypair</b>", "&ldquo;Not available&rdquo; &mdash; not the user's fault, and not fixable by them"],
      ["<code>denied</code>", "The user blocked notifications in the browser", "&ldquo;Blocked in your browser settings&rdquo; &mdash; a pointer to where to undo it"],
    ]),
    callout("<strong>Collapsing these three into one &ldquo;push unavailable&rdquo; message is the tempting shortcut, and it produces the worst support tickets in the product.</strong> A user who blocked notifications six months ago and forgot needs to be told to check <em>browser</em> settings; a user on a deployment with no keypair will search their browser settings forever and find nothing wrong. <b>The error message must name the party who can actually fix it.</b>", "gold"),

    quiz("A user reports push is not working. The Test button in the Platform Console says the VAPID keypair is valid. What has the probe actually established?",
      [
        "Push notifications are being delivered to devices",
        "Only that a well-formed P-256 keypair is present",
        "That the user's device has an active subscription",
        "That the service worker is registered",
      ], 1,
      "The probe's own comment is explicit: VAPID keys cannot be exercised without a live browser subscription, so it validates format only — base64url, 87-char public, 43-char private. Same honesty rule as the SMTP probe: report what you proved, not what you hope."),
  ].join("\n")));

  // -------------------------------------------------- degradation & pruning
  out.push(page("", F("DEGRADING WITHOUT BREAKING"), [
    h1("How Push Fails Safely"),
    lead("The notification path runs inside business transactions. An unconfigured integration must therefore be incapable of failing an invoice. Two mechanisms make that true, and one of them is a bug fix worth memorising."),

    h2("Every exit returns, none throws"),
    cmd(`const webpush = await configuredClient();
if (!webpush || !q) return { sent: 0, reason: "push not configured" };
let subs;
try {
  const res = await q(\`SELECT endpoint, p256dh, auth FROM push_subscription WHERE user_id = $1\`, [user_id]);
  subs = res.rows;
} catch {
  return { sent: 0, reason: "no push_subscription table" };   // not provisioned yet
}`),
    val("<code>{ sent: 0, reason }</code> is a <b>result</b>, not an exception. The caller learns what happened and carries on. Contrast the silent-catch taxonomy from Chapter 8: this is not swallowing an error, it is <b>returning a described outcome</b> &mdash; the reason string is the difference between the two."),

    h2("Pruning gone devices"),
    cmd(`catch (err) {
  if (err.statusCode === 404 || err.statusCode === 410) {
    await q(\`DELETE FROM push_subscription WHERE endpoint = $1\`, [s.endpoint]).catch(() => {});
  } else {
    logger.warn({ err }, "[push] send failed");
  }
}`),
    val("404 and 410 from a push service mean the subscription is permanently gone &mdash; app uninstalled, browser data cleared, device retired. <b>Delete it.</b> Without this the table grows forever and every notification pays to attempt sends that can never succeed. Any other status is transient and is logged, not deleted: a network blip must not cost a user their subscription."),

    h2("NEW-04, again &mdash; the require that could not fail"),
    callout("<strong>You met this bug in Chapter 8 and here it is in a second file.</strong> <code>push.service.js</code> imported <code>config/database</code>, whose pool is never initialised, so <code>query</code> resolved to a function that <em>threw when called</em>. There was a <code>try/catch</code> around it &mdash; but it guarded the <b>require</b>, which never failed. <b>The failure was one level deeper, at use.</b> Pointing the import at the pool the process actually creates is what made the fallback real.", "red"),
    val("The transferable lesson: <b>a try/catch around an import protects you from the module being missing, not from the module being wrong.</b> When you wrap something defensively, say out loud which failure you are catching. If the answer is vague, the guard is probably in the wrong place."),

    h2("DI-4.2 &mdash; deleting a branch that never ran"),
    val("<code>sendToUser</code> once fell back to reading <code>shared.push_subscription</code> via the platform pool. There is no <code>shared</code> schema in this system &mdash; only live, sandbox and platform &mdash; so that branch could only ever return &ldquo;no push_subscription table&rdquo;. Its sole caller had zero importers. <b>Both are gone.</b> Dead code that looks like a safety net is worse than no safety net, because the next reader budgets for a fallback that does not exist."),
  ].join("\n")));

  // ------------------------------------------------------------------ LAB 10
  out.push(page("", F("LAB 10 — WIRE THE THREE CHANNELS"), [
    band("L10", "Lab &mdash; Wire All Three Channels", "WEEK 3 &middot; <b>HANDS ON</b> &middot; ~2.5 HOURS", "lab"),
    lead("Your <code>onboarding_task</code> module gets notifications. When a task is assigned, the owner hears about it in-app, by email if they opted in, and on their phone if they subscribed a device. You will configure SMTP, generate a VAPID keypair, and prove each hop."),

    h2("Part A — Emit a notification"),
    req([
      "In <code>onboarding_task.service.js</code>, after a successful assignment commits, call <code>notify()</code> with a title, a body, and <code>entityRef</code> pointing at the task.",
      "Do <b>not</b> invent an event key prefix. Use one whose first segment already maps in <code>DOMAIN_TO_CATEGORY</code>, or add yours to the map <b>in the same PR</b> and say why in the commit.",
      "Confirm the in-app row appears. This is the source of truth &mdash; if it is missing, nothing else matters.",
      "Now assign a task to <b>five</b> users at once using <code>notifyMany()</code>. Count the queries in the log. Confirm it is four, not twenty-five.",
    ]),

    h2("Part B — Email"),
    req([
      "Configure <code>mail.fallback</code> in the Platform Console, or set <code>SMTP_*</code> in <code>.env</code>. Use a throwaway relay &mdash; <b>never a client's production mailbox</b>.",
      "Press Test. Get a green result. Then read the returned payload and write down what it did <b>not</b> prove.",
      "Opt your test user into EMAIL for the relevant category. Remember the default is OFF &mdash; if you skip this and no mail arrives, the system is correct and you are wrong.",
      "Trigger the notification. Confirm arrival. <b>Check the spam folder</b> and record which folder it landed in.",
      "Now break it deliberately: set <code>SMTP_PORT=465</code> while leaving <code>smtp_secure</code> false. Observe the failure mode, then fix it.",
    ]),

    h2("Part C — Push"),
    req([
      "Generate a VAPID keypair from the Platform Console. Confirm the private key is <b>not</b> returned in the response body &mdash; look at the raw network response, not the UI.",
      "Open the client over <code>https://</code> or <code>http://localhost</code>. Push will not work on any other origin; this is a browser rule, not a bug in the app.",
      "Subscribe in Settings. Inspect the <code>push_subscription</code> row and identify which of the three stored values came from the <b>browser</b> rather than your server.",
      "Trigger the notification with the tab <b>closed</b>. This is the whole point of push &mdash; if it only works with the tab open, your service worker is not handling the event.",
      "Tap it. Confirm <code>notificationclick</code> focuses the existing tab rather than opening a second one.",
      "Now unsubscribe in browser settings without telling the server, and trigger again. Find the pruning branch in the log and confirm the row was deleted.",
    ]),

    dod(["In-app row written in the caller's transaction", "notifyMany() = 4 queries for 5 users", "SMTP test green + real mail located", "VAPID generated, private half never over HTTP", "Push received with tab closed", "Dead subscription pruned on 410"]),

    ex("Lab 10 write-up", "20 min",
      "<p>Answer in your own words. (1) Your <code>notify()</code> call runs inside the assignment transaction and the transaction later rolls back. Which of the three channels has now told a lie, and what would you do about it? (2) You must rotate the VAPID keypair because the private key leaked. Write the three-step plan, including what you tell users. (3) A client says &ldquo;we get too many emails&rdquo;. Which single configuration change fixes it, and which category will keep arriving regardless?</p>",
      "1) The channel that lied is… 2) Rotation plan… 3) The change is…"),
  ].join("\n")));

  return out;
}
