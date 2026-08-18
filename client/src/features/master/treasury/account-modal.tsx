/**
 * Treasury account form — CREATE and EDIT, one component.
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
 *
 * ── EDIT MODE ───────────────────────────────────────────────────────────────
 * Pass `editing` and the same form becomes "Edit treasury account", submitting
 * a PATCH instead of a POST. A typo in an account number or a missing zero on
 * the opening balance is a correction, NOT a reason to deactivate the account
 * and mint a second CoA leaf — treasury accounts are never deleted (journal
 * history references the leaf), so editing is the only correct repair path.
 *
 * Two fields are deliberately NOT editable, because the backend refuses them
 * on PATCH (treasury_account.service#UPDATE_FIELDS):
 *
 *   entity_id    the account belongs to the corporate entity it was opened for
 *   category_id  the category chose the CoA parent, and the leaf is already
 *                minted under it — moving it would strand posted journal lines
 *
 * Renaming the account DOES rename its CoA leaf (the service keeps them in
 * sync), so the trial balance stays legible after a correction.
 */
import * as React from "react";
import { tr } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Modal, Field, Select } from "@/components/ui/modal";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { ErrorState } from "@/components/ui/states";
import { SearchSelect } from "@/components/ui/search-select";
import { errMsg, useList, type Row } from "@/lib/use-resource";
import { useToast } from "@/components/ui/toast";
import { cell } from "@/lib/format";
import * as api from "@/lib/treasury-api";
import { NewCategoryModal } from "./new-category-modal";

/** PG numerics arrive as strings ("15000000.00"); the number inputs want a
 *  bare value, and "" for "not set" so a blank field stays blank. */
const numStr = (v: string | number | null | undefined) => {
  if (v === null || v === undefined || v === "") return "";
  const n = Number(v);
  return Number.isFinite(n) ? String(n) : "";
};
const str = (v: string | null | undefined) =>
  v === null || v === undefined ? "" : String(v);
/** `opening_date` may come back as a date or a full ISO timestamp; <input
 *  type="date"> only accepts YYYY-MM-DD. */
const dateStr = (v: string | null | undefined) =>
  v ? String(v).slice(0, 10) : "";
/** Edit-mode patches send `null` (not `undefined`) to CLEAR a field — the
 *  validator marks these nullable, and omitting them would leave the old
 *  wrong value in place, which is the exact bug the edit button exists to fix. */
const orNull = (s: string) => (s.trim() === "" ? null : s.trim());

