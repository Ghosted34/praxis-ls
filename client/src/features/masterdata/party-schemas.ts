/**
 * The client's binding to the shared master-data contracts.
 *
 * The client and the API validate a client/supplier/contact/… payload against
 * the SAME Zod schema (packages/shared), never two copies that drift — that is
 * what the "shared schemas are actually shared" gate enforces. The 360° command
 * centres, the create/edit forms, the settings page and the Smart Country Picker
 * (PR 2) import their validation and reference data from here rather than
 * reaching into `@shared` ad hoc, so there is one place the client's binding to
 * the contract lives.
 *
 * `clientMaster` is already consumed directly by `clients.tsx`; this adds the
 * supplier master, the nested-resource schemas, the per-tenant field policy and
 * the country reference the rest of the module builds on.
 */
import { supplierMaster, partyCommon, partyConfig, countries } from "@shared";
import type { z } from "zod";

/** Supplier create/edit form schemas — the API validates with these exact ones. */
export const supplierForm = { create: supplierMaster.create, update: supplierMaster.update };

/** Nested-resource schemas (contact, address, bank, document, registration, owner). */
export const nestedForms = partyCommon;

/** Per-tenant field-requirement policy (which fields are required/visible). */
export const fieldPolicy = partyConfig;

/** Canonical ISO country reference for the Smart Country Picker + registration forms. */
export const countryRef = countries;

export type SupplierInput = z.input<typeof supplierMaster.create>;
export type ContactInput = z.input<typeof partyCommon.contactCreate>;
export type AddressInput = z.input<typeof partyCommon.addressCreate>;
export type BankInput = z.input<typeof partyCommon.bankCreate>;
export type DocumentInput = z.input<typeof partyCommon.documentCreate>;
export type FieldConfig = ReturnType<typeof partyConfig.defaultsFor>[number];
export type Country = (typeof countries.CATALOGUE)[number];
