import { tenant } from "./api-client";

export type Role = {
  role_id: string;
  code: string;
  name: string;
  is_system?: boolean;
};
export type Module = {
  module_key: string;
  group_key: string;
  name: string;
  sort_order: number;
};
export type Grant = {
  role_id: string;
  module_key: string;
  can_create: boolean;
  can_read: boolean;
  can_update: boolean;
  can_delete: boolean;
  can_approve: boolean;
  /** 12771 — export is a right over DATA; validate and disburse are the two
   *  decisions maker-checker most wants apart from "approve". */
  can_export: boolean;
  can_validate: boolean;
  can_disburse: boolean;
};

export const PERMS = [
  "can_read",
  "can_create",
  "can_update",
  "can_delete",
  "can_approve",
  // 12771. Order is deliberate: the CRUD four, then the three decisions, so a
  // cell reads left-to-right from "may touch it" to "may release money".
  "can_validate",
  "can_disburse",
  "can_export",
] as const;
export type PermKey = (typeof PERMS)[number];
export const PERM_LABEL: Record<PermKey, string> = {
  can_read: "R",
  can_create: "C",
  can_update: "U",
  can_delete: "D",
  can_approve: "A",
  can_validate: "V",
  can_disburse: "$",
  can_export: "X",
};
export const PERM_TITLE: Record<PermKey, string> = {
  can_read: "Read / view",
  can_create: "Create",
  can_update: "Update / edit",
  can_delete: "Delete",
  can_approve: "Approve",
  can_validate: "Validate — the finance visa, not a signature",
  can_disburse: "Disburse — hand over the cash",
  can_export: "Export — take this module's data out of the building",
};

export const emptyGrant = (role_id: string, module_key: string): Grant => ({
  role_id,
  module_key,
  can_create: false,
  can_read: false,
  can_update: false,
  can_delete: false,
  can_approve: false,
  can_export: false,
  can_validate: false,
  can_disburse: false,
});

export const fetchRoles = () => tenant<Role[]>("/roles");
export const fetchModules = () => tenant<Module[]>("/catalogue/modules");
/**
 * The COMPLETE grant set — not `/permissions`, which paginates at 50.
 *
 * The matrix edits by role×module and PUTs the whole row, so a grant it hasn't
 * loaded is a grant it will overwrite with all-false the moment you touch that
 * cell. With 11 roles × 72 modules the seeded grants alone exceed one page, so
 * loading through the paginated list made edits look like they weren't saving
 * while quietly destroying the grants below the cut.
 */
export const fetchPermissions = () => tenant<Grant[]>("/permissions/matrix");
export const upsertGrant = (g: Grant) =>
  tenant<Grant>("/permissions/grant", { method: "PUT", body: g });
