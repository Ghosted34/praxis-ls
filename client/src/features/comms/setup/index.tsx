/**
 * Comms → Setup — everything about how this company's email is configured, in
 * one place, split by WHO is doing it.
 *
 * ── WHY THIS LIVES IN COMMS AND NOT IN SETTINGS ─────────────────────────────
 *
 * Email configuration used to be spread across three surfaces: section senders
 * and the shared SMTP login under Comms → Setup, mailbox connections inside the
 * Mailbox tab, and a signature blob under Settings. Nobody could hold that map
 * in their head, and "where do I change the address invoices come from?" had no
 * findable answer. It is all here now, and Comms is where people already are
 * when they think about mail.
 *
 * ── THE SUB-TABS, AND WHO SEES THEM ─────────────────────────────────────────
 *
 *   My mailbox        everyone. Connect and look after your own one address.
 *   Mailboxes         administrators. The whole inventory: personal and shared,
 *                     health, members, limits, handover.
 *   Send points       administrators. Which sender each part of the product
 *                     mails from — and, next to every row, WHY.
 *   Senders & channels administrators. The existing per-purpose identities, the
 *                     shared SMTP login, WhatsApp and the DNS setup guide.
 *
 * A non-administrator sees ONE tab and therefore no tab strip at all — a strip
 * with a single item is noise. What they may do is answered by the server
 * (`GET /mail/me`) rather than guessed from the modules they can read: read
 * visibility is not the same right as edit, and a tab that always 403s teaches
 * people to distrust the tabs that work. The API remains the authority; this
 * only decides what is offered.
 */
import * as React from "react";
import { cn } from "@/lib/cn";
import { Callout } from "@/components/ui/callout";
import { useResource } from "@/lib/use-resource";
import { tr } from "@/lib/i18n";
import * as api from "@/lib/mail-api";
import { MyMailboxTab } from "./my-mailbox";
import { MailboxesTab, ConnectionsTab, type SharedMailboxSeed } from "./mailboxes";
import { SendPointsTab } from "./send-points";
import { SetupPage as SendersAndChannelsTab } from "../setup";
import { SecureLinksTab } from "./secure-links";
import { SlaTab } from "./sla";
import { TrustTab } from "./trust";
import { FollowupsTab } from "./followups";

type TabKey =
  | "mine" | "connections" | "mailboxes" | "send-points" | "senders"
  | "secure-links" | "sla" | "trust" | "followups";

/**
 * The four tabs after "Senders & channels" are PR-5's surfaces, which had a
 * complete server side and no screen at all — twenty-three endpoints reachable
 * only from a terminal. Ordered by who opens them and how often: follow-ups and
 * secure links are day-to-day operator work; response times and trust are
 * things an administrator sets up once and revisits when something is wrong.
 *
 * The two gating decisions are drawn from what the SERVER actually returns, not
 * from how administrative each one feels:
 *
 *   Follow-ups    `workflow.listFollowups` filters on `f.user_id = $1`, so the
 *                 list is the caller's own pending boomerangs. Everyone gets it
 *                 — an operator needs to see what is about to reappear in their
 *                 mailbox, and nobody else's rows are in it.
 *   Secure links  `secure-link.list` has no `created_by` filter: it is every
 *                 link in the tenant. Labels name clients and invoices
 *                 ("Invoice INV-2026-0311"), so that is a disclosure, and it is
 *                 admin-only for that reason rather than by analogy.
 */
const TABS: { key: TabKey; label: string; adminOnly: boolean; hint: string }[] = [
  { key: "mine", label: "My mailbox", adminOnly: false, hint: "Your own professional address" },
  { key: "connections", label: "Connections", adminOnly: false, hint: "Connect, test and sync the mailboxes you send from" },
  { key: "followups", label: "Follow-ups", adminOnly: false, hint: "Conversations waiting to come back" },
  { key: "secure-links", label: "Secure links", adminOnly: true, hint: "Every expiring link the company has sent, and who opened it" },
  { key: "mailboxes", label: "Mailboxes", adminOnly: true, hint: "Every mailbox in the company" },
  { key: "sla", label: "Response times", adminOnly: true, hint: "How fast a first reply must be, and which hours count" },
  { key: "trust", label: "Trust & archive", adminOnly: true, hint: "Confirmed domains, bounces, and the archive seal" },
  { key: "send-points", label: "Send points", adminOnly: true, hint: "Which address each part of the product sends from" },
  { key: "senders", label: "Senders & channels", adminOnly: true, hint: "System senders, shared SMTP, WhatsApp, DNS" },
];