export function AccountModal({
  open,
  onClose,
  editing = null,
  custodianName = null,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  /** The account being corrected. Null/omitted → create mode. */
  editing?: api.TreasuryAccountRich | null;
  /** Display name for `editing.custodian_user_id`, so the picker shows who is
   *  currently on the hook rather than looking empty. */
  custodianName?: string | null;
  onSaved: (row: api.TreasuryAccountRich) => void;
}) {
  const isEdit = editing !== null && editing !== undefined;
  const { rows: entities } = useList("/entities");
  const [cats, setCats] = React.useState<api.TreasuryCategory[] | null>(null);
  React.useEffect(() => {
    if (!open) return;
    api
      .listCategories()
      // In edit mode the account's own category must stay in the list even if
      // it has since been deactivated — otherwise the form would render as if
      // the account had no category and hide every identity field.
      .then((rows) =>
        setCats(
          rows.filter(
            (c) =>
              c.is_active || c.treasury_category_id === editing?.category_id,
          ),
        ),
      )
      // Class E (degraded read). In edit mode the identity blocks still render
      // from the account's own category join, so the form stays usable — but a
      // create can't pick a category at all, so never swallow this.
      .catch((e) => {
        setCats([]);
        setError(errMsg(e));
      });
  }, [open, editing?.category_id]);

  const [entityId, setEntityId] = React.useState("");
  const [categoryId, setCategoryId] = React.useState("");
  const [label, setLabel] = React.useState("");
  const [currency, setCurrency] = React.useState("XAF");

  // Bank identity
  const [bankName, setBankName] = React.useState("");
  const [branch, setBranch] = React.useState("");
  const [acctNum, setAcctNum] = React.useState("");
  const [iban, setIban] = React.useState("");
  const [swift, setSwift] = React.useState("");
  const [routing, setRouting] = React.useState("");
  const [holder, setHolder] = React.useState("");

  // Cash / petty
  const [custodian, setCustodian] = React.useState("");
  const [custodianLabel, setCustodianLabel] = React.useState<string | null>(
    null,
  );
  const [location, setLocation] = React.useState("");
  const [floatLimit, setFloatLimit] = React.useState("");

  // MoMo
  const [momoNumber, setMomoNumber] = React.useState("");
  const [momoTill, setMomoTill] = React.useState("");
  const [momoAgent, setMomoAgent] = React.useState("");

  // Opening + statement
  const [openBal, setOpenBal] = React.useState("");
  const [openDate, setOpenDate] = React.useState("");
  const [stmtDay, setStmtDay] = React.useState("");
  const [markPrimary, setMarkPrimary] = React.useState(false);

  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [newCatOpen, setNewCatOpen] = React.useState(false);
  const toast = useToast();

  // Reset on open — from the account in edit mode, from blank in create mode.
  React.useEffect(() => {
    if (!open) return;
    const a = editing;
    setEntityId(a ? String(a.entity_id) : "");
    setCategoryId(a?.category_id ? String(a.category_id) : "");
    setLabel(str(a?.label));
    setCurrency(a?.currency ? String(a.currency) : "XAF");
    setBankName(str(a?.bank_name));
    setBranch(str(a?.branch));
    setAcctNum(str(a?.account_number));
    setIban(str(a?.iban));
    setSwift(str(a?.swift_bic));
    setRouting(str(a?.routing_code));
    setHolder(str(a?.holder_name));
    setCustodian(str(a?.custodian_user_id));
    setCustodianLabel(a?.custodian_user_id ? custodianName : null);
    setLocation(str(a?.location));
    setFloatLimit(numStr(a?.float_limit));
    setMomoNumber(str(a?.momo_number));
    setMomoTill(str(a?.momo_till));
    setMomoAgent(str(a?.momo_agent));
    setOpenBal(numStr(a?.opening_balance));
    setOpenDate(dateStr(a?.opening_date));
    setStmtDay(a?.statement_day != null ? String(a.statement_day) : "");
    setMarkPrimary(false);
    setError(null);
    // Keyed on the ACCOUNT ID, not the object: the dossier hands us a fresh
    // `editing` object on every refetch, and depending on its identity would
    // wipe half-typed corrections out from under the user.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing?.treasury_account_id, custodianName]);

  const category = React.useMemo(
    () =>
      (cats || []).find((c) => c.treasury_category_id === categoryId) || null,
    [cats, categoryId],
  );

  // Until the category list lands, fall back to the flags the account row
  // already carries from its category join, so an edit form opened cold still
  // renders the right identity block on the first paint.
  const showBank =
    category !== null
      ? category.is_bank_identity === true
      : editing?.category_is_bank_identity === true;
  const showMomo =
    category !== null
      ? category.is_momo_identity === true
      : editing?.category_is_momo_identity === true;
  const needCust =
    category !== null
      ? category.requires_custodian === true
      : editing?.category_requires_custodian === true;

  const canSubmit =
    !!label.trim() &&
    (isEdit || (!!entityId && !!categoryId)) &&
    (!needCust || !!custodian) &&
    !busy;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const saved = isEdit ? await submitEdit() : await submitCreate();
      toast.success(
        isEdit ? "Treasury account updated" : "Treasury account created",
      );
      onSaved(saved);
      onClose();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  async function submitCreate() {
    const body: api.CreateAccountBody = {
      entity_id: entityId,
      category_id: categoryId,
      label: label.trim(),
      currency: currency.trim().toUpperCase() || undefined,
    };
    if (showBank) {
      if (bankName.trim()) body.bank_name = bankName.trim();
      if (branch.trim()) body.branch = branch.trim();
      if (acctNum.trim()) body.account_number = acctNum.trim();
      if (iban.trim()) body.iban = iban.trim();
      if (swift.trim()) body.swift_bic = swift.trim();
      if (routing.trim()) body.routing_code = routing.trim();
      if (holder.trim()) body.holder_name = holder.trim();
    }
    if (showMomo) {
      if (momoNumber.trim()) body.momo_number = momoNumber.trim();
      if (momoTill.trim()) body.momo_till = momoTill.trim();
      if (momoAgent.trim()) body.momo_agent = momoAgent.trim();
    }
    if (needCust) {
      body.custodian_user_id = custodian;
      if (location.trim()) body.location = location.trim();
      if (floatLimit.trim()) body.float_limit = Number(floatLimit);
    }
    if (openBal.trim()) body.opening_balance = Number(openBal);
    if (openDate) body.opening_date = openDate;
    if (stmtDay.trim()) body.statement_day = Number(stmtDay);

    const created = await api.createAccount(body);
    if (markPrimary) {
      // B2 (class F — mutation). The previous try/catch swallowed a failing
      // setAccountPrimary silently, so the user ticked "primary", the modal
      // closed, and the flag was never set. Now the create still counts
      // (the account exists), but the follow-up failure is surfaced as a
      // warning toast so the user knows they need to re-set primary from
      // the row's menu. The account itself is not rolled back — deleting
      // a treasury_account is not a lightweight action, and the row is
      // recoverable state; a lie about "primary" is not.
      try {
        await api.setAccountPrimary(created.treasury_account_id);
      } catch (e) {
        toast.error(
          `Account created, but couldn't set it as primary — ${errMsg(e)}`,
        );
      }
    }
    return created;
  }

  async function submitEdit() {
    const a = editing!;
    // Send every field the form SHOWS, clearing with null what the user
    // emptied. Fields hidden by the category (a bank block on a cash account)
    // are left untouched rather than nulled — the form never gave the user a
    // chance to see them.
    const patch: api.UpdateAccountBody = { label: label.trim() };
    if (currency.trim()) patch.currency = currency.trim().toUpperCase();
    if (showBank) {
      patch.bank_name = orNull(bankName);
      patch.branch = orNull(branch);
      patch.account_number = orNull(acctNum);
      patch.iban = orNull(iban);
      patch.swift_bic = orNull(swift);
      patch.routing_code = orNull(routing);
      patch.holder_name = orNull(holder);
    }
    if (showMomo) {
      patch.momo_number = orNull(momoNumber);
      patch.momo_till = orNull(momoTill);
      patch.momo_agent = orNull(momoAgent);
    }
    if (needCust) {
      // The backend refuses to clear a custodian on a category that requires
      // one, and `canSubmit` already blocks an empty picker, so this is only
      // ever a real id.
      patch.custodian_user_id = custodian;
      patch.location = orNull(location);
      patch.float_limit = floatLimit.trim() === "" ? null : Number(floatLimit);
    }
    // `opening_balance` is NOT nullable on the wire (it is a numeric column
    // with a 0 default), so a blank box means "leave it alone" rather than
    // "clear it" — type 0 to zero it out.
    if (openBal.trim() !== "") patch.opening_balance = Number(openBal);
    patch.opening_date = openDate ? openDate : null;
    patch.statement_day = stmtDay.trim() === "" ? null : Number(stmtDay);

    return api.updateAccount(a.treasury_account_id, patch);
  }

  const entityText = (en: Row) =>
    en.code
      ? `${cell(en.code)} — ${cell(en.legal_name ?? en.name ?? en.entity_id)}`
      : cell(en.legal_name ?? en.name ?? en.entity_id);
  const entityLabel = (() => {
    const en = (entities || []).find((e) => String(e.entity_id) === entityId);
    return en ? entityText(en) : null;
  })();
  const userText = (u: Row) =>
    cell(u.full_name ?? u.name ?? u.email ?? u.user_id);

  // Changing the numbers a treasurer signed off on invalidates that sign-off.
  // The stamp is not cleared automatically (that is the backend's call), so
  // say it out loud instead of letting a verified badge vouch for edited data.
  const showVerifiedWarning = isEdit && editing?.is_verified === true;

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title={isEdit ? "Edit treasury account" : "New treasury account"}
        description={
          isEdit
            ? "Correct the account's identity, opening balance or statement day. The entity, category and CoA leaf are fixed once the account exists."
            : "A bank, cash, petty-cash or mobile-money account. The CoA leaf is minted automatically under the category's parent."
        }
      >
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            {isEdit ? (
              <Field
                label={tr("Corporate entity")}
                className="sm:col-span-2"
                hint="Fixed after creation — the account belongs to this entity's books."
              >
                <Input value={entityLabel || "—"} readOnly disabled />
              </Field>
            ) : (
              <Field
                label={tr("Corporate entity")}
                required
                className="sm:col-span-2"
              >
                <SearchSelect
                  path="/entities"
                  label={tr("Corporate entity")}
                  value={entityLabel}
                  placeholder={tr("Search entities…")}
                  getLabel={entityText}
                  getKey={(en) => String(en.entity_id)}
                  onSelect={(en) => setEntityId(String(en.entity_id))}
                />
              </Field>
            )}
            {isEdit ? (
              <Field
                label={tr("Category")}
                hint="Fixed after creation — the CoA leaf is already minted under this category's parent."
              >
                <Input
                  value={
                    category?.label ||
                    editing?.category_label ||
                    editing?.category_code ||
                    "—"
                  }
                  readOnly
                  disabled
                />
              </Field>
            ) : (
              <Field
                label={tr("Category")}
                required
                hint="Bank / Cash / Petty Cash / MTN / Orange / …"
              >
                <div className="flex items-center gap-2">
                  <Select
                    value={categoryId}
                    onChange={(e) => setCategoryId(e.target.value)}
                    className="flex-1"
                  >
                    <option value="">{tr("— pick —")}</option>
                    {(cats || []).map((c) => (
                      <option
                        key={c.treasury_category_id}
                        value={c.treasury_category_id}
                      >
                        {c.label}
                        {c.is_system ? "" : " ★"}
                      </option>
                    ))}
                  </Select>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setNewCatOpen(true)}
                  >
                    + New
                  </Button>
                </div>
              </Field>
            )}
            <Field label={tr("Currency")} hint={tr("ISO code")}>
              <Input
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                placeholder={tr("XAF")}
              />
            </Field>
            <Field
              label={tr("Label")}
              required
              className="sm:col-span-2"
              hint={
                isEdit
                  ? "Renaming the account renames its CoA leaf too."
                  : "Shown on the letterhead and on every posting"
              }
            >
              <Input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Afriland — Main XAF"
              />
            </Field>
          </div>

          {showVerifiedWarning && (
            <p className="rounded-lg border border-warn/40 bg-warn/5 p-3 text-xs text-muted-foreground">
              This account is marked <strong>verified</strong>. Saving a change
              here does not clear that stamp — un-verify and re-verify it
              against the bank letter once the numbers are right.
            </p>
          )}

          {showBank && (
            <fieldset className="grid gap-4 rounded-lg border p-3 sm:grid-cols-2">
              <legend className="px-1 text-sm font-medium">
                Bank identity
              </legend>
              <Field label="Bank name">
                <Input
                  value={bankName}
                  onChange={(e) => setBankName(e.target.value)}
                  placeholder="Afriland First Bank"
                />
              </Field>
              <Field label={tr("Branch")}>
                <Input
                  value={branch}
                  onChange={(e) => setBranch(e.target.value)}
                  placeholder="Douala — Bonanjo"
                />
              </Field>
              <Field label={tr("Account number")}>
                <Input
                  value={acctNum}
                  onChange={(e) => setAcctNum(e.target.value)}
                />
              </Field>
              <Field label={tr("IBAN")}>
                <Input
                  value={iban}
                  onChange={(e) => setIban(e.target.value)}
                  placeholder="CM21 …"
                />
              </Field>
              <Field label="SWIFT / BIC">
                <Input
                  value={swift}
                  onChange={(e) => setSwift(e.target.value)}
                  placeholder="CCEICMCX"
                />
              </Field>
              <Field label="Routing code">
                <Input
                  value={routing}
                  onChange={(e) => setRouting(e.target.value)}
                />
              </Field>
              <Field label="Holder name" className="sm:col-span-2">
                <Input
                  value={holder}
                  onChange={(e) => setHolder(e.target.value)}
                  placeholder="Praxis Sarl"
                />
              </Field>
            </fieldset>
          )}

          {showMomo && (
            <fieldset className="grid gap-4 rounded-lg border p-3 sm:grid-cols-3">
              <legend className="px-1 text-sm font-medium">
                Mobile-money identity
              </legend>
              <Field label="MoMo number">
                <Input
                  value={momoNumber}
                  onChange={(e) => setMomoNumber(e.target.value)}
                  placeholder="+237 6 …"
                />
              </Field>
              <Field label="Till / Paybill">
                <Input
                  value={momoTill}
                  onChange={(e) => setMomoTill(e.target.value)}
                />
              </Field>
              <Field label="Merchant / Agent code">
                <Input
                  value={momoAgent}
                  onChange={(e) => setMomoAgent(e.target.value)}
                />
              </Field>
            </fieldset>
          )}

          {needCust && (
            <fieldset className="grid gap-4 rounded-lg border p-3 sm:grid-cols-2">
              <legend className="px-1 text-sm font-medium">
                Custodian (petty cash)
              </legend>
              <Field
                label={tr("Custodian")}
                required
                className="sm:col-span-2"
                hint="The person responsible for payouts from this account — feeds the expenses sheet."
              >
                <SearchSelect
                  path="/users"
                  label={tr("Custodian")}
                  value={custodianLabel}
                  placeholder="Search users…"
                  getLabel={userText}
                  getKey={(u) => String(u.user_id)}
                  onSelect={(u) => {
                    setCustodian(String(u.user_id));
                    setCustodianLabel(userText(u));
                  }}
                />
              </Field>
              <Field label={tr("Location")}>
                <Input
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="Yaoundé office"
                />
              </Field>
              <Field label="Float limit" hint="Maximum outstanding cash held">
                <Input
                  type="number"
                  value={floatLimit}
                  onChange={(e) => setFloatLimit(e.target.value)}
                  placeholder="200000"
                />
              </Field>
            </fieldset>
          )}

          <fieldset className="grid gap-4 rounded-lg border p-3 sm:grid-cols-3">
            <legend className="px-1 text-sm font-medium">
              Opening &amp; statement
            </legend>
            <Field
              label={tr("Opening balance")}
              hint={
                isEdit
                  ? "Not a journal entry — the 360 reads it as the starting point, so correcting it is safe."
                  : undefined
              }
            >
              <Input
                type="number"
                value={openBal}
                onChange={(e) => setOpenBal(e.target.value)}
                placeholder="0"
              />
            </Field>
            <Field label="Opening date">
              <Input
                type="date"
                value={openDate}
                onChange={(e) => setOpenDate(e.target.value)}
              />
            </Field>
            <Field
              label="Statement day"
              hint="Day of the month the bank issues a statement (1–31)"
            >
              <Input
                type="number"
                min={1}
                max={31}
                value={stmtDay}
                onChange={(e) => setStmtDay(e.target.value)}
              />
            </Field>
          </fieldset>

          {!isEdit && (
            <Checkbox
              checked={markPrimary}
              onCheckedChange={(v) => setMarkPrimary(v === true)}
              label="Mark as primary for this entity + category"
            />
          )}

          {!isEdit && (entities || []).length === 0 && (
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
              {isEdit ? "Save changes" : "Create account"}
            </Button>
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
