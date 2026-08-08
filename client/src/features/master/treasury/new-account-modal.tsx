/**
 * "New treasury account" — the rich creation form.
 *
 * The form is CATEGORY-DRIVEN: the category picker is at the top, and the
 * fields below it appear/disappear based on the category's flags:
 *
 *   is_bank_identity   → bank_name, branch, account_number, IBAN, SWIFT, holder
 *   is_momo_identity   → momo_number, momo_till, momo_agent
 *   requires_custodian → custodian_user_id (mandatory), float_limit, location
 *
 * The CoA leaf code is not asked for — the backend auto-mints it under the
 * category's parent (521101, 571101, 538110, …). See
 * src/modules/master/treasury_account/treasury_account.rules.js#nextLeafCode.
 *
 * The picker has a "+ New category" action next to it, so a treasurer can add
 * Airtel SmartCash inline the day it arrives without leaving this form.
 */
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Modal, Field, Select } from "@/components/ui/modal";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { ErrorState } from "@/components/ui/states";
import { SearchSelect } from "@/components/ui/search-select";
import { errMsg, useList, type Row } from "@/lib/use-resource";
import { cell } from "@/lib/format";
import * as api from "@/lib/treasury-api";
import { NewCategoryModal } from "./new-category-modal";

export function NewAccountModal({
  open, onClose, onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (created: api.TreasuryAccountRich) => void;
}) {
  const { rows: entities } = useList("/entities");
  const [cats, setCats] = React.useState<api.TreasuryCategory[] | null>(null);
  React.useEffect(() => {
    if (!open) return;
    api.listCategories().then((rows) => setCats(rows.filter((c) => c.is_active)));
  }, [open]);

  const [entityId, setEntityId]     = React.useState("");
  const [categoryId, setCategoryId] = React.useState("");
  const [label, setLabel]           = React.useState("");
  const [currency, setCurrency]     = React.useState("XAF");

  // Bank identity
  const [bankName, setBankName]     = React.useState("");
  const [branch, setBranch]         = React.useState("");
  const [acctNum, setAcctNum]       = React.useState("");
  const [iban, setIban]             = React.useState("");
  const [swift, setSwift]           = React.useState("");
  const [routing, setRouting]       = React.useState("");
  const [holder, setHolder]         = React.useState("");

  // Cash / petty
  const [custodian, setCustodian]   = React.useState("");
  const [custodianLabel, setCustodianLabel] = React.useState<string | null>(null);
  const [location, setLocation]     = React.useState("");
  const [floatLimit, setFloatLimit] = React.useState("");

  // MoMo
  const [momoNumber, setMomoNumber] = React.useState("");
  const [momoTill, setMomoTill]     = React.useState("");
  const [momoAgent, setMomoAgent]   = React.useState("");

  // Opening + statement
  const [openBal, setOpenBal]       = React.useState("");
  const [openDate, setOpenDate]     = React.useState("");
  const [stmtDay, setStmtDay]       = React.useState("");
  const [markPrimary, setMarkPrimary] = React.useState(false);

  const [busy, setBusy]             = React.useState(false);
  const [error, setError]           = React.useState<string | null>(null);
  const [newCatOpen, setNewCatOpen] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setEntityId(""); setCategoryId(""); setLabel(""); setCurrency("XAF");
    setBankName(""); setBranch(""); setAcctNum(""); setIban(""); setSwift(""); setRouting(""); setHolder("");
    setCustodian(""); setCustodianLabel(null); setLocation(""); setFloatLimit("");
    setMomoNumber(""); setMomoTill(""); setMomoAgent("");
    setOpenBal(""); setOpenDate(""); setStmtDay(""); setMarkPrimary(false);
    setError(null);
  }, [open]);

  const category = React.useMemo(
    () => (cats || []).find((c) => c.treasury_category_id === categoryId) || null,
    [cats, categoryId],
  );

  const showBank = category?.is_bank_identity === true;
  const showMomo = category?.is_momo_identity === true;
  const needCust = category?.requires_custodian === true;

  const canSubmit = !!entityId && !!categoryId && !!label.trim()
    && (!needCust || !!custodian) && !busy;

  async function submit() {
    setBusy(true); setError(null);
    try {
      const body: api.CreateAccountBody = {
        entity_id: entityId,
        category_id: categoryId,
        label: label.trim(),
        currency: currency.trim().toUpperCase() || undefined,
      };
      if (showBank) {
        if (bankName.trim()) body.bank_name = bankName.trim();
        if (branch.trim())   body.branch    = branch.trim();
        if (acctNum.trim())  body.account_number = acctNum.trim();
        if (iban.trim())     body.iban     = iban.trim();
        if (swift.trim())    body.swift_bic = swift.trim();
        if (routing.trim())  body.routing_code = routing.trim();
        if (holder.trim())   body.holder_name = holder.trim();
      }
      if (showMomo) {
        if (momoNumber.trim()) body.momo_number = momoNumber.trim();
        if (momoTill.trim())   body.momo_till   = momoTill.trim();
        if (momoAgent.trim())  body.momo_agent  = momoAgent.trim();
      }
      if (needCust) {
        body.custodian_user_id = custodian;
        if (location.trim()) body.location = location.trim();
        if (floatLimit.trim()) body.float_limit = Number(floatLimit);
      }
      if (openBal.trim())  body.opening_balance = Number(openBal);
      if (openDate)        body.opening_date = openDate;
      if (stmtDay.trim())  body.statement_day = Number(stmtDay);

      const created = await api.createAccount(body);
      if (markPrimary) {
        try { await api.setAccountPrimary(created.treasury_account_id); } catch { /* soft */ }
      }
      onCreated(created);
      onClose();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  const entityText = (en: Row) => (en.code
    ? `${cell(en.code)} — ${cell(en.legal_name ?? en.name ?? en.entity_id)}`
    : cell(en.legal_name ?? en.name ?? en.entity_id));
  const entityLabel = (() => { const en = (entities || []).find((e) => String(e.entity_id) === entityId); return en ? entityText(en) : null; })();
  const userText = (u: Row) => cell(u.full_name ?? u.name ?? u.email ?? u.user_id);

  return (
    <>
      <Modal open={open} onClose={onClose} title="New treasury account" description="A bank, cash, petty-cash or mobile-money account. The CoA leaf is minted automatically under the category's parent.">
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Corporate entity" required className="sm:col-span-2">
              <SearchSelect
                path="/entities" value={entityLabel}
                placeholder="Search entities…"
                getLabel={entityText}
                getKey={(en) => String(en.entity_id)}
                onSelect={(en) => setEntityId(String(en.entity_id))}
              />
            </Field>
            <Field label="Category" required hint="Bank / Cash / Petty Cash / MTN / Orange / …">
              <div className="flex items-center gap-2">
                <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="flex-1">
                  <option value="">— pick —</option>
                  {(cats || []).map((c) => (
                    <option key={c.treasury_category_id} value={c.treasury_category_id}>
                      {c.label}{c.is_system ? "" : " ★"}
                    </option>
                  ))}
                </Select>
                <Button variant="outline" size="sm" onClick={() => setNewCatOpen(true)}>+ New</Button>
              </div>
            </Field>
            <Field label="Currency" hint="ISO code">
              <Input value={currency} onChange={(e) => setCurrency(e.target.value)} placeholder="XAF" />
            </Field>
            <Field label="Label" required className="sm:col-span-2" hint="Shown on the letterhead and on every posting">
              <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Afriland — Main XAF" />
            </Field>
          </div>

          {showBank && (
            <fieldset className="grid gap-4 rounded-lg border p-3 sm:grid-cols-2">
              <legend className="px-1 text-sm font-medium">Bank identity</legend>
              <Field label="Bank name"><Input value={bankName} onChange={(e) => setBankName(e.target.value)} placeholder="Afriland First Bank" /></Field>
              <Field label="Branch"><Input value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="Douala — Bonanjo" /></Field>
              <Field label="Account number"><Input value={acctNum} onChange={(e) => setAcctNum(e.target.value)} /></Field>
              <Field label="IBAN"><Input value={iban} onChange={(e) => setIban(e.target.value)} placeholder="CM21 …" /></Field>
              <Field label="SWIFT / BIC"><Input value={swift} onChange={(e) => setSwift(e.target.value)} placeholder="CCEICMCX" /></Field>
              <Field label="Routing code"><Input value={routing} onChange={(e) => setRouting(e.target.value)} /></Field>
              <Field label="Holder name" className="sm:col-span-2"><Input value={holder} onChange={(e) => setHolder(e.target.value)} placeholder="Praxis Sarl" /></Field>
            </fieldset>
          )}

          {showMomo && (
            <fieldset className="grid gap-4 rounded-lg border p-3 sm:grid-cols-3">
              <legend className="px-1 text-sm font-medium">Mobile-money identity</legend>
              <Field label="MoMo number"><Input value={momoNumber} onChange={(e) => setMomoNumber(e.target.value)} placeholder="+237 6 …" /></Field>
              <Field label="Till / Paybill"><Input value={momoTill} onChange={(e) => setMomoTill(e.target.value)} /></Field>
              <Field label="Merchant / Agent code"><Input value={momoAgent} onChange={(e) => setMomoAgent(e.target.value)} /></Field>
            </fieldset>
          )}

          {needCust && (
            <fieldset className="grid gap-4 rounded-lg border p-3 sm:grid-cols-2">
              <legend className="px-1 text-sm font-medium">Custodian (petty cash)</legend>
              <Field label="Custodian" required className="sm:col-span-2" hint="The person responsible for payouts from this account — feeds the expenses sheet.">
                <SearchSelect
                  path="/users" value={custodianLabel}
                  placeholder="Search users…"
                  getLabel={userText}
                  getKey={(u) => String(u.user_id)}
                  onSelect={(u) => { setCustodian(String(u.user_id)); setCustodianLabel(userText(u)); }}
                />
              </Field>
              <Field label="Location"><Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Yaoundé office" /></Field>
              <Field label="Float limit" hint="Maximum outstanding cash held"><Input type="number" value={floatLimit} onChange={(e) => setFloatLimit(e.target.value)} placeholder="200000" /></Field>
            </fieldset>
          )}

          <fieldset className="grid gap-4 rounded-lg border p-3 sm:grid-cols-3">
            <legend className="px-1 text-sm font-medium">Opening &amp; statement</legend>
            <Field label="Opening balance"><Input type="number" value={openBal} onChange={(e) => setOpenBal(e.target.value)} placeholder="0" /></Field>
            <Field label="Opening date"><Input type="date" value={openDate} onChange={(e) => setOpenDate(e.target.value)} /></Field>
            <Field label="Statement day" hint="Day of the month the bank issues a statement (1–31)"><Input type="number" min={1} max={31} value={stmtDay} onChange={(e) => setStmtDay(e.target.value)} /></Field>
          </fieldset>

          <Checkbox
            checked={markPrimary}
            onCheckedChange={(v) => setMarkPrimary(v === true)}
            label="Mark as primary for this entity + category"
          />

          {(entities || []).length === 0 && <p className="text-xs text-muted-foreground">No corporate entities found — create one under Master data → Corporate entities first.</p>}
          {error && <ErrorState message={error} />}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button onClick={submit} loading={busy} disabled={!canSubmit}>Create account</Button>
          </div>
        </div>
      </Modal>

      <NewCategoryModal
        open={newCatOpen}
        onClose={() => setNewCatOpen(false)}
        onCreated={async (c) => {
          const rows = await api.listCategories();
          setCats(rows.filter((r) => r.is_active));
          setCategoryId(c.treasury_category_id);
        }}
      />
    </>
  );
}
