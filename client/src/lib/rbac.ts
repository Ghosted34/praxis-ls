import { tenant } from "./api-client";

export type Role = { role_id: string; code: string; name: string; is_system?: boolean };
export type Module = { module_key: string; group_key: string; name: string; sort_order: number };
export type Grant = {
  role_id: string;
  module_key: string;
  can_create: boolean;
  can_read: boolean;
  can_update: boolean;
  can_delete: boolean;
  can_approve: boolean;
};

export const PERMS = ["can_read", "can_create", "can_update", "can_delete", "can_approve"] as const;
export type PermKey = (typeof PERMS)[number];
export const PERM_LABEL: Record<PermKey, string> = {
  can_read: "R",
  can_create: "C",
  can_update: "U",
  can_delete: "D",
  can_approve: "A",
};
export const PERM_TITLE: Record<PermKey, string> = {
  can_read: "Read / view",
  can_create: "Create",
  can_update: "Update / edit",
  can_delete: "Delete",
  can_approve: "Approve",
};

export const emptyGrant = (role_id: string, module_key: string): Grant => ({
  role_id,
  module_key,
  can_create: false,
  can_read: false,
  can_update: false,
  can_delete: false,
  can_approve: false,
});

export const fetchRoles = () => tenant<Role[]>("/roles");
export const fetchModules = () => tenant<Module[]>("/catalogue/modules");
export const fetchPermissions = () => tenant<Grant[]>("/permissions");
export const upsertGrant = (g: Grant) => tenant<Grant>("/permissions/grant", { method: "PUT", body: g });
