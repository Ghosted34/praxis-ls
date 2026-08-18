/**
 * Treasury 360 — the Reconciliation tab.
 *
 * Replaces the "coming next" placeholder. Four panes, in the order a treasurer
 * actually works:
 *
 *   1. IMPORT      drop a statement; the file is previewed before it is stored
 *   2. MAP         only when the layout is new — confirm once, never again
 *   3. MATCH       the queue: what agrees, what does not, what needs a person
 *   4. SIGN OFF    the etat de rapprochement
 *
 * TWO THINGS THIS SCREEN IS CAREFUL ABOUT, because they are the difference
 * between a reconciliation tool and a spreadsheet with extra steps:
 *
 *   NOTHING IS STORED UNTIL THE PREVIEW IS ACCEPTED. Upload runs `preview`,
 *   which parses in memory and writes nothing. The treasurer sees the parsed
 *   values, the row count, the duplicates and — most importantly — whether the
 *   statement FOOTS, before committing. A mis-parsed file never reaches the
 *   database.
 *
 *   A FAILED FOOTING IS SHOWN AS A BLOCK, NOT A WARNING. If the declared
 *   balances disagree with the sum of the lines, something was misread, and
 *   every number downstream is fiction. The import button goes away and the
 *   arithmetic is spelled out instead.
 */
import * as React from "react";
import { tr } from "@/lib/i18n";
import { Pill, type Tone } from "@/components/ui/pill";
import { Button } from "@/components/ui/button";
import { FileDrop } from "@/components/ui/file-drop";
import { Callout } from "@/components/ui/callout";
import { EmptyState, ErrorState, LoadingRow } from "@/components/ui/states";
import { errMsg } from "@/lib/use-resource";
import { money, dateFmt, cell } from "@/lib/format";
import * as recon from "@/lib/reconciliation-api";

const ACCEPT = ".csv,.txt,.xlsx,.xlsm,.pdf,.xml,.sta,.mt940";
const num = (v: unknown) => Number(v ?? 0);

/** Match status → the pill tone that reads correctly at a glance. */
const MATCH_TONE: Record<recon.MatchStatus, Tone> = {
  MATCHED: "ok",
  POSTED: "ok",
  PARTIAL: "warn",
  SUGGESTED: "warn",
  UNMATCHED: "bad",
  IGNORED: "mute",
};

/* ── the footing verdict, which decides whether an import may proceed ────── */

function FootingBanner({ footing, currency }: { footing: recon.FootingResult; currency: string }) {
  if (footing.foots === true) {
    return (
      <Callout tone="ok" title={tr("This statement adds up")}>
        <p className="micro text-muted-foreground">{footing.reason}</p>
        {footing.fees_included_in_balance === true && (
          <p className="micro text-muted-foreground">
            {tr("This provider's balance already has each transaction's fee deducted — fees will be posted separately.")}
          </p>
        )}
      </Callout>
    );
  }
  if (footing.foots === false) {
    return (
      <Callout tone="bad" title={tr("This statement does not add up")}>
        <p className="micro text-muted-foreground">{footing.reason}</p>
        <dl className="mt-2 grid grid-cols-3 gap-2">
          <div>
            <dt className="micro text-muted-foreground">{tr("Sum of lines")}</dt>
            <dd className="text-sm tabular-nums">{money(footing.movement, currency)}</dd>
          </div>
          <div>
            <dt className="micro text-muted-foreground">{tr("Balances imply")}</dt>
            <dd className="text-sm tabular-nums">
              {footing.expected === null ? "—" : money(footing.expected, currency)}
            </dd>
          </div>
          <div>
            <dt className="micro text-muted-foreground">{tr("Difference")}</dt>
            <dd className="text-sm tabular-nums text-bad">
              {footing.difference === null ? "—" : money(footing.difference, currency)}
            </dd>
          </div>
        </dl>
        <p className="micro mt-2 text-muted-foreground">
          {footing.broke_at_row
            ? tr("Start at the row named above — it is the likely mis-parse.")
            : tr("Usually a dropped row, a debit column read as a credit, or a thousands separator read as a decimal point. Check the column mapping and re-upload.")}
        </p>
      </Callout>
    );
  }
  return (
    <Callout tone="warn" title={tr("Could not verify the totals")}>
      <p className="micro text-muted-foreground">{footing.reason}</p>
    </Callout>
  );
}

