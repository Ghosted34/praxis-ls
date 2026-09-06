/**
 * Comms → Setup → Secure links (§9.4).
 *
 * Every link the company has minted to a document, who has opened it, and the
 * one button that matters: revoke.
 *
 * ── THE TOKEN IS SHOWN EXACTLY ONCE ─────────────────────────────────────────
 *
 * Only the SHA-256 is stored, so nothing — not this screen, not the API, not
 * the database — can ever show a link again after the moment it is created.
 * That is not a limitation to work around; it is what makes a leaked database
 * table useless to whoever leaked it.
 *
 * The interface has to be built knowing it, or somebody adds a "copy the link
 * again" button on top of a function that cannot work. So: the token appears in
 * the mint dialog, with a copy control and a sentence saying it will not be
 * shown again, and every row afterwards shows a link's LIFE — created, expiry,
 * views, revoked — and never its address.
 *
 * ── VIEWS ARE THE POINT OF KEEPING THE ROW ──────────────────────────────────
 *
 * The server records a view BEFORE it fetches the bytes, so a download that
 * failed still leaves evidence the link was opened. "Did the client actually
 * get the invoice?" is answerable here, and it is the question secure links
 * exist to answer as much as the expiry is.
 *
 * We show the count and the timestamps and NOT the IP. §9.4 is deliberate about
 * that: knowing a link was opened four times is operationally useful; logging
 * where from turns a delivery record into surveillance of the recipient.
 */
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, Modal, Select } from "@/components/ui/modal";
import { SearchSelect, type Row as PickerRow } from "@/components/ui/search-select";
import { Callout } from "@/components/ui/callout";
import { Pill, type Tone } from "@/components/ui/pill";
import { PageHeader, DataList, type Column } from "@/components/data-list";
import { useResource } from "@/lib/use-resource";
import { reportActionError } from "@/lib/action-error";
import { dateTimeFmt } from "@/lib/format";
import { tr } from "@/lib/i18n";
import * as api from "@/lib/mail-api";

type Row = api.SecureLink;

/** A link's state, in the order it actually matters to somebody looking. */
function state(l: Row): { label: string; tone: Tone } {
  if (l.revoked_at) return { label: tr("Revoked"), tone: "mute" };
  if (Date.parse(l.expires_at) < Date.now()) return { label: tr("Expired"), tone: "mute" };
  return { label: tr("Live"), tone: "ok" };
}

/* ── Minting ──────────────────────────────────────────────────────────────── */

/**
 * What one vault document is called, for somebody choosing between them.
 *
 * The vault stores an uploaded file's own name in `original_name` and a
 * classification in `doc_type`; neither is guaranteed. A row that has lost both
 * still has to be distinguishable from the next one, so it falls back to the
 * first segment of its id — ugly, and better than eight identical rows reading
 * "Document".
 */
function docLabel(r: PickerRow): string {
  const name = typeof r.original_name === "string" ? r.original_name.trim() : "";
  if (name) return name;
  const type = typeof r.doc_type === "string" ? r.doc_type.replace(/_/g, " ").trim() : "";
  const id = String(r.doc_id || "");
  if (type) return `${type}${id ? ` · ${id.slice(0, 8)}` : ""}`;
  return id ? `${tr("Document")} ${id.slice(0, 8)}` : tr("Document");
}


