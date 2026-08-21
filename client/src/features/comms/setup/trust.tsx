/**
 * Comms → Setup → Trust & archive (§9.6, §9.7, §9.8).
 *
 * Three things an administrator needs and one a compliance officer does.
 *
 * ── VERIFIED DOMAINS ARE WHAT MAKE THE SEND BLOCK POSSIBLE ──────────────────
 *
 * §8.8's one hard block — a financial document to a domain rated Suspicious —
 * can only fire when we know which domains legitimately belong to a party. With
 * no verified domain the send-side check has nothing to compare against and
 * refuses nothing, deliberately: treating "we never configured this" as "this
 * is an impostor" would block every send in a tenant that has not done the
 * set-up, which teaches everyone to override reflexively.
 *
 * So this screen is not administrative tidiness. It is the input to the one
 * control that stands between an operator and a redirected payment.
 *
 * ── OBSERVED IS NOT VERIFIED, AND THE DIFFERENCE IS THE WHOLE POINT ─────────
 *
 * Ingest records every domain it sees corresponding as a party, as `OBSERVED`,
 * with a message count. That confers NOTHING — it exists so that marking one as
 * genuine is a click rather than a typing exercise. An impostor who emails you
 * twice is observed twice. The list shows both kinds and never lets one drift
 * into the other: promoting is an explicit act, and the API only ever writes
 * `ADMIN_VERIFIED`.
 *
 * ── THE ARCHIVE VERDICT IS SAID PLAINLY ─────────────────────────────────────
 *
 * A broken hash chain does not mean somebody tampered with the mailbox — the
 * likeliest cause is two messages archived concurrently. But it does mean the
 * archive cannot be relied on as evidence from that row forward, and that is a
 * thing a compliance officer needs told in a sentence rather than implied by a
 * red dot.
 */
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, Modal, Select } from "@/components/ui/modal";
import { Callout } from "@/components/ui/callout";
import { Pill, type Tone } from "@/components/ui/pill";
import { PageHeader, DataList, type Column } from "@/components/data-list";
import { useResource } from "@/lib/use-resource";
import { reportActionError } from "@/lib/action-error";
import { dateTimeFmt } from "@/lib/format";
import * as api from "@/lib/mail-api";

/* ── Verified domains ─────────────────────────────────────────────────────── */

function VerifyDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [kind, setKind] = React.useState<"CLIENT" | "SUPPLIER">("CLIENT");
  const [partyId, setPartyId] = React.useState("");
  const [domain, setDomain] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  return (
    <Modal
      open
      onClose={onClose}
      title="Confirm a domain"
      description="Say that this domain genuinely belongs to this party. The send-side check uses it to spot a payment redirected to a lookalike."
    >
      <div className="space-y-3">
        <Field label="Party type">
          <Select value={kind} onChange={(e) => setKind(e.target.value as "CLIENT" | "SUPPLIER")}>
            <option value="CLIENT">Client</option>
            <option value="SUPPLIER">Supplier</option>
          </Select>
        </Field>
        <Field label="Party">
          <Input value={partyId} onChange={(e) => setPartyId(e.target.value)} placeholder="client id" />
        </Field>
        <Field label="Domain" hint="Just the domain — camrail.cm, not an address.">
          <Input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="camrail.cm" />
        </Field>
        <Callout tone="warn" title="Only confirm what you have checked.">
          This is the list the send block trusts. A lookalike confirmed here
          stops being flagged.
        </Callout>
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            size="sm"
            disabled={busy || !partyId.trim() || !domain.trim()}
            onClick={async () => {
              setBusy(true);
              try {
                await api.verifyDomain({ party_kind: kind, party_id: partyId.trim(), domain: domain.trim() });
                onSaved();
                onClose();
              } catch (err) {
                reportActionError(err);
              } finally {
                setBusy(false);
              }
            }}
          >
            Confirm
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function Domains() {
  const domains = useResource(() => api.listVerifiedDomains(), []);
  const [adding, setAdding] = React.useState(false);
  const [busy, setBusy] = React.useState<string | null>(null);

  const rows = domains.data || [];
  const verified = rows.filter((d) => d.source === "ADMIN_VERIFIED");
  const observed = rows.filter((d) => d.source !== "ADMIN_VERIFIED");

  const columns: Column<api.VerifiedDomain>[] = [
    { key: "domain", label: "Domain", render: (r) => <span className="num">{r.domain}</span> },
    { key: "party", label: "Belongs to", render: (r) => r.party_name || r.party_id },
    { key: "kind", label: "Type", render: (r) => (r.party_kind === "CLIENT" ? "Client" : "Supplier") },
    {
      key: "source",
      label: "Status",
      render: (r) =>
        r.source === "ADMIN_VERIFIED" ? (
          <Pill tone="ok">Confirmed</Pill>
        ) : (
          // Seen, not trusted. An impostor who emails twice is observed twice.
          <Pill tone="mute">Seen {r.message_count ?? 0}×</Pill>
        ),
    },
    {
      key: "_a",
      label: "",
      render: (r) =>
        r.source === "ADMIN_VERIFIED" ? (
          <Button
            size="sm"
            variant="outline"
            disabled={busy === r.party_verified_domain_id}
            onClick={async () => {
              setBusy(r.party_verified_domain_id);
              try {
                await api.unverifyDomain(r.party_verified_domain_id);
                domains.reload();
              } catch (err) {
                reportActionError(err);
              } finally {
                setBusy(null);
              }
            }}
          >
            Withdraw
          </Button>
        ) : null,
    },
  ];

  return (
    <div className="space-y-3">
      <PageHeader
        title="Confirmed domains"
        description="Which domains genuinely belong to which party. This is the list the financial-document send block compares against."
        action={<Button size="sm" onClick={() => setAdding(true)}>Confirm a domain</Button>}
      />
      {verified.length === 0 && !domains.loading && (
        <Callout tone="warn" title="Nothing is confirmed yet.">
          Until a party has at least one confirmed domain, the send block has
          nothing to compare against and will not stop an invoice going to a
          lookalike address.
        </Callout>
      )}
      <DataList
        columns={columns}
        rows={[...verified, ...observed]}
        error={domains.error}
        loading={domains.loading}
        rowKey={(r) => r.party_verified_domain_id}
        empty={{ title: "No domains recorded", hint: "Domains appear here as mail arrives, marked as seen. Confirming one is a separate, deliberate act." }}
      />
      {adding && <VerifyDialog onClose={() => setAdding(false)} onSaved={domains.reload} />}
    </div>
  );
}

/* ── Bounces ──────────────────────────────────────────────────────────────── */

const BOUNCE_TONE: Record<string, Tone> = { HARD: "bad", SOFT: "warn", COMPLAINT: "orange" };

function Bounces() {
  const bounces = useResource(() => api.listBounces(), []);

  const columns: Column<api.Bounce>[] = [
    { key: "address", label: "Address", render: (r) => <span className="num">{r.address}</span> },
    {
      key: "type",
      label: "Kind",
      render: (r) => <Pill tone={BOUNCE_TONE[r.bounce_type] || "mute"}>{r.bounce_type}</Pill>,
    },
    { key: "count", label: "Times", render: (r) => r.bounce_count ?? 1 },
    { key: "last", label: "Last", render: (r) => dateTimeFmt(r.last_bounced_at) },
    {
      key: "why",
      label: "What the server said",
      render: (r) => (
        <span className="text-xs text-muted-foreground">{r.diagnostic || "—"}</span>
      ),
    },
  ];

  return (
    <div className="space-y-3">
      <PageHeader
        title="Undeliverable addresses"
        description="Addresses that bounced. The composer checks this list before a send, so a hard bounce is caught while there is still someone to ask about it."
      />
      <DataList
        columns={columns}
        rows={bounces.data ?? null}
        error={bounces.error}
        loading={bounces.loading}
        rowKey={(r) => r.email_bounce_id}
        empty={{ title: "Nothing has bounced", hint: "Delivery failures are parsed out of the DSNs that arrive back and collected here." }}
      />
    </div>
  );
}

/* ── Archive ──────────────────────────────────────────────────────────────── */

function Archive() {
  const [result, setResult] = React.useState<api.ArchiveVerdict | null>(null);
  const [busy, setBusy] = React.useState(false);

  return (
    <div className="space-y-3">
      <PageHeader
        title="Archive integrity"
        description="Every message is sealed into a hash chain as it arrives or leaves. This walks the chain and reports the first break, if there is one."
      />
      <Button
        size="sm"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            setResult(await api.verifyArchive());
          } catch (err) {
            reportActionError(err);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Walking the chain…" : "Verify the archive"}
      </Button>

      {result && result.ok && (
        <Callout tone="ok" title="Intact.">
          {result.checked} messages checked, every seal matches its predecessor.
        </Callout>
      )}
      {result && !result.ok && (
        // Said plainly. See the header — a break is usually concurrency, not
        // tampering, but the consequence for evidence is the same either way.
        <Callout tone="bad" title="The chain breaks.">
          {result.checked} messages checked. The first break is at{" "}
          <span className="num">{result.broken_at || "an unknown row"}</span>.
          This is most often two messages archived at the same moment rather
          than anything malicious — but from that row forward the archive cannot
          be relied on as evidence, and that should be looked at before anyone
          needs it to be.
        </Callout>
      )}
    </div>
  );
}

export function TrustTab() {
  return (
    <div className="space-y-8">
      <Domains />
      <Bounces />
      <Archive />
    </div>
  );
}