/* ── the mapping confirmation — asked once per institution, ever ─────────── */

function MappingPane({
  result, entityId, onConfirmed, onCancel,
}: {
  result: recon.PreviewNeedsMapping;
  entityId: string;
  onConfirmed: () => void;
  onCancel: () => void;
}) {
  const [map, setMap] = React.useState<recon.ColumnMap>(result.proposal.profile.column_map);
  const [institution, setInstitution] = React.useState("");
  const [dateFormat, setDateFormat] = React.useState(result.proposal.profile.date_format);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const { verification, detection, alternatives, field_source: source } = result.proposal;
  const fields: recon.CanonicalField[] = [
    "booking_date", "description", "debit", "credit", "amount", "direction",
    "running_balance", "external_ref", "counterparty", "fee", "value_date", "cheque_no",
  ];

  const save = async () => {
    setBusy(true); setError(null);
    try {
      await recon.confirmProfile({
        entity_id: entityId,
        source_kind: result.file.source_kind,
        institution: institution || null,
        label: institution || `${result.file.source_kind} layout`,
        header_signature: result.proposal.profile.header_signature,
        column_map: map,
        sign_convention: result.proposal.profile.sign_convention,
        date_format: dateFormat,
        decimal_separator: result.proposal.profile.decimal_separator,
        thousands_separator: result.proposal.profile.thousands_separator,
        proposed_by_ai: result.proposal.model_used,
      });
      onConfirmed();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border bg-muted/30 p-3">
        <p className="text-sm font-medium">{tr("New statement layout")}</p>
        <p className="micro text-muted-foreground">{result.message}</p>
        {result.proposal.model_used && (
          <p className="micro mt-1 text-muted-foreground">
            {tr("The mapping below was drafted by AI and checked against the file's own data. Confirm it before anything is imported.")}
          </p>
        )}
      </div>

      {/* The date-order warning. This is the ONE parse fault arithmetic cannot
          catch downstream, so it is raised here in its own right. */}
      {detection.date.ambiguous && (
        <Callout tone="warn" title={tr("Check the date order")}>
          <p className="micro text-muted-foreground">{detection.date.reason}</p>
          <div className="mt-2 flex gap-2">
            {["DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD"].map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setDateFormat(f)}
                className={`rounded-md border px-2 py-1 text-xs ${dateFormat === f ? "border-primary bg-primary/10 text-primary-ink" : "text-muted-foreground"}`}
              >
                {f}
              </button>
            ))}
          </div>
        </Callout>
      )}

      {verification.errors.length > 0 && (
        <Callout tone="bad" title={tr("This mapping does not fit the file")}>
          <ul className="micro mt-1 list-disc space-y-0.5 pl-4 text-muted-foreground">
            {verification.errors.map((e) => <li key={e}>{e}</li>)}
          </ul>
        </Callout>
      )}
      {verification.warnings.map((w) => (
        <Callout key={w} tone="warn">
          <span className="micro text-muted-foreground">{w}</span>
        </Callout>
      ))}

      <div>
        <label className="micro text-muted-foreground" htmlFor="recon-institution">{tr("Institution")}</label>
        <input
          id="recon-institution"
          value={institution}
          onChange={(e) => setInstitution(e.target.value)}
          placeholder={tr("e.g. Afriland First Bank, MTN MoMo Business")}
          className="mt-1 w-full rounded-md border bg-background text-foreground px-3 py-2 text-sm"
        />
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="px-3 py-2 text-left font-medium">{tr("Field")}</th>
              <th className="px-3 py-2 text-left font-medium">{tr("Column in your file")}</th>
              <th className="px-3 py-2 text-left font-medium">{tr("Source")}</th>
            </tr>
          </thead>
          <tbody>
            {fields.map((f) => (
              <tr key={f} className="border-t">
                <td className="px-3 py-1.5">{f.replace(/_/g, " ")}</td>
                <td className="px-3 py-1.5">
                  <select
                    aria-label={f}
                    value={map[f] ?? ""}
                    onChange={(e) => setMap({ ...map, [f]: e.target.value || null })}
                    // bg/text on the trigger AND on the options: a native
                    // <select> without explicit option colours pops its list in
                    // the browser's own palette, which is light-on-light in dark
                    // mode. Mirrors NativeSelect in components/ui/modal.tsx.
                    className="w-full rounded-md border bg-background text-foreground px-2 py-1 text-sm [&>option]:bg-background [&>option]:text-foreground"
                  >
                    <option value="">{tr("— not present —")}</option>
                    {/* Ranked by plausibility rather than alphabetically: the
                        column the engine thinks is right sits at the top. */}
                    {(alternatives[f] ?? []).map((a) => (
                      <option key={a.header} value={a.header}>{a.header}</option>
                    ))}
                    {result.headers
                      .filter((h) => !(alternatives[f] ?? []).some((a) => a.header === h))
                      .map((h) => <option key={h} value={h}>{h}</option>)}
                  </select>
                </td>
                <td className="px-3 py-1.5">
                  {source[f] ? <Pill tone={source[f] === "model" ? "warn" : "mute"}>{source[f]}</Pill> : <span className="text-muted-foreground">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* The preview is what makes a wrong map obvious: source values beside
          what the mapping turns them into. */}
      <div>
        <p className="micro mb-1 text-muted-foreground">{tr("How the first rows will be read")}</p>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-3 py-2 text-left font-medium">{tr("Date")}</th>
                <th className="px-3 py-2 text-right font-medium">{tr("Amount")}</th>
                <th className="px-3 py-2 text-right font-medium">{tr("Fee")}</th>
                <th className="px-3 py-2 text-left font-medium">{tr("Description")}</th>
                <th className="px-3 py-2 text-left font-medium">{tr("Reference")}</th>
              </tr>
            </thead>
            <tbody>
              {result.proposal.preview.map((r, i) => (
                <tr key={i} className="border-t">
                  <td className="px-3 py-1.5">{cell(r.booking_date as string)}</td>
                  <td className={`px-3 py-1.5 text-right tabular-nums ${num(r.amount) < 0 ? "text-bad" : ""}`}>
                    {money(num(r.amount), result.account.currency)}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{num(r.fee) ? money(num(r.fee), result.account.currency) : "—"}</td>
                  <td className="px-3 py-1.5">{cell(r.description as string)}</td>
                  <td className="px-3 py-1.5">{cell(r.external_ref as string)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {error && <ErrorState message={error} />}
      <div className="flex gap-2">
        <Button onClick={save} disabled={busy || !verification.ok}>
          {busy ? tr("Saving…") : tr("Confirm mapping and continue")}
        </Button>
        <Button variant="outline" onClick={onCancel}>{tr("Cancel")}</Button>
      </div>
      <p className="micro text-muted-foreground">
        {tr("Confirmed once. Every future statement with this layout imports without asking; if the institution changes its export, you will be asked again rather than the file being read wrongly.")}
      </p>
    </div>
  );
}

/* ── the match queue ─────────────────────────────────────────────────────── */

function MatchQueue({
  statement, currency, onChanged,
}: {
  statement: recon.BankStatement;
  currency: string;
  onChanged: () => void;
}) {
  const [lines, setLines] = React.useState<recon.StatementLine[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [open, setOpen] = React.useState<string | null>(null);
  const [matches, setMatches] = React.useState<recon.ReconciliationMatch[]>([]);
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(async () => {
    try {
      const r = await recon.getStatement(statement.statement_id);
      setLines(r.lines);
    } catch (e) {
      setError(errMsg(e));
    }
  }, [statement.statement_id]);

  React.useEffect(() => { void load(); }, [load]);

  const runMatcher = async () => {
    setBusy(true); setError(null);
    try {
      await recon.runMatcher(statement.statement_id);
      await load();
      onChanged();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const openLine = async (id: string) => {
    if (open === id) { setOpen(null); return; }
    setOpen(id);
    setMatches([]);
    try {
      setMatches(await recon.lineMatches(id));
    } catch (e) {
      setError(errMsg(e));
    }
  };

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true); setError(null);
    try {
      await fn();
      await load();
      if (open) setMatches(await recon.lineMatches(open));
      onChanged();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  if (!lines) return <LoadingRow />;

  const live = lines.filter((l) => l.duplicate_of === null);
  const counts = {
    matched: live.filter((l) => l.match_status === "MATCHED" || l.match_status === "POSTED").length,
    suggested: live.filter((l) => l.match_status === "SUGGESTED").length,
    unmatched: live.filter((l) => l.match_status === "UNMATCHED").length,
    ignored: live.filter((l) => l.match_status === "IGNORED").length,
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Pill tone="ok">{counts.matched} {tr("matched")}</Pill>
        <Pill tone="warn">{counts.suggested} {tr("to review")}</Pill>
        <Pill tone="bad">{counts.unmatched} {tr("unmatched")}</Pill>
        {counts.ignored > 0 && <Pill tone="mute">{counts.ignored} {tr("set aside")}</Pill>}
        <div className="ml-auto">
          <Button onClick={runMatcher} disabled={busy}>
            {busy ? tr("Matching…") : tr("Find matches")}
          </Button>
        </div>
      </div>

      {error && <ErrorState message={error} />}

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="px-3 py-2 text-left font-medium">{tr("Date")}</th>
              <th className="px-3 py-2 text-left font-medium">{tr("Description")}</th>
              <th className="px-3 py-2 text-right font-medium">{tr("Amount")}</th>
              <th className="px-3 py-2 text-left font-medium">{tr("Status")}</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <React.Fragment key={l.statement_line_id}>
                <tr className={`border-t ${l.duplicate_of ? "opacity-50" : ""}`}>
                  <td className="px-3 py-1.5 whitespace-nowrap">{dateFmt(l.booking_date)}</td>
                  <td className="px-3 py-1.5">
                    {cell(l.description || l.counterparty)}
                    {l.external_ref && <span className="micro ml-2 text-muted-foreground">{l.external_ref}</span>}
                    {l.ignored_reason && <span className="micro ml-2 text-muted-foreground">· {l.ignored_reason}</span>}
                  </td>
                  <td className={`px-3 py-1.5 text-right tabular-nums ${num(l.amount) < 0 ? "text-bad" : ""}`}>
                    {money(num(l.amount), l.currency || currency)}
                    {num(l.fee_amount) > 0 && (
                      <span className="micro block text-muted-foreground">
                        {tr("fee")} {money(num(l.fee_amount), l.currency || currency)}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-1.5">
                    <Pill tone={MATCH_TONE[l.match_status]}>{l.match_status.toLowerCase()}</Pill>
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    {l.match_status !== "IGNORED" && !l.duplicate_of && (
                      <button
                        type="button"
                        className="text-xs text-primary-ink underline-offset-2 hover:underline"
                        onClick={() => void openLine(l.statement_line_id)}
                      >
                        {open === l.statement_line_id ? tr("Close") : tr("Review")}
                      </button>
                    )}
                  </td>
                </tr>

                {open === l.statement_line_id && (
                  <tr className="border-t bg-muted/20">
                    <td colSpan={5} className="px-3 py-2">
                      {matches.length === 0 ? (
                        <div className="flex items-center justify-between gap-3">
                          <p className="micro text-muted-foreground">
                            {tr("Nothing in the ledger explains this line. It is probably a bank charge, interest, or a receipt nobody recorded — post it, or set it aside.")}
                          </p>
                          <Button
                            variant="outline"
                            onClick={() => void act(() => recon.ignoreLine(l.statement_line_id, "set aside by the treasurer"))}
                            disabled={busy}
                          >
                            {tr("Set aside")}
                          </Button>
                        </div>
                      ) : (
                        <ul className="space-y-1.5">
                          {matches.map((m) => (
                            <li key={m.match_id} className="flex flex-wrap items-center gap-2 rounded-md border bg-background p-2">
                              <Pill tone={m.status === "CONFIRMED" ? "ok" : "warn"}>
                                {tr("tier")} {m.tier} · {Math.round(num(m.confidence) * 100)}%
                              </Pill>
                              <span className="text-sm">
                                {dateFmt(m.entry_date)} · {m.journal_code}-{m.entry_no} · {cell(m.description)}
                              </span>
                              <span className="tabular-nums text-sm">
                                {money(num(m.debit) - num(m.credit), currency)}
                              </span>
                              {/* Why the engine believes these are the same
                                  money — the audit answer, on the screen. */}
                              <span className="micro w-full text-muted-foreground">
                                {(m.reasons || []).join(" · ")}
                              </span>
                              {m.status !== "CONFIRMED" && (
                                <span className="ml-auto flex gap-2">
                                  <Button onClick={() => void act(() => recon.confirmMatch(m.match_id))} disabled={busy}>
                                    {tr("Confirm")}
                                  </Button>
                                  <Button variant="outline" onClick={() => void act(() => recon.rejectMatch(m.match_id))} disabled={busy}>
                                    {tr("Not this one")}
                                  </Button>
                                </span>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ── the etat de rapprochement ───────────────────────────────────────────── */

function ReconciliationPane({
  accountId, statement, currency,
}: {
  accountId: string;
  statement: recon.BankStatement | null;
  currency: string;
}) {
  const [row, setRow] = React.useState<recon.Reconciliation | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const build = async () => {
    setBusy(true); setError(null);
    try {
      const r = await recon.buildReconciliation({
        treasury_account_id: accountId,
        statement_id: statement ? statement.statement_id : undefined,
      });
      setRow(r.reconciliation);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const approve = async () => {
    if (!row) return;
    setBusy(true); setError(null);
    try {
      setRow(await recon.approveReconciliation(row.reconciliation_id));
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const gap = row ? num(row.unexplained_difference) : 0;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Button onClick={build} disabled={busy || !statement}>
          {busy ? tr("Working…") : tr("Build reconciliation")}
        </Button>
        {row && row.status !== "APPROVED_LOCKED" && (
          <Button variant="outline" onClick={approve} disabled={busy || gap !== 0}>
            {tr("Approve")}
          </Button>
        )}
        {row && <Pill tone={row.status === "APPROVED_LOCKED" ? "ok" : "warn"}>{row.status.toLowerCase()}</Pill>}
      </div>

      {error && <ErrorState message={error} />}

      {row ? (
        <div className="rounded-lg border p-4">
          {/* The identity, written out. An accountant reads a rapprochement as
              a walk from one balance to the other, not as a set of tiles. */}
          <dl className="space-y-1 text-sm">
            <div className="flex justify-between"><dt>{tr("Balance per our ledger")}</dt>
              <dd className="tabular-nums">{money(num(row.ledger_balance), currency)}</dd></div>
            <div className="flex justify-between text-muted-foreground"><dt>+ {tr("Deposits in transit")}</dt>
              <dd className="tabular-nums">{money(num(row.deposits_in_transit), currency)}</dd></div>
            <div className="flex justify-between text-muted-foreground"><dt>− {tr("Unpresented payments")}</dt>
              <dd className="tabular-nums">{money(num(row.outstanding_payments), currency)}</dd></div>
            <div className="flex justify-between text-muted-foreground"><dt>+ {tr("Credits we have not booked")}</dt>
              <dd className="tabular-nums">{money(num(row.unrecorded_credits), currency)}</dd></div>
            <div className="flex justify-between text-muted-foreground"><dt>− {tr("Charges we have not booked")}</dt>
              <dd className="tabular-nums">{money(num(row.unrecorded_debits), currency)}</dd></div>
            <div className="flex justify-between border-t pt-1 font-medium"><dt>{tr("Balance per the statement")}</dt>
              <dd className="tabular-nums">{money(num(row.statement_balance), currency)}</dd></div>
            <div className={`flex justify-between border-t pt-1 font-medium ${gap === 0 ? "text-ok" : "text-bad"}`}>
              <dt>{tr("Unexplained difference")}</dt>
              <dd className="tabular-nums">{money(gap, currency)}</dd>
            </div>
          </dl>
          {gap !== 0 && (
            <p className="micro mt-3 text-muted-foreground">
              {tr("A reconciliation cannot be approved while anything is unexplained. Match the remaining lines, or post the ones the ledger is missing.")}
            </p>
          )}
          <p className="micro mt-2 text-muted-foreground">
            {row.matched_count} {tr("matched")} · {row.unmatched_statement_count} {tr("statement lines outstanding")} · {row.unmatched_ledger_count} {tr("ledger lines outstanding")}
          </p>
        </div>
      ) : (
        <EmptyState
          title={tr("No reconciliation built yet")}
          hint={statement
            ? tr("Build one to see the walk from your ledger balance to the statement balance.")
            : tr("Import a statement first.")}
        />
      )}
    </div>
  );
}

/* ── the tab ─────────────────────────────────────────────────────────────── */

export function ReconciliationTab({
  accountId, entityId, currency, categoryCode, requiresCustodian,
}: {
  accountId: string;
  entityId: string;
  currency: string;
  categoryCode: string | null;
  /** Petty cash has no external statement — it reconciles against a count. */
  requiresCustodian: boolean;
}) {
  const [statements, setStatements] = React.useState<recon.BankStatement[] | null>(null);
  const [selected, setSelected] = React.useState<recon.BankStatement | null>(null);
  const [file, setFile] = React.useState<File | null>(null);
  const [preview, setPreview] = React.useState<recon.PreviewResult | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    try {
      const rows = await recon.listStatements(accountId);
      setStatements(rows);
      setSelected((prev) => (prev ? rows.find((r) => r.statement_id === prev.statement_id) ?? rows[0] ?? null : rows[0] ?? null));
    } catch (e) {
      setError(errMsg(e));
    }
  }, [accountId]);

  React.useEffect(() => { void load(); }, [load]);

  /** Step 1 — parse in memory and show what WOULD happen. Stores nothing. */
  const doPreview = async (picked: File) => {
    setBusy(true); setError(null); setNotice(null); setPreview(null);
    try {
      setPreview(await recon.previewStatement({
        treasury_account_id: accountId,
        file: await recon.fileToDataUrl(picked),
        filename: picked.name,
      }));
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  /** Step 2 — commit, only ever from an accepted preview. */
  const doImport = async () => {
    if (!file) return;
    setBusy(true); setError(null);
    try {
      const r = await recon.importStatement({
        treasury_account_id: accountId,
        file: await recon.fileToDataUrl(file),
        filename: file.name,
      });
      setNotice(
        `${tr("Imported")} ${r.imported} ${tr("lines")}`
        + (r.duplicates ? ` · ${r.duplicates} ${tr("already present from an earlier statement")}` : "")
        + (r.rejected.length ? ` · ${r.rejected.length} ${tr("rows could not be read")}` : ""),
      );
      setPreview(null);
      setFile(null);
      await load();
      setSelected(r.statement);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  if (requiresCustodian) {
    return (
      <EmptyState
        title={tr("This account reconciles against a physical count")}
        hint={tr("Nobody issues a statement for petty cash, so the external truth is a count sheet attested by the custodian. Recording a count is available from the API; the count screen lands with the cash-census UI.")}
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* ── 1. import ─────────────────────────────────────────────────────── */}
      <section className="space-y-3 rounded-xl border bg-card p-4">
        <div>
          <h3 className="text-sm font-medium">{tr("Import a statement")}</h3>
          <p className="micro text-muted-foreground">
            {tr("CSV, Excel, PDF, camt.053 or MT940. The file is checked before anything is stored — nothing is imported until you accept the preview.")}
          </p>
        </div>

        <FileDrop
          file={file}
          onPick={(f) => { setFile(f); setPreview(null); if (f) void doPreview(f); }}
          accept={ACCEPT}
          hint={tr("Drop the export from your bank or mobile-money portal")}
          disabled={busy}
        />

        {busy && !preview && <LoadingRow />}
        {error && <ErrorState message={error} />}
        {notice && (
          <Callout tone="ok">{notice}</Callout>
        )}

        {preview && preview.status === "NEEDS_MAPPING" && (
          <MappingPane
            result={preview}
            entityId={entityId}
            onConfirmed={() => { setPreview(null); if (file) void doPreview(file); }}
            onCancel={() => { setPreview(null); setFile(null); }}
          />
        )}

        {preview && preview.status === "READY" && (
          <div className="space-y-3">
            {preview.already_imported && (
              <Callout tone="warn">
                {tr("You have already imported this exact file on")} {dateFmt(preview.already_imported.imported_at)}.
              </Callout>
            )}

            <div className="flex flex-wrap gap-2">
              <Pill tone="mute">{preview.file.source_kind}</Pill>
              <Pill tone="mute">{preview.line_count} {tr("lines")}</Pill>
              {preview.duplicate_count > 0 && (
                <Pill tone="warn">{preview.duplicate_count} {tr("already present")}</Pill>
              )}
              {preview.rejected.length > 0 && (
                <Pill tone="bad">{preview.rejected.length} {tr("unreadable")}</Pill>
              )}
              {preview.profile && <Pill tone="ok">{preview.profile.label}</Pill>}
            </div>

            <FootingBanner footing={preview.footing} currency={preview.account.currency} />

            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">{tr("Date")}</th>
                    <th className="px-3 py-2 text-right font-medium">{tr("Amount")}</th>
                    <th className="px-3 py-2 text-left font-medium">{tr("Description")}</th>
                    <th className="px-3 py-2 text-left font-medium">{tr("Reference")}</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.preview.map((r, i) => (
                    <tr key={i} className="border-t">
                      <td className="px-3 py-1.5">{cell(r.booking_date as string)}</td>
                      <td className={`px-3 py-1.5 text-right tabular-nums ${num(r.amount) < 0 ? "text-bad" : ""}`}>
                        {money(num(r.amount), preview.account.currency)}
                      </td>
                      <td className="px-3 py-1.5">{cell((r.description ?? r.counterparty) as string)}</td>
                      <td className="px-3 py-1.5">{cell(r.external_ref as string)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* A statement that does not foot has been misread, and every
                number derived from it would be fiction. No import button. */}
            {preview.footing.foots === false ? (
              <p className="micro text-muted-foreground">
                {tr("Fix the file or the column mapping and upload again — importing a statement that does not add up would reconcile your books against a mis-parse.")}
              </p>
            ) : (
              <Button onClick={doImport} disabled={busy}>
                {busy ? tr("Importing…") : tr("Import this statement")}
              </Button>
            )}
          </div>
        )}
      </section>

      {/* ── 2. history ────────────────────────────────────────────────────── */}
      <section className="space-y-3 rounded-xl border bg-card p-4">
        <h3 className="text-sm font-medium">{tr("Statements")}</h3>
        {statements === null ? (
          <LoadingRow />
        ) : statements.length === 0 ? (
          <EmptyState
            title={tr("No statements imported yet")}
            hint={tr("Upload your first export above. The layout is confirmed once, then reused for every statement from that institution.")}
          />
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">{tr("Period")}</th>
                  <th className="px-3 py-2 text-left font-medium">{tr("File")}</th>
                  <th className="px-3 py-2 text-right font-medium">{tr("Lines")}</th>
                  <th className="px-3 py-2 text-right font-medium">{tr("Unmatched")}</th>
                  <th className="px-3 py-2 text-left font-medium">{tr("Adds up")}</th>
                  <th className="px-3 py-2 text-left font-medium">{tr("Status")}</th>
                </tr>
              </thead>
              <tbody>
                {statements.map((s) => (
                  <tr
                    key={s.statement_id}
                    onClick={() => setSelected(s)}
                    className={`cursor-pointer border-t hover:bg-muted/30 ${selected?.statement_id === s.statement_id ? "bg-muted/40" : ""}`}
                  >
                    <td className="px-3 py-1.5 whitespace-nowrap">
                      {s.period_start ? `${dateFmt(s.period_start)} → ${dateFmt(s.period_end)}` : dateFmt(s.imported_at)}
                    </td>
                    <td className="px-3 py-1.5">{cell(s.file_name)} <span className="micro text-muted-foreground">{s.source_kind}</span></td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{s.line_count}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{String(s.unmatched_count ?? "—")}</td>
                    <td className="px-3 py-1.5">
                      {/* Three states, not two: null means we could not check. */}
                      {s.foots === true ? <Pill tone="ok">{tr("yes")}</Pill>
                        : s.foots === false ? <Pill tone="bad">{tr("no")}</Pill>
                          : <Pill tone="mute">{tr("not checkable")}</Pill>}
                    </td>
                    <td className="px-3 py-1.5"><Pill tone="mute">{s.status.toLowerCase()}</Pill></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── 3. match ──────────────────────────────────────────────────────── */}
      {selected && (
        <section className="space-y-3 rounded-xl border bg-card p-4">
          <div>
            <h3 className="text-sm font-medium">{tr("Match against the ledger")}</h3>
            <p className="micro text-muted-foreground">
              {tr("Candidates are scored deterministically — only an exact reference hit is accepted automatically. Everything else waits for you.")}
              {categoryCode && categoryCode.includes("MOMO") && ` ${tr("Mobile-money fees are allowed for when comparing amounts.")}`}
            </p>
          </div>
          <MatchQueue statement={selected} currency={currency} onChanged={() => void load()} />
        </section>
      )}

      {/* ── 4. sign off ───────────────────────────────────────────────────── */}
      <section className="space-y-3 rounded-xl border bg-card p-4">
        <div>
          <h3 className="text-sm font-medium">{tr("État de rapprochement")}</h3>
          <p className="micro text-muted-foreground">
            {tr("The signed statement an auditor asks for. It cannot be approved while anything is unexplained.")}
          </p>
        </div>
        <ReconciliationPane accountId={accountId} statement={selected} currency={currency} />
      </section>
    </div>
  );
}
