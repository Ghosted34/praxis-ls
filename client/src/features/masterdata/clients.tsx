/**
 * Master data — clients.
 *
 * Split out of `features/masterdata/pages.tsx` (682 lines) in Phase 4, audit F7.
 */

import * as React from "react";
import { ScreenAi } from "@/components/screen-ai";
import { Button } from "@/components/ui/button";
import { FormButtons } from "@/components/ui/form-buttons";
import { Input } from "@/components/ui/input";
import { Modal, Select } from "@/components/ui/modal";
import { Checkbox } from "@/components/ui/checkbox";
import { Form, FormField, FormError } from "@/components/ui/form";
import { useZodForm } from "@/lib/use-zod-form";
import { useToast } from "@/components/ui/toast";
import { clientMaster } from "@shared";
import { PageHeader, DataList, type Column } from "@/components/data-list";
import { SmartCountryPicker } from "@/components/smart-country-picker";
import {
  CountryRegistrationFields,
  useCountryRegistrations,
  toRegistrationsPayload,
  type RegValues,
} from "./country-registration-fields";
import { DedupeHint } from "./dedupe-hint";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { Pill, ActivePill } from "@/components/ui/pill";
import { useList } from "@/lib/use-resource";
import { money, num } from "@/lib/format";
import * as api from "@/lib/masterdata-api";
import { shell } from "./shared";

/* ══════════════════════════════ Clients ═════════════════════════ */

/**
 * The client master form — on `<Form>` + `clientMaster` from `@praxis/shared`.
 *
 * The counterpart to the journal entry: that one showed where domain rules do
 * NOT belong in a schema, this is the ordinary case where everything does. It is
 * also the highest-traffic write form in the product — every dossier, invoice
 * and receipt starts from a client record.
 *
 * WHAT THE HAND-ROLLED VERSION GOT WRONG. Its gate was `disabled={!name}`, so
 * everything except a missing name reached the server:
 *
 *   - `email` was `<Input type="email">` inside a `noValidate` form, which means
 *     the browser check never ran. "billing@" submitted, and came back a 422
 *     with a message the form had no field to attach it to.
 *   - `payment_terms_days` was `Number(terms)`, so "45.5" became 45.5 and the
 *     API's `z.number().int()` refused it — after the round trip.
 *   - Fourteen `useState` calls and a hand-built payload object, which is where
 *     `credit_limit: credit === "" ? undefined : Number(credit)` lived: the
 *     empty-string handling the schema now owns.
 *
 * All three now fail at the field, before the request, with the message the API
 * would have produced — because it is the API's schema.
 */
