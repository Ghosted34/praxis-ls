/**
 * Asset write surfaces: create, depreciate, dispose, and the detail modal with
 * its depreciation schedule.
 *
 * Split out of `features/finance/pages.tsx` in Phase 3 (audit F7).
 */
import * as React from "react";
import { money as moneyFmt, enumLabel } from "@/lib/format";
import { errMsg } from "@/lib/use-resource";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { Pill } from "@/components/ui/pill";
import { LoadingRow, EmptyState, ErrorState } from "@/components/ui/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, Field, Select } from "@/components/ui/modal";
import { SearchSelect } from "@/components/ui/search-select";
import * as fin from "@/lib/finance-api";
import type { Asset, AssetDetail, AssetScheduleRow } from "@/lib/finance-api";

export function AssetCreateForm({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const [entityId, setEntityId] = React.useState("");
  const [entityLabel, setEntityLabel] = React.useState<string | null>(null);
  const [label, setLabel] = React.useState("");
  const [tag, setTag] = React.useState("");
  const [cost, setCost] = React.useState("");
  const [residual, setResidual] = React.useState("");
  const [method, setMethod] = React.useState<"LINEAR" | "DECLINING">("LINEAR");
  const [lifeMonths, setLifeMonths] = React.useState("");
  const [acquiredOn, setAcquiredOn] = React.useState(fin.today());
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setEntityId(""); setEntityLabel(null); setLabel(""); setTag(""); setCost("");
    setResidual(""); setMethod("LINEAR"); setLifeMonths(""); setAcquiredOn(fin.today()); setError(null);
  }, [open]);

  const canSubmit = !!entityId && label.trim().length > 0 && Number(cost) > 0 && Number(lifeMonths) > 0 && !busy;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await fin.createAsset({
        entity_id: entityId,
        label: label.trim(),
        tag: tag.trim() || undefined,
        acquisition_cost: Number(cost),
        residual_value: residual === "" ? undefined : Number(residual),
        method,
        useful_life_months: Number(lifeMonths),
        acquired_on: acquiredOn,
      });
      onCreated();
      onClose();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="New asset" description="On save, the full monthly depreciation schedule is generated from the cost, residual value, method and useful life." size="lg">
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Entity" required>
            <SearchSelect
              path="/entities"
              value={entityLabel}
              placeholder="Search entities…"
              getLabel={(r) => (r.code ? `${String(r.code)} — ${String(r.legal_name ?? r.entity_id)}` : String(r.legal_name ?? r.entity_id))}
              getKey={(r) => String(r.entity_id)}
              onSelect={(r) => { setEntityId(String(r.entity_id)); setEntityLabel(String(r.legal_name ?? r.code ?? r.entity_id)); }}
            />
          </Field>
          <Field label="Tag" hint="Optional inventory tag / plate number.">
            <Input value={tag} onChange={(e) => setTag(e.target.value)} placeholder="VEH-001" />
          </Field>
          <Field label="Asset" required className="sm:col-span-2">
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Toyota Hilux — Douala fleet" />
          </Field>
          <Field label="Acquisition cost (XAF)" required>
            <Input type="number" min="0" step="1" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="25000000" />
          </Field>
          <Field label="Residual value (XAF)" hint="Salvage value at end of life. Defaults to 0.">
            <Input type="number" min="0" step="1" value={residual} onChange={(e) => setResidual(e.target.value)} placeholder="0" />
          </Field>
          <Field label="Method" required>
            <Select value={method} onChange={(e) => setMethod(e.target.value as "LINEAR" | "DECLINING")}>
              <option value="LINEAR">Linear (straight-line)</option>
              <option value="DECLINING">Declining balance</option>
            </Select>
          </Field>
          <Field label="Useful life (months)" required>
            <Input type="number" min="1" step="1" value={lifeMonths} onChange={(e) => setLifeMonths(e.target.value)} placeholder="60" />
          </Field>
          <Field label="Acquired on" required className="sm:col-span-2">
            <Input type="date" value={acquiredOn} onChange={(e) => setAcquiredOn(e.target.value)} />
          </Field>
        </div>

        {error && <ErrorState message={error} />}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={submit} loading={busy} disabled={!canSubmit}>Create asset</Button>
        </div>
      </div>
    </Modal>
  );
}

export function AssetDepreciateForm({ asset, onClose, onDone }: { asset: Asset | null; onClose: () => void; onDone: () => void }) {
  const open = !!asset;
  const [period, setPeriod] = React.useState("");
  const [nextDue, setNextDue] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [note, setNote] = React.useState<string | null>(null);

  // Default the period to the earliest UN-POSTED scheduled row, so the box lands
  // on the period that's actually due next rather than fin.today's calendar month
  // (which is usually not in the schedule, and posting out of order is wrong).
  React.useEffect(() => {
    if (!asset) return;
    let live = true;
    setError(null); setNote(null); setNextDue(null); setPeriod(""); setLoading(true);
    fin.getAsset(String(asset.asset_id))
      .then((d) => {
        if (!live) return;
        const next = (d.schedule ?? []).find((r) => !r.posted);
        setNextDue(next ? next.period_code : null);
        setPeriod(next ? next.period_code : "");
      })
      .catch((e) => live && setError(errMsg(e)))
      .finally(() => live && setLoading(false));
    return () => { live = false; };
  }, [asset]);

  async function submit() {
    if (!asset) return;
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const r = await fin.depreciateAsset(String(asset.asset_id), period);
      setNote(r?.posted_to_gl ? "Posted to the ledger." : "Recorded (ledger not configured — no GL entry).");
      onDone();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  const allPosted = !loading && nextDue === null && !error;

  return (
    <Modal open={open} onClose={onClose} title="Post depreciation" description={asset ? `Post one month's dotation for ${asset.label}. Debit 6813, credit accumulated depreciation. Idempotent per period.` : ""}>
      <div className="space-y-4">
        <Field label="Period" required hint={nextDue ? `Next un-posted period is ${nextDue}. Post periods in order.` : "YYYY-MM — must be a scheduled period for this asset."}>
          <Input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} disabled={loading} />
        </Field>
        {allPosted && (
          <div className="rounded-lg border px-3 py-2 text-sm text-muted-foreground">
            Every scheduled period is already posted — nothing left to depreciate.
          </div>
        )}
        {note && <div className="rounded-lg border border-[rgb(var(--ok))]/40 bg-[rgb(var(--ok)/0.08)] px-3 py-2 text-sm">{note}</div>}
        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>Close</Button>
          <Button onClick={submit} loading={busy} disabled={busy || loading || !/^\d{4}-\d{2}$/.test(period)}>Post period</Button>
        </div>
      </div>
    </Modal>
  );
}