function MintDialog({ onClose, onMinted }: { onClose: () => void; onMinted: () => void }) {
  const [targetRef, setTargetRef] = React.useState("");
  // What the chosen document is CALLED. The control shows a name; the request
  // carries the id. Keeping both means the closed picker can say "Proposal
  // 235.pdf" while `target_ref` stays the uuid the API requires.
  const [targetName, setTargetName] = React.useState("");
  const [label, setLabel] = React.useState("");
  const [days, setDays] = React.useState(7);
  const [busy, setBusy] = React.useState(false);
  const [minted, setMinted] = React.useState<api.SecureLink | null>(null);
  const [copied, setCopied] = React.useState(false);

  async function mint() {
    setBusy(true);
    try {
      const out = await api.createSecureLink({
        target_kind: "VAULT_DOC",
        target_ref: targetRef.trim(),
        label: label.trim() || undefined,
        days,
      });
      setMinted(out);
      onMinted();
    } catch (err) {
      reportActionError(err);
    } finally {
      setBusy(false);
    }
  }

  const url = minted?.url || (minted?.token ? `${window.location.origin}/s/${minted.token}` : "");

  return (
    <Modal
      open
      onClose={onClose}
      title={minted ? tr("Your link") : tr("Create a secure link")}
      description={
        minted
          ? undefined
          : tr("Sends a document as an expiring, revocable link instead of an attachment. Nothing is emailed from here — you paste the link into a message.")
      }
    >
      {minted ? (
        <div className="space-y-3">
          {/* Said before they leave the dialog, because after it there is no
              second chance and no error to explain why. */}
          <Callout tone="warn" title={tr("This is the only time you will see it.")}>
            {tr("Only a fingerprint of the link is stored, so it cannot be shown again. If you lose it, create another and revoke this one.")}
          </Callout>
          <div className="flex items-center gap-2">
            <Input readOnly value={url} aria-label={tr("Secure link")} className="num text-xs" />
            <Button
              size="sm"
              onClick={() => {
                navigator.clipboard?.writeText(url).then(
                  () => setCopied(true),
                  () => setCopied(false),
                );
              }}
            >
              {copied ? tr("Copied") : tr("Copy")}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {tr("Expires")} {dateTimeFmt(minted.expires_at)}. {tr("You can revoke it before then from the list.")}
          </p>
          <div className="flex justify-end">
            <Button size="sm" variant="outline" onClick={onClose}>{tr("Done")}</Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {/* Was a text box captioned "The vault document id this link should
              serve". Nobody knows a document's uuid, so the field was filled in
              with the document's NAME and the request died in Postgres as
              22P02 — "One of the values is in the wrong format" — which named
              neither the field nor the format. A link points at a document, so
              the control picks a document. */}
          <Field label={tr("Document")} hint={tr("The document this link serves. Search by name.")}>
            <SearchSelect
              path="/documents"
              label={tr("Document")}
              value={targetName}
              placeholder={tr("Search documents…")}
              getKey={(r) => String(r.doc_id)}
              getLabel={docLabel}
              // An archived document is evidence, not something to hand to an
              // outsider — and the link would serve bytes the vault considers
              // withdrawn.
              filter={(r) => r.status !== "ARCHIVED"}
              onSelect={(r) => {
                setTargetRef(String(r.doc_id));
                setTargetName(docLabel(r));
              }}
            />
          </Field>
          <Field label={tr("Label")} hint={tr("What this is, for the list. The recipient never sees it.")}>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={tr("Invoice INV-2026-0311")} />
          </Field>
          <Field label={tr("Expires after")}>
            <Select value={String(days)} onChange={(e) => setDays(Number(e.target.value))}>
              {[1, 3, 7, 14, 30, 90].map((d) => (
                <option key={d} value={d}>{d} {d === 1 ? tr("day") : tr("days")}</option>
              ))}
            </Select>
          </Field>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={onClose}>{tr("Cancel")}</Button>
            <Button size="sm" onClick={mint} disabled={busy || !targetRef.trim()}>{tr("Create")}</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

/* ── Views ────────────────────────────────────────────────────────────────── */

function ViewsDialog({ link, onClose }: { link: Row; onClose: () => void }) {
  const views = useResource(() => api.secureLinkViews(link.secure_link_id), [link.secure_link_id]);
  const rows = views.data || [];

  return (
    <Modal open onClose={onClose} title={link.label || tr("Link activity")}>
      {views.loading && <p className="text-sm text-muted-foreground">{tr("Loading…")}</p>}
      {!views.loading && rows.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {tr("Nobody has opened this link yet.")}
        </p>
      )}
      {rows.length > 0 && (
        <ul className="space-y-1 text-sm">
          {rows.map((v, i) => (
            <li key={i} className="num">{dateTimeFmt(v.viewed_at)}</li>
          ))}
        </ul>
      )}
      {/* Stated, so nobody goes looking for a column that is missing on
          purpose. §9.4: a delivery record, not surveillance of the recipient. */}
      <p className="mt-3 text-xs text-muted-foreground">
        {tr("We record that a link was opened and when. We do not record where from.")}
      </p>
    </Modal>
  );
}

/* ── The tab ──────────────────────────────────────────────────────────────── */

export function SecureLinksTab() {
  const links = useResource(() => api.listSecureLinks(), []);
  const [minting, setMinting] = React.useState(false);
  const [viewing, setViewing] = React.useState<Row | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);

  async function revoke(l: Row) {
    setBusy(l.secure_link_id);
    try {
      await api.revokeSecureLink(l.secure_link_id);
      links.reload();
    } catch (err) {
      reportActionError(err);
    } finally {
      setBusy(null);
    }
  }

  const columns: Column<Row>[] = [
    { key: "label", label: tr("What"), render: (r) => r.label || tr("(no label)") },
    // The list is tenant-wide, so "who sent this" is the first thing an
    // administrator looking at an unfamiliar row needs.
    { key: "by", label: tr("Sent by"), render: (r) => r.created_by_name || "—" },
    {
      key: "state",
      label: tr("State"),
      render: (r) => {
        const s = state(r);
        return <Pill tone={s.tone}>{s.label}</Pill>;
      },
    },
    { key: "expires_at", label: tr("Expires"), render: (r) => dateTimeFmt(r.expires_at) },
    {
      key: "view_count",
      label: tr("Opened"),
      render: (r) => (
        <button
          type="button"
          onClick={() => setViewing(r)}
          className="underline-offset-2 hover:underline"
        >
          {r.view_count ?? 0} {r.view_count === 1 ? tr("time") : tr("times")}
        </button>
      ),
    },
    {
      key: "_a",
      label: "",
      render: (r) =>
        r.revoked_at ? (
          <span className="text-xs text-muted-foreground">{tr("Revoked")}</span>
        ) : (
          <Button
            size="sm"
            variant="outline"
            disabled={busy === r.secure_link_id}
            onClick={() => revoke(r)}
          >
            {tr("Revoke")}
          </Button>
        ),
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title={tr("Secure links")}
        description={tr("Expiring, revocable links to a document, instead of a 20 MB attachment that lives in someone's inbox forever.")}
        action={<Button size="sm" onClick={() => setMinting(true)}>{tr("Create a link")}</Button>}
      />

      <DataList
        columns={columns}
        rows={links.data ?? null}
        error={links.error}
        loading={links.loading}
        rowKey={(r) => r.secure_link_id}
        empty={{
          title: tr("No links yet"),
          hint: tr("The composer offers one when your attachments get large, or you can create one here."),
          action: <Button size="sm" onClick={() => setMinting(true)}>{tr("Create a link")}</Button>,
        }}
      />

      {minting && <MintDialog onClose={() => setMinting(false)} onMinted={links.reload} />}
      {viewing && <ViewsDialog link={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}