export function ClientForm({
  row,
  onClose,
  onSaved,
}: {
  row: (api.Client & Partial<api.PartyExtras>) | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isNew = row === null;
  const { rows: entities } = useList<api.Entity>("/entities");
  const toast = useToast();

  // `update` rather than `create` when editing: it is the schema that allows a
  // partial name and carries `is_active`, which is exactly the difference.
  const form = useZodForm(isNew ? clientMaster.create : clientMaster.update, {
    defaultValues: {
      name: row?.name ?? "",
      legal_name: row?.legal_name ?? row?.name ?? "",
      trading_name: row?.trading_name ?? "",
      entity_id: row?.entity_id ?? "",
      email: row?.email ?? "",
      country_code: row?.country_code ?? "CM",
      payment_terms_days:
        row?.payment_terms_days != null ? String(row.payment_terms_days) : "",
      credit_limit: row?.credit_limit != null ? String(row.credit_limit) : "",
      is_withholding_agent: row?.is_withholding_agent ?? false,
      ...(isNew ? {} : { is_active: row?.is_active ?? true }),
    },
  });

  // Country drives the dynamic registration IDs (§2.2). Registrations and the
  // primary contact/address are local state, merged into the payload on submit —
  // the service writes them as their own rows.
  const country = String(form.watch("country_code") ?? "");
  const reqs = useCountryRegistrations(country);
  const [regs, setRegs] = React.useState<RegValues>(() => ({
    NIU: row?.niu ?? "",
    RCCM: row?.rccm ?? "",
  }));
  const [contact, setContact] = React.useState({
    name: "",
    email: "",
    phone: "",
  });
  const [address, setAddress] = React.useState({
    line1: row?.address ?? "",
    city: row?.city ?? "",
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={isNew ? "New client" : "Edit client"}
      description="Customer master record — country, registrations, contact and terms."
    >
      <Form
        form={form}
        className="space-y-4"
        onSubmit={async (values) => {
          const v = values as api.ClientInput & {
            legal_name?: string;
            trading_name?: string;
          };
          // Keep the legacy `name` column populated from the legal (or trading)
          // name for every FK/report that reads it (§2.1).
          const name =
            (v.legal_name || "").trim() ||
            (v.trading_name || "").trim() ||
            v.name;
          const primary_contact = contact.name.trim()
            ? {
                name: contact.name.trim(),
                email: contact.email.trim() || undefined,
                phone: contact.phone.trim() || undefined,
              }
            : undefined;
          const primary_address =
            address.line1.trim() || address.city.trim()
              ? {
                  line1: address.line1.trim() || undefined,
                  city: address.city.trim() || undefined,
                  country_code: country || undefined,
                }
              : undefined;
          const body: api.ClientInput = {
            ...v,
            name,
            registrations: toRegistrationsPayload(reqs, regs, country),
            ...(isNew ? { primary_contact, primary_address } : {}),
          };
          if (isNew) await api.createClient(body);
          else await api.updateClient(row!.client_id, body);
          toast.success(isNew ? "Client created" : "Client saved");
          onSaved();
          onClose();
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          {/* 1 · Identity — country first, it drives the registration IDs. */}
          <FormField
            form={form}
            name="country_code"
            label="Country"
            required
            className="sm:col-span-2"
          >
            {(field) => (
              <SmartCountryPicker
                value={String(field.value ?? "")}
                onChange={field.onChange}
                allowEmpty={false}
              />
            )}
          </FormField>
          <FormField form={form} name="legal_name" label="Legal name" required>
            {(field) => (
              <Input
                {...field}
                value={String(field.value ?? "")}
                placeholder="Acme SA"
              />
            )}
          </FormField>
          <FormField form={form} name="trading_name" label="Trading / DBA name">
            {(field) => (
              <Input
                {...field}
                value={String(field.value ?? "")}
                placeholder="Acme"
              />
            )}
          </FormField>

          {/* 2 · Country-driven tax / legal IDs. */}
          <div className="sm:col-span-2 pt-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Tax &amp; legal registration
          </div>
          <CountryRegistrationFields
            country={country}
            values={regs}
            onChange={setRegs}
          />

          {/* Non-blocking duplicate detection (§5.1) — advisory, dismissible. */}
          <DedupeHint
            kind="client"
            legalName={String(form.watch("legal_name") ?? "")}
            name={String(form.watch("trading_name") ?? "")}
            email={contact.email || String(form.watch("email") ?? "")}
            excludeId={isNew ? undefined : row?.client_id}
            registrations={[
              { kind: "NIU", number: regs.NIU },
              { kind: "RCCM", number: regs.RCCM },
            ].filter((r) => r.number)}
          />

          <FormField
            form={form}
            name="entity_id"
            label="Corporate entity"
            hint="Which of our entities bills this client"
          >
            {(field) => (
              <Select {...field} value={String(field.value ?? "")}>
                <option value="">—</option>
                {(entities || []).map((en) => (
                  <option key={en.entity_id} value={en.entity_id}>
                    {en.legal_name || en.code}
                  </option>
                ))}
              </Select>
            )}
          </FormField>

          {/* 3 · Primary contact + address (new-client only; edit adds more in the 360). */}
          {isNew && (
            <>
              <div className="sm:col-span-2 pt-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Primary contact &amp; address
              </div>
              <label className="space-y-1.5">
                <span className="block text-sm font-medium text-foreground">
                  Contact name
                </span>
                <Input
                  value={contact.name}
                  onChange={(e) =>
                    setContact({ ...contact, name: e.target.value })
                  }
                  placeholder="Awa Njoya"
                />
              </label>
              <label className="space-y-1.5">
                <span className="block text-sm font-medium text-foreground">
                  Contact email
                </span>
                <Input
                  type="email"
                  value={contact.email}
                  onChange={(e) =>
                    setContact({ ...contact, email: e.target.value })
                  }
                  placeholder="billing@client.cm"
                />
              </label>
              <label className="space-y-1.5">
                <span className="block text-sm font-medium text-foreground">
                  Address line
                </span>
                <Input
                  value={address.line1}
                  onChange={(e) =>
                    setAddress({ ...address, line1: e.target.value })
                  }
                  placeholder="Akwa"
                />
              </label>
              <label className="space-y-1.5">
                <span className="block text-sm font-medium text-foreground">
                  City
                </span>
                <Input
                  value={address.city}
                  onChange={(e) =>
                    setAddress({ ...address, city: e.target.value })
                  }
                  placeholder="Douala"
                />
              </label>
            </>
          )}

          {/* 4 · Finance terms. */}
          <div className="sm:col-span-2 pt-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Finance terms
          </div>
          <FormField
            form={form}
            name="payment_terms_days"
            label="Payment terms (days)"
          >
            {(field) => (
              <Input
                type="number"
                min="0"
                className="num text-right"
                placeholder="30"
                {...field}
                value={String(field.value ?? "")}
              />
            )}
          </FormField>
          <FormField form={form} name="credit_limit" label="Credit limit (XAF)">
            {(field) => (
              <Input
                type="number"
                min="0"
                step="0.01"
                className="num text-right"
                {...field}
                value={String(field.value ?? "")}
              />
            )}
          </FormField>
          <FormField
            form={form}
            name="email"
            label="Billing email"
            hint="Used to send invoices & receipts"
          >
            {(field) => (
              <Input
                type="email"
                placeholder="ap@client.cm"
                {...field}
                value={String(field.value ?? "")}
              />
            )}
          </FormField>
          <FormField
            form={form}
            name="is_withholding_agent"
            label="Withholding agent"
          >
            {(field) => (
              <Checkbox
                checked={!!field.value}
                onCheckedChange={field.onChange}
                label={<span className="sr-only">Withholding agent</span>}
              />
            )}
          </FormField>
          {!isNew && (
            <FormField form={form} name="is_active" label="Active">
              {(field) => (
                <Checkbox
                  checked={field.value !== false}
                  onCheckedChange={field.onChange}
                  label={<span className="sr-only">Active</span>}
                />
              )}
            </FormField>
          )}
        </div>
        <FormError form={form} />
        {/*
          `disabled` is now only "already submitting". The old `!name` gate was
          the form's entire opinion about validity; the schema has the rest, and
          it reports at the field rather than by greying out Save with no
          explanation of what is missing.
        */}
        <FormButtons
          busy={form.formState.isSubmitting}
          disabled={form.formState.isSubmitting}
          onCancel={onClose}
          saveLabel={isNew ? "Create client" : "Save changes"}
        />
      </Form>
    </Modal>
  );
}

export function ClientsPage() {
  const { rows, error, loading, reload } = useList<api.Client>("/clients");
  const [editing, setEditing] = React.useState<api.Client | "new" | null>(null);
  const clients = rows || [];
  const totalCredit = clients.reduce(
    (s, c) => s + (Number(c.credit_limit) || 0),
    0,
  );

  const columns: Column<api.Client>[] = [
    {
      key: "name",
      label: "Client",
      render: (r) => (
        <span className="font-medium text-foreground">{r.name}</span>
      ),
    },
    { key: "niu", label: "NIU" },
    {
      key: "payment_terms_days",
      label: "Terms",
      render: (r) =>
        r.payment_terms_days != null ? `${r.payment_terms_days} d` : "—",
    },
    {
      key: "credit_limit",
      label: "Credit limit",
      className: "num text-right",
      render: (r) => money(r.credit_limit),
    },
    {
      key: "is_withholding_agent",
      label: "WHT",
      render: (r) =>
        r.is_withholding_agent ? (
          <Pill tone="blue">Agent</Pill>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      key: "is_active",
      label: "Status",
      render: (r) => <ActivePill active={r.is_active} />,
    },
  ];

  return (
    <section className={shell}>
      <PageHeader
        title="Clients"
        description="Customer master — terms, credit and withholding status."
        action={<Button onClick={() => setEditing("new")}>New client</Button>}
      />
      <KpiRow>
        <KpiTile label="Clients" value={num(clients.length)} />
        <KpiTile
          label="Active"
          value={num(clients.filter((c) => c.is_active).length)}
        />
        <KpiTile
          label="WHT agents"
          value={num(clients.filter((c) => c.is_withholding_agent).length)}
        />
        <KpiTile label="Total credit" value={money(totalCredit)} />
      </KpiRow>
      <DataList
        columns={columns}
        rows={rows}
        error={error}
        loading={loading}
        rowKey={(r) => r.client_id}
        onRowClick={(r) => setEditing(r)}
        empty={{
          title: "No clients yet",
          hint: "Add your first customer to start quoting and invoicing.",
        }}
      />
      {editing !== null && (
        <ClientForm
          row={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={reload}
        />
      )}
      <ScreenAi path="master/clients" />
    </section>
  );
}

/* ══════════════════════════════ Suppliers ═══════════════════════ */