export function AssetDisposeForm({ asset, onClose, onDone }: { asset: Asset | null; onClose: () => void; onDone: () => void }) {
  const open = !!asset;
  const [disposedOn, setDisposedOn] = React.useState(fin.today());
  const [proceeds, setProceeds] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<{ net_book_value: number; gain_loss: number } | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setDisposedOn(fin.today()); setProceeds(""); setError(null); setResult(null);
  }, [open, asset]);

  async function submit() {
    if (!asset) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fin.disposeAsset(String(asset.asset_id), { disposed_on: disposedOn, proceeds: proceeds === "" ? 0 : Number(proceeds) });
      setResult({ net_book_value: r.net_book_value, gain_loss: r.gain_loss });
      onDone();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Dispose asset" description={asset ? `Mark ${asset.label} disposed and recognise the gain or loss against its net book value.` : ""}>
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Disposed on" required>
            <Input type="date" value={disposedOn} onChange={(e) => setDisposedOn(e.target.value)} />
          </Field>
          <Field label="Proceeds (XAF)" hint="Sale proceeds; 0 if scrapped.">
            <Input type="number" min="0" step="1" value={proceeds} onChange={(e) => setProceeds(e.target.value)} placeholder="0" />
          </Field>
        </div>
        {result && (
          <div className="rounded-lg border px-3 py-2 text-sm">
            Net book value <span className="num font-medium">{moneyFmt(result.net_book_value)}</span> ·{" "}
            <span className={result.gain_loss >= 0 ? "text-[rgb(var(--ok))]" : "text-[rgb(var(--bad))]"}>
              {result.gain_loss >= 0 ? "Gain" : "Loss"} {moneyFmt(Math.abs(result.gain_loss))}
            </span>
          </div>
        )}
        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>Close</Button>
          <Button onClick={submit} loading={busy} disabled={busy || !!result}>Dispose</Button>
        </div>
      </div>
    </Modal>
  );
}

export function AssetDetailModal({ assetId, onClose, onChanged }: { assetId: string | null; onClose: () => void; onChanged: () => void }) {
  const open = !!assetId;
  const [detail, setDetail] = React.useState<AssetDetail | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [posting, setPosting] = React.useState<string | null>(null);
  const [nonce, setNonce] = React.useState(0);

  React.useEffect(() => {
    if (!assetId) return;
    let live = true;
    setDetail(null);
    setError(null);
    fin.getAsset(assetId)
      .then((d) => live && setDetail(d))
      .catch((e) => live && setError(errMsg(e)));
    return () => { live = false; };
  }, [assetId, nonce]);

  async function postPeriod(row: AssetScheduleRow) {
    if (!assetId) return;
    setPosting(row.period_code);
    setError(null);
    try {
      await fin.depreciateAsset(assetId, row.period_code);
      setNonce((n) => n + 1);
      onChanged();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setPosting(null);
    }
  }

  const schedule = detail?.schedule ?? [];
  const isActive = String(detail?.status ?? "").toUpperCase() === "ACTIVE";

  return (
    <Modal open={open} onClose={onClose} title={detail?.label ?? "Asset"} description="Depreciation schedule — post any un-posted period to the ledger." size="xl">
      {error && <ErrorState message={error} />}
      {!detail && !error && <LoadingRow />}
      {detail && (
        <div className="space-y-4">
          <KpiRow>
            <KpiTile label="Acquisition cost" value={moneyFmt(detail.acquisition_cost as number | string | null)} />
            <KpiTile label="Accumulated depr." value={moneyFmt(detail.accumulated_depreciation ?? 0)} />
            <KpiTile label="Net book value" value={moneyFmt(detail.net_book_value ?? 0)} />
            <KpiTile label="Status" value={enumLabel(String(detail.status))} />
          </KpiRow>
          {schedule.length === 0 ? (
            <EmptyState title="No schedule" hint="This asset has no depreciation schedule." />
          ) : (
            <div className="max-h-80 overflow-auto rounded-2xl border">
              <Table>
                <THead>
                  <TR>
                    <TH>Period</TH>
                    <TH>Amount</TH>
                    <TH>Posted</TH>
                    <TH></TH>
                  </TR>
                </THead>
                <TBody>
                  {schedule.map((row) => (
                    <TR key={row.depreciation_id}>
                      <TD className="num">{row.period_code}</TD>
                      <TD className="num text-right">{moneyFmt(row.amount as number | string | null)}</TD>
                      <TD>{row.posted ? <Pill tone="ok">Posted</Pill> : <Pill tone="mute">Pending</Pill>}</TD>
                      <TD className="text-right">
                        {!row.posted && isActive && (
                          <Button size="sm" variant="outline" loading={posting === row.period_code} disabled={!!posting} onClick={() => postPeriod(row)}>
                            Post
                          </Button>
                        )}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
