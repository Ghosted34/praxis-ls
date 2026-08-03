/**
 * Workflow engine API — org approval chains (Universal Event Engine). A workflow
 * binds to an approvable event type and holds an ordered chain of VALIDATE/APPROVE
 * steps (by capability or role, optionally amount-banded). See doc/WORKFLOWS.md.
 */
import { tenant } from "./api-client";

export type EventType = {
  event_type_id?: string;
  key: string;
  name?: string | null;
  module_key?: string | null;
  is_approvable?: boolean | null;
  is_security_critical?: boolean | null;
};
export const listEventTypes = () => tenant<EventType[]>("/event-types");

export type Workflow = {
  workflow_id: string;
  name: string;
  event_type_key?: string | null;
  is_active?: boolean | null;
  step_count?: number | null;
  created_at?: string | null;
};
export const listWorkflows = () => tenant<Workflow[]>("/workflows");
export const getWorkflow = (id: string) => tenant<Workflow & { steps?: WorkflowStep[] }>(`/workflows/${id}`);
export const createWorkflow = (body: { event_type_key: string; name: string }) =>
  tenant<Workflow>("/workflows", { method: "POST", body });
export const updateWorkflow = (id: string, body: { name?: string; is_active?: boolean }) =>
  tenant<Workflow>(`/workflows/${id}`, { method: "PATCH", body });

export type WorkflowStep = {
  workflow_step_id: string;
  step_seq: number;
  step_kind: "VALIDATE" | "APPROVE";
  role_id?: string | null;
  capability_code?: "VALIDATOR" | "APPROVER" | null;
  scope_id?: string | null;
  min_amount_xaf?: number | null;
  max_amount_xaf?: number | null;
};
export const listSteps = (id: string) => tenant<WorkflowStep[]>(`/workflows/${id}/steps`);
export const addStep = (
  id: string,
  // `role_id` and `scope_id` are what the executor's eligibility check binds to —
  // a step with neither is open to anyone. The API and repo always accepted both;
  // the designer had no inputs for them, so every step built in the product was
  // unassigned and unnotified (audit finding W1).
  body: {
    step_seq: number;
    step_kind: "VALIDATE" | "APPROVE";
    capability_code?: "VALIDATOR" | "APPROVER";
    role_id?: string;
    scope_id?: string;
    min_amount_xaf?: number;
    max_amount_xaf?: number;
  },
) => tenant<WorkflowStep>(`/workflows/${id}/steps`, { method: "POST", body });
export const removeStep = (id: string, stepId: string) =>
  tenant<{ ok: boolean }>(`/workflows/${id}/steps/${stepId}`, { method: "DELETE" });
