/**
 * Settings — treasury accounts (bank, cash, mobile money).
 *
 * Split out of `features/settings/config-pages.tsx` in Phase 4 (audit F7).
 *
 * SUPERSEDED — the running app renders `features/master/treasury/` instead
 * (see master-data-page.tsx). This file is retained solely because
 * features/screens.axe.test.tsx still imports `BankAccountsPage` to check
 * accessibility of the LEGACY rendering; when that test moves over to the
 * new page, this file goes with it. Do NOT wire this back into the app.
 */

import { pageShell } from "@/lib/layout";
import { tr } from "@/lib/i18n";
import * as React from "react";
import { errMsg, useList, useRefresh, type Row } from "@/lib/use-resource";
import { cell } from "@/lib/format";
import { Pill } from "@/components/ui/pill";
import { tenant } from "@/lib/api-client";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { SkeletonTable } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/data-list";
import { HubCrumb, HubTabs } from "@/components/tabbed-hub";
import { Input } from "@/components/ui/input";
import { Modal, Field, Select } from "@/components/ui/modal";
import { SearchSelect } from "@/components/ui/search-select";
import { PageError } from "./shared";

const TREASURY_KINDS = ["BANK", "CASH", "MOMO"];

function NewAccountForm({
  open,
  onClose,
  onCreated,
  entities,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  entities: Row[];
}) {
  const [entityId, setEntityId] = React.useState("");
  const [kind, setKind] = React.useState("BANK");
  const [label, setLabel] = React.useState("");
  const [coa, setCoa] = React.useState("");
  const [currency, setCurrency] = React.useState("XAF");
  const [momoNetwork, setMomoNetwork] = React.useState("");
  const [momoFee, setMomoFee] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setEntityId("");
    setKind("BANK");
    setLabel("");
    setCoa("");
    setCurrency("XAF");
    setMomoNetwork("");
    setMomoFee("");
    setError(null);
  }, [open]);

  const canSubmit = !!entityId && !!label.trim() && !!coa.trim() && !busy;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await tenant("/treasury-accounts", {
        method: "POST",
        body: {
          entity_id: entityId,
          kind,
          label: label.trim(),
          coa_code: coa.trim(),
          currency: currency.trim().toUpperCase() || undefined,
          momo_network:
            kind === "MOMO" ? momoNetwork.trim() || undefined : undefined,
          momo_fee_account:
            kind === "MOMO" ? momoFee.trim() || undefined : undefined,
        },
      });
      onCreated();
      onClose();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  const entityText = (en: Row) =>
    en.code
      ? `${cell(en.code)} — ${cell(en.legal_name ?? en.name ?? en.entity_id)}`
      : cell(en.legal_name ?? en.name ?? en.entity_id);
  const entityLabel = (() => {
    const en = entities.find((e) => String(e.entity_id) === entityId);
    return en ? entityText(en) : null;
  })();

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New bank account"
      description="A bank, cash or mobile-money account tied to a corporate entity and a chart-of-accounts code."
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={tr("Corporate entity")} required className="sm:col-span-2">
            <SearchSelect
              path="/entities"
              value={entityLabel}
              placeholder={tr("Search entities…")}
              getLabel={entityText}
              getKey={(en) => String(en.entity_id)}
              onSelect={(en) => setEntityId(String(en.entity_id))}
            />
          </Field>
          <Field label={tr("Kind")} required>
            <Select value={kind} onChange={(e) => setKind(e.target.value)}>
              {TREASURY_KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={tr("Currency")} hint={tr("ISO code")}>
            <Input
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              placeholder={tr("XAF")}
            />
          </Field>
          <Field label={tr("Label")} required className="sm:col-span-2">
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Afriland — Main XAF"
            />
          </Field>
          <Field
            label="CoA code"
            hint="Chart-of-accounts account (class 5)"
            required
            className="sm:col-span-2"
          >
            <Input
              value={coa}
              onChange={(e) => setCoa(e.target.value)}
              placeholder="521100"
            />
          </Field>
          {kind === "MOMO" && (
            <>
              <Field label="MoMo network">
                <Input
                  value={momoNetwork}
                  onChange={(e) => setMomoNetwork(e.target.value)}
                  placeholder="MTN / Orange"
                />
              </Field>
              <Field label="MoMo fee account" hint="CoA code for gateway fees">
                <Input
                  value={momoFee}
                  onChange={(e) => setMomoFee(e.target.value)}
                  placeholder="627800"
                />
              </Field>
            </>
          )}
        </div>
        {entities.length === 0 && (
          <p className="text-xs text-muted-foreground">
            No corporate entities found — create one under Master data →
            Corporate entities first.
          </p>
        )}
        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy} disabled={!canSubmit}>
            Create
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export function BankAccountsPage() {
  const reload = useRefresh();
  const { rows, error } = useList("/treasury-accounts");
  const { rows: entities } = useList("/entities");
  const [createOpen, setCreateOpen] = React.useState(false);
  const [rowBusy, setRowBusy] = React.useState<string | null>(null);
  const [rowError, setRowError] = React.useState<string | null>(null);

  const entityName = React.useCallback(
    (id: unknown) => {
      const en = (entities || []).find(
        (e) => String(e.entity_id) === String(id),
      );
      return en ? cell(en.code ?? en.legal_name ?? en.name) : cell(id);
    },
    [entities],
  );

  async function setActive(id: string, active: boolean) {
    setRowBusy(id);
    setRowError(null);
    try {
      await tenant(`/treasury-accounts/${id}/active`, {
        method: "POST",
        body: { active },
      });
      reload();
    } catch (e) {
      setRowError(errMsg(e));
    } finally {
      setRowBusy(null);
    }
  }

  return (
    <section className={pageShell.wide}>
      <PageHeader
        eyebrow={<HubCrumb area="Settings" to="/settings" />}
        title="Bank accounts"
        description="Company bank, cash and mobile-money accounts, each mapped to a chart-of-accounts code."
        action={
          <Button onClick={() => setCreateOpen(true)}>{tr("New account")}</Button>
        }
      />
      <HubTabs />

      <PageError message={rowError} />

      {error ? (
        <ErrorState message={error} />
      ) : rows === null ? (
        <SkeletonTable />
      ) : rows.length === 0 ? (
        <EmptyState
          title="No accounts yet"
          hint="Add a bank, cash or mobile-money account."
        />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>{tr("Label")}</TH>
              <TH>{tr("Kind")}</TH>
              <TH>{tr("Entity")}</TH>
              <TH>CoA</TH>
              <TH>{tr("Currency")}</TH>
              <TH>{tr("Status")}</TH>
              <TH>{tr("Actions")}</TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((r) => {
              const id = String(r.treasury_account_id);
              const active = r.is_active !== false;
              return (
                <TR key={id}>
                  <TD className="text-sm font-medium">{cell(r.label)}</TD>
                  <TD className="text-sm">{cell(r.kind)}</TD>
                  <TD className="text-sm">{entityName(r.entity_id)}</TD>
                  <TD className="num text-sm">{cell(r.coa_code)}</TD>
                  <TD className="text-sm">{cell(r.currency)}</TD>
                  <TD className="text-sm">
                    <Pill tone={active ? "ok" : "mute"}>
                      {active ? "Active" : "Inactive"}
                    </Pill>
                  </TD>
                  <TD>
                    <Button
                      size="sm"
                      variant={active ? "outline" : "default"}
                      loading={rowBusy === id}
                      onClick={() => setActive(id, !active)}
                    >
                      {active ? "Deactivate" : "Activate"}
                    </Button>
                  </TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      )}

      <NewAccountForm
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={reload}
        entities={entities || []}
      />
    </section>
  );
}

/* ─────────────────────── Payment gateways ─────────────────────── */