export function CommsSetupPage() {
  const caps = useResource(() => api.mailCapabilities(), []);
  // Until the answer arrives, offer only the tab everyone has. Over-offering for
  // a frame and then retracting is worse than a tab appearing a moment later.
  const isAdmin = caps.data?.can_administer === true;
  const visible = TABS.filter((t) => !t.adminOnly || isAdmin);

  /**
   * Creating a shared mailbox is MOD-72 **create**, which is a different right
   * from the `can_administer` (= edit) that decides whether the tab is offered
   * at all. Resolved once here and handed down, so both tabs agree on it.
   */
  const canCreate = caps.data?.can_create === true;

  const [tab, setTab] = React.useState<TabKey>("mine");
  React.useEffect(() => {
    if (!visible.some((t) => t.key === tab)) setTab("mine");
  }, [visible, tab]);

  /**
   * ── WHERE A MICROSOFT CONSENT ROUND TRIP LANDS ──────────────────────────
   *
   * A person leaves this page for Microsoft, approves, and comes back to a
   * bare redirect: no session state, no memory of which tab asked, and the
   * result of the whole thing sitting in a query string. That result has to be
   * SAID — a mailbox either connected or it did not — and it has to be said on
   * the tab that asked, or an administrator who set up `operations@` reads a
   * success message on a screen about their own mailbox.
   *
   * The callback used to redirect to `/comms/mail`, which renders the inbox and
   * mounts none of this: the message was written and nothing displayed it. It
   * now lands here, carrying `mail_tab` — which the server derives from the
   * SIGNED OAuth state rather than from anything the browser sent. It is an
   * ordinary query parameter by the time it arrives, so a hand-typed one is
   * possible and harmless: it can only select a tab this user is already
   * offered, since the guard effect above bounces any other back to "mine".
   *
   * Read once, then stripped from the URL, so a reload does not replay a
   * success banner for a mailbox connected ten minutes ago.
   */
  const [oauthNote, setOauthNote] = React.useState<
    { ok: boolean; text: string } | null
  >(null);
  React.useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const ok = p.get("mail_connected");
    const bad = p.get("mail_error");
    if (!ok && !bad) return;
    const who = (ok || p.get("provider")) === "google" ? "Google" : "Microsoft";
    if (ok) {
      const email = p.get("email");
      setOauthNote({
        ok: true,
        text: `${tr("Connected to")} ${who}${email ? ` — ${email}` : ""}. ${tr("Mail starts arriving within a minute or two.")}`,
      });
    } else {
      setOauthNote({
        ok: false,
        text: `${who} ${tr("did not connect the mailbox")} (${bad}). ${tr("Nothing was changed — try again, or connect it with its own server settings instead.")}`,
      });
    }
    const wanted = p.get("mail_tab");
    if (wanted === "mailboxes" || wanted === "mine") setPendingTab(wanted);
    window.history.replaceState({}, "", window.location.pathname);
  }, []);

  /**
   * HELD until the tab is actually offered, rather than selected on the spot.
   *
   * `visible` is derived from `GET /mail/me`, which has not answered on the
   * frame this component mounts — so "Mailboxes" is not in it yet, and the
   * guard effect above, whose whole job is to bounce an impossible tab back to
   * "mine", would immediately undo the selection. Setting it a frame later,
   * once the capability answer has arrived, is the difference between an
   * administrator landing on the Mailboxes tab they started from and landing on
   * their own mailbox with a message about a team address.
   *
   * Cleared once applied, so it is a one-shot and not a tab the user cannot
   * navigate away from.
   */
  const [pendingTab, setPendingTab] = React.useState<TabKey | null>(null);
  React.useEffect(() => {
    if (!pendingTab) return;
    if (!visible.some((t) => t.key === pendingTab)) return;
    setTab(pendingTab);
    setPendingTab(null);
  }, [pendingTab, visible]);

  /**
   * Rendered by whichever tab the round trip came back to, rather than above
   * the tab strip: the answer belongs beside the button that asked the
   * question. Only one tab is mounted at a time, so only one can show it.
   */
  const notice = oauthNote ? (
    <Callout
      tone={oauthNote.ok ? "ok" : "bad"}
      action={
        <button
          type="button"
          className="underline underline-offset-2"
          onClick={() => setOauthNote(null)}
        >
          {tr("Dismiss")}
        </button>
      }
    >
      {oauthNote.text}
    </Callout>
  ) : null;

  /**
   * ── THE HAND-OFF FROM CONNECTIONS TO MAILBOXES ──────────────────────────
   *
   * "Connect a mailbox" creates a PERSONAL mailbox, of which everyone gets
   * exactly one. Somebody setting up `invoicing@` goes there anyway — it is the
   * only button in Comms that says "connect a mailbox" — types the whole form,
   * and is told they already have one and should ask an administrator, which
   * they frequently ARE. The team address they wanted is a different object on
   * a different tab, and the refusal named neither.
   *
   * So the refusal now offers the crossing, and this carries it: switch tabs
   * and open the shared-mailbox form with the transport details already filled
   * in. Cleared once the modal closes so a later visit to the tab starts blank.
   */
  const [sharedSeed, setSharedSeed] = React.useState<SharedMailboxSeed | null>(null);
  const startSharedMailbox = React.useCallback((seed: SharedMailboxSeed) => {
    setSharedSeed(seed);
    setTab("mailboxes");
  }, []);

  return (
    <div className="space-y-4">
      {visible.length > 1 && (
        <nav
          className="flex flex-wrap items-end gap-1 border-b border-border"
          aria-label={tr("Email setup sections")}
        >
          {visible.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              title={tr(t.hint)}
              aria-current={tab === t.key ? "page" : undefined}
              className={cn(
                "-mb-px border-b-2 px-3 pb-2 pt-1 text-sm font-medium transition-colors",
                tab === t.key
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:border-border hover:text-foreground",
              )}
            >
              {tr(t.label)}
            </button>
          ))}
        </nav>
      )}

      {tab === "mine" && <MyMailboxTab notice={notice} />}
      {tab === "connections" && (
        <ConnectionsTab
          onCreateShared={isAdmin && canCreate ? startSharedMailbox : undefined}
        />
      )}
      {tab === "followups" && <FollowupsTab />}
      {tab === "secure-links" && <SecureLinksTab />}
      {tab === "mailboxes" && isAdmin && (
        <MailboxesTab
          canCreate={canCreate}
          seed={sharedSeed}
          onSeedConsumed={() => setSharedSeed(null)}
          notice={notice}
        />
      )}
      {tab === "sla" && isAdmin && <SlaTab />}
      {tab === "trust" && isAdmin && <TrustTab />}
      {tab === "send-points" && isAdmin && <SendPointsTab />}
      {tab === "senders" && isAdmin && <SendersAndChannelsTab />}
    </div>
  );
}
