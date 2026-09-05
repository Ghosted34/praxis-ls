/**
 * ConnectMethodModal — "how is this mailbox hosted?", asked once, for every
 * mailbox this product connects.
 *
 * ── THE DEFECT IT CLOSES ────────────────────────────────────────────────────
 *
 * Every connect surface except one offered exactly one route in: a form for an
 * IMAP host, an SMTP host, a username and a password. For a tenant whose domain
 * sits on Microsoft 365 there is no password that can work — Exchange Online
 * disabled Basic authentication for IMAP and POP in 2022 and retired it for
 * SMTP AUTH in April 2026, App Passwords went with it — so those screens were a
 * dead end that looked like a working form. `mail.service.connect` refuses the
 * attempt by name (MAILBOX_OAUTH_REQUIRED), which is honest, but a refusal is
 * not a route: the person is told what cannot work and left with nothing that
 * can. Microsoft consent existed and was reachable from ONE tab, Connections,
 * which is not where anybody sets up a team address.
 *
 * So the question moves in front of the form. Both answers are offered
 * everywhere a mailbox is connected — your own, a catalogue slot like
 * Operations or Customer Support, and a team address typed from scratch — and
 * the SAME component asks it in all three places, because three copies of this
 * choice would be three places for the Microsoft branch to be forgotten again.
 *
 * ── WHY IT ASKS THE SERVER FIRST ────────────────────────────────────────────
 *
 * Microsoft consent needs two things that fail independently: the per-tenant
 * feature flag an administrator flips, and an Entra app registration on the
 * deployment — whose client secret EXPIRES, so a deployment that worked last
 * quarter can be missing it with nobody having changed anything.
 * `GET /mail/connect-methods` reports them separately, and this names the one
 * that is actually missing. A button that answers 403 teaches people to
 * distrust the buttons that work.
 *
 * ── WHAT "MICROSOFT" CONNECTS, SAID OUT LOUD ────────────────────────────────
 *
 * Consent connects THE MAILBOX YOU SIGN IN AS. For a team address that means
 * signing in as the team address itself, so the copy says so rather than
 * letting somebody sign in as themselves and wonder why `operations@` now shows
 * their own mail. A Microsoft 365 *shared mailbox* proper — the unlicensed kind
 * nobody can sign in to, reached by delegation — is a different mechanism and
 * is not what this connects; the note says that too.
 */
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Callout } from "@/components/ui/callout";
import { ErrorState } from "@/components/ui/states";
import { MailIcon, KeyIcon, ArrowRightIcon } from "@/components/ui/icons";
import { useResource, errMsg } from "@/lib/use-resource";
import { tr } from "@/lib/i18n";
import * as api from "@/lib/mail-api";

/**
 * What is being connected. `personal` is the caller's own one address;
 * `shared` is a team address, which is a different right on the server
 * (MOD-72 create, not edit) and therefore a different consent endpoint.
 */
export type ConnectScope =
  | { kind: "personal" }
  | {
      kind: "shared";
      /** The catalogue slot being filled — OPERATIONS, SUPPORT… — or null for a free-form one. */
      catalogue_key?: string | null;
      department?: string | null;
      /** The slot's label, carried through consent as the mailbox's display name. */
      label?: string | null;
    };

/** One of the two answers, drawn as a card rather than a radio: they are routes, not settings. */
function MethodCard({
  title, lede, detail, icon, onClick, disabled, busy, footnote,
}: {
  title: string;
  lede: string;
  detail: string;
  icon: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  busy?: boolean;
  footnote?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-card/40 p-4">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden>{icon}</span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">{title}</div>
          <p className="micro mt-0.5 text-muted-foreground">{lede}</p>
          <p className="micro mt-2 text-muted-foreground">{detail}</p>
          {footnote}
        </div>
      </div>
      <div className="mt-3 flex justify-end">
        <Button
          type="button"
          variant="outline"
          onClick={onClick}
          disabled={disabled || busy}
          loading={busy}
          icon={<ArrowRightIcon />}
        >
          {title}
        </Button>
      </div>
    </div>
  );
}

export function ConnectMethodModal({
  open,
  scope,
  title,
  description,
  onClose,
  onChooseSmtp,
}: {
  open: boolean;
  scope: ConnectScope;
  title?: string;
  /** Overrides the default lede — a catalogue slot passes its own description. */
  description?: string;
  onClose: () => void;
  /** Take the password route: the caller opens whichever form it already had. */
  onChooseSmtp: () => void;
}) {
  const methods = useResource(
    () => (open ? api.connectMethods() : Promise.resolve(null)),
    [open],
  );
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<unknown>(null);

  const ms = methods.data?.microsoft_graph;

  async function chooseMicrosoft() {
    setBusy(true);
    setError(null);
    try {
      const r = scope.kind === "shared"
        ? await api.startMicrosoftShared({
            catalogue_key: scope.catalogue_key ?? null,
            department: scope.department ?? null,
            display_name: scope.label ?? null,
          })
        : await api.startMicrosoft();
      // A full navigation, not a popup: consent lands back on our own callback,
      // which redirects to Comms → Setup with the outcome in the query.
      window.location.href = r.url;
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  const shared = scope.kind === "shared";

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={title || (shared ? tr("Set up a team address") : tr("Connect your mailbox"))}
      description={
        description
        || tr("Two ways in. Pick the one that matches where this company's email actually lives.")
      }
    >
      <div className="space-y-3">
        {error != null && <ErrorState message={errMsg(error)} />}
        {methods.error && <ErrorState message={methods.error} />}

        {/* Microsoft first, and deliberately so. For a mailbox on Microsoft 365
            it is not the better route, it is the ONLY one that exists — the
            password form below cannot ever authenticate against it. Offering
            the password form first sends a Microsoft tenant down a road that
            ends in an authentication failure they cannot fix. */}
        <MethodCard
          icon={<MailIcon />}
          title={tr("Sign in with Microsoft")}
          lede={tr("The company's email is on Microsoft 365 / Outlook, including a custom domain hosted there.")}
          detail={
            shared
              ? tr("Sign in AS the team address. Microsoft connects whichever mailbox signs in, and this fills the slot with it — no password is stored here.")
              : tr("Microsoft asks you to sign in and approve; nothing is typed here and no password is stored.")
          }
          onClick={() => void chooseMicrosoft()}
          disabled={methods.loading || !ms?.available}
          busy={busy}
          footnote={
            ms && !ms.available ? (
              <Callout tone="warn" className="mt-2">
                {ms.reason === "NOT_ENABLED"
                  ? tr("Microsoft 365 mailboxes are not switched on for this company yet. An administrator enables them in the Platform Console; until then this route is closed.")
                  : tr("Microsoft sign-in is not set up on this deployment yet — it needs an Entra app registration, and its client secret expires. Whoever runs the server sets it in Platform Console → Integrations.")}
              </Callout>
            ) : shared && ms?.available ? (
              <p className="micro mt-2 text-muted-foreground">
                {tr("This connects a mailbox that can sign in. A Microsoft 365 shared mailbox — the unlicensed kind reached by delegation — cannot, so give it a licence or use the address's own sign-in.")}
              </p>
            ) : undefined
          }
        />

        <MethodCard
          icon={<KeyIcon />}
          title={tr("Use a custom domain (SMTP)")}
          lede={tr("The company runs its own mail server — cPanel, a host, or an SMTP relay.")}
          detail={tr("You give the incoming and outgoing servers and the mailbox password. If the server runs cPanel, the settings are filled in for you.")}
          onClick={onChooseSmtp}
          disabled={busy}
        />
      </div>
    </Modal>
  );
}
