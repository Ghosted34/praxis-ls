/**
 * Support & Feedback — the tenant→Praxis channel (PRD §11.2).
 *
 * One module for the API + the ticket vocabulary, because the raise modal,
 * the ticket list, the thread and the rail shortcut all speak the same kinds
 * and hit the same endpoints. The kind list here, the Zod enum in
 * src/modules/dashboard/support/support.validator.js and the CHECK in
 * platform migration 0105 are the three copies that must agree — keep them
 * together in review.
 *
 * ATTACHMENT BYTES ARE NEVER A PLAIN `src`. The read is scoped to this
 * tenant's ticket (or the caller's own in-flight upload), so it carries the
 * Bearer token: the same rule smartcomm applies to its chat media, fetched
 * to an object URL that the caller revokes.
 */
import { tenant, uploadFile, tenantObjectUrl } from "@/lib/api-client";

export type TicketKind =
  | "SUPPORT"
  | "BUG"
  | "FEATURE"
  | "BILLING"
  | "SECURITY"
  | "DATA"
  | "COMMS"
  | "URGENT"
  | "REQUEST";

export type TicketStatus = "NEW" | "TRIAGED" | "IN_PROGRESS" | "SHIPPED" | "DECLINED";

export type TicketAttachment = {
  attachment_id: string;
  file_name: string;
  mime_type: string;
  byte_size: number;
  created_at: string;
};

export type TicketReply = {
  reply_id: string;
  author_side: "TENANT" | "PRAXIS";
  author_label?: string | null;
  body: string;
  is_internal: boolean;
  created_at: string;
  attachments: TicketAttachment[];
};

export type Ticket = {
  ticket_id: string;
  kind: TicketKind;
  title: string;
  body?: string | null;
  status: TicketStatus;
  csat?: number | null;
  created_at?: string | null;
  updated_at?: string | null;
  /** List rows only: the last public reply, for "most recently active". */
  last_reply_at?: string | null;
  /** Detail fetches: the ticket's own images, then the thread. */
  attachments?: TicketAttachment[];
  replies?: TicketReply[];
};

/** Dropdown order is triage order: the everyday kinds first, the rare ones last. */
export const KIND_OPTIONS: { value: TicketKind; label: string }[] = [
  { value: "SUPPORT", label: "Support — I need help" },
  { value: "BUG", label: "Bug — something's broken" },
  { value: "FEATURE", label: "Feature — I'd like an improvement" },
  { value: "URGENT", label: "Urgent — this is blocking us now" },
  { value: "BILLING", label: "Billing & account" },
  { value: "SECURITY", label: "Security & access" },
  { value: "DATA", label: "Data & import" },
  { value: "COMMS", label: "Communication & notifications" },
  { value: "REQUEST", label: "Something else" },
];

export const KIND_LABEL: Record<TicketKind, string> = {
  SUPPORT: "Support",
  BUG: "Bug",
  FEATURE: "Feature",
  URGENT: "Urgent",
  BILLING: "Billing",
  SECURITY: "Security",
  DATA: "Data",
  COMMS: "Comms",
  REQUEST: "Request",
};

export const KIND_TONE: Record<TicketKind, "ok" | "warn" | "bad" | "blue" | "orange" | "mute"> = {
  SUPPORT: "blue",
  BUG: "bad",
  FEATURE: "orange",
  URGENT: "bad",
  BILLING: "warn",
  SECURITY: "warn",
  DATA: "blue",
  COMMS: "blue",
  REQUEST: "mute",
};

export const STATUS_LABEL: Record<TicketStatus, string> = {
  NEW: "New",
  TRIAGED: "Triaged",
  IN_PROGRESS: "In progress",
  SHIPPED: "Shipped",
  DECLINED: "Declined",
};

export const STATUS_TONE: Record<TicketStatus, "ok" | "warn" | "bad" | "blue" | "orange" | "mute"> = {
  NEW: "warn",
  TRIAGED: "blue",
  IN_PROGRESS: "blue",
  SHIPPED: "ok",
  DECLINED: "bad",
};

export const isResolved = (s: TicketStatus) => s === "SHIPPED" || s === "DECLINED";

export type TicketContext = Record<string, unknown>;

export const listTickets = (status?: string) =>
  tenant<Ticket[]>(`/support/tickets${status ? `?status=${status}` : ""}`);

export const getTicket = (id: string) =>
  tenant<Ticket>(`/support/tickets/${encodeURIComponent(id)}`);

export const createTicket = (body: {
  kind: TicketKind;
  title: string;
  body?: string;
  context?: TicketContext;
  attachmentIds?: string[];
}) =>
  tenant<Ticket>("/support/tickets", {
    method: "POST",
    body: {
      kind: body.kind,
      title: body.title,
      body: body.body,
      context: body.context,
      attachment_ids: body.attachmentIds && body.attachmentIds.length ? body.attachmentIds : undefined,
    },
  });

export const postReply = (id: string, body: { body: string; attachmentIds?: string[] }) =>
  tenant<TicketReply>(`/support/tickets/${encodeURIComponent(id)}/replies`, {
    method: "POST",
    body: {
      body: body.body,
      attachment_ids: body.attachmentIds && body.attachmentIds.length ? body.attachmentIds : undefined,
    },
  });

export const postCsat = (id: string, csat: number) =>
  tenant<Ticket>(`/support/tickets/${encodeURIComponent(id)}/csat`, {
    method: "POST",
    body: { csat },
  });

/**
 * One screenshot, up on its own request — the id goes onto the ticket or
 * reply that follows. `profile: "document"` is deliberate: a bug screenshot
 * must keep matching the screen, never a tonally-corrected version of it.
 */
export const uploadTicketImage = (
  file: File,
  ctx: { onProgress: (percent: number) => void; signal: AbortSignal },
) =>
  uploadFile<TicketAttachment>("/tenant/support/attachments", file, {
    field: "file",
    onProgress: ctx.onProgress,
    signal: ctx.signal,
  });

/** Bytes of one attachment, as an object URL for an <img> (caller revokes). */
export const ticketAttachmentUrl = (attachmentId: string, signal?: AbortSignal) =>
  tenantObjectUrl(`/support/attachments/${encodeURIComponent(attachmentId)}`, signal);
