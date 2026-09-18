/**
 * WHERE "CREATE A NEW ONE" LANDS (§7.7).
 *
 * The convert dialog previews and dedups; the record itself is created by the
 * TARGET module, under its own rights, from a form the operator reviews. These
 * six pages are that form: each one renders the owning module's EXISTING create
 * surface — not a mail-owned copy — seeded from the query string the dialog
 * built (`from_mail=1&mail_thread=<id>` plus the prefill), and each one posts
 * back to `recordConverted` after saving, which is what tells the thread what
 * it became.
 *
 * That round trip is the part that never worked. The preview named routes that
 * matched nothing — `/sales/leads/new` landed in the lead dossier with
 * `leadId="new"`, and the other five fell through to the catch-all and home —
 * and nothing ever read `from_mail` or called `recordConverted`, so even a
 * record created by hand stayed unlinked from its email. The routes below are
 * declared in `app.tsx` beside the screens they belong to.
 *
 * Opened directly (no query string) a page is simply a deep-linkable create
 * form for its module — a coherent thing to bookmark, not an error.
 *
 * The `initial` objects are memoised on the query values, not rebuilt inline:
 * the forms re-seed whenever `initial` changes identity, and an inline literal
 * would be a new identity on every parent render — wiping what the operator
 * typed each time anything above re-rendered (the shell polls around them).
 */

import * as React from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { tr } from "@/lib/i18n";
import { recordConverted } from "@/lib/mail-api-work";
import { reportActionError } from "@/lib/action-error";
import { LeadForm } from "@/features/sales/lead-forms";
import { QuoteRequestForm } from "@/features/sales/quote-request-forms";
import { EnquiryCreateForm } from "@/features/sales/enquiry-forms";
import { NewTicketModal } from "@/features/support/new-ticket-modal";
import { TaskDialog } from "@/features/workspace/tasks/task-dialog";
import { PrForm } from "@/features/procurement/purchase-requests";

function useMailSeed() {
  const [params] = useSearchParams();
  const get = (k: string) => {
    const v = params.get(k);
    return v === null || v === "" ? null : v;
  };
  // Plain strings, read fresh per render: cheap, and stable as values for as
  // long as the location does not change — which is what the memos below key on.
  return {
    fromMail: params.get("from_mail") === "1",
    threadId: get("mail_thread"),
    email: get("email"),
    contactName: get("contact_name"),
    companyName: get("company_name"),
    subject: get("subject"),
    details: get("details"),
  };
}

/**
 * Saving closes the loop §7.7 requires: the created entity gets told what it
 * came from (mail records `converted_entity_ref` on the thread), and the
 * operator returns to the owning module's list. The back-reference post is
 * awaited — navigating first would unmount into a cancelled request — but a
 * failure there must not strand the operator: the record EXISTS, so the error
 * is reported and the navigation still happens.
 */
function useConvertSave(target: string, threadId: string | null, backTo: string) {
  const navigate = useNavigate();
  const close = React.useCallback(() => navigate(backTo), [navigate, backTo]);
  const saved = React.useCallback(
    async (id?: string | null) => {
      if (threadId && id) {
        try {
          await recordConverted(threadId, `${target}:${id}`);
        } catch (err) {
          reportActionError(err);
        }
      }
      navigate(backTo);
    },
    [navigate, backTo, threadId, target],
  );
  return { close, saved };
}

function NewShell({
  title,
  fromMail,
  children,
}: {
  title: string;
  fromMail: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-2xl space-y-2 px-4 py-8">
      <h1 className="font-display text-xl font-medium">{title}</h1>
      <p className="text-sm text-muted-foreground">
        {fromMail
          ? tr("Creating from an email — the details are filled in, and saving links the new record back to the thread.")
          : tr("Nothing is created until you save.")}
      </p>
      {children}
    </div>
  );
}

export function LeadNewPage() {
  const seed = useMailSeed();
  const { close, saved } = useConvertSave("lead", seed.threadId, "/sales/leads");
  const initial = React.useMemo(
    () => ({
      company_name: seed.companyName,
      contact_name: seed.contactName,
      email: seed.email,
      service_interest: seed.subject,
    }),
    [seed.companyName, seed.contactName, seed.email, seed.subject],
  );
  return (
    <NewShell title={tr("New lead")} fromMail={seed.fromMail}>
      <LeadForm open editing={null} initial={initial} onClose={close} onSaved={saved} />
    </NewShell>
  );
}

export function QuoteRequestNewPage() {
  const seed = useMailSeed();
  const { close, saved } = useConvertSave("quote_request", seed.threadId, "/sales/quote-requests");
  const initial = React.useMemo(
    () => ({
      requester_name: seed.contactName,
      requester_company: seed.companyName,
      requester_email: seed.email,
      cargo_description: seed.details,
    }),
    [seed.contactName, seed.companyName, seed.email, seed.details],
  );
  return (
    <NewShell title={tr("New quote request")} fromMail={seed.fromMail}>
      <QuoteRequestForm open editing={null} initial={initial} onClose={close} onSaved={saved} />
    </NewShell>
  );
}

export function EnquiryNewPage() {
  const seed = useMailSeed();
  const { close, saved } = useConvertSave("enquiry", seed.threadId, "/sales/enquiries");
  const initial = React.useMemo(
    () => ({
      name: seed.contactName,
      email: seed.email,
      company_name: seed.companyName,
      subject: seed.subject,
      message: seed.details,
    }),
    [seed.contactName, seed.email, seed.companyName, seed.subject, seed.details],
  );
  return (
    <NewShell title={tr("New enquiry")} fromMail={seed.fromMail}>
      <EnquiryCreateForm open initial={initial} onClose={close} onSaved={saved} />
    </NewShell>
  );
}

export function TicketNewPage() {
  const seed = useMailSeed();
  const { close, saved } = useConvertSave("ticket", seed.threadId, "/support");
  const initial = React.useMemo(
    () => ({ title: seed.subject, body: seed.details }),
    [seed.subject, seed.details],
  );
  return (
    <NewShell title={tr("New support ticket")} fromMail={seed.fromMail}>
      <NewTicketModal initial={initial} onClose={close} onCreated={saved} />
    </NewShell>
  );
}

export function TaskNewPage() {
  const seed = useMailSeed();
  const { close, saved } = useConvertSave("task", seed.threadId, "/workspace/tasks");
  const initial = React.useMemo(
    () => ({ title: seed.subject, description: seed.details }),
    [seed.subject, seed.details],
  );
  return (
    <NewShell title={tr("New task")} fromMail={seed.fromMail}>
      <TaskDialog open initial={initial} onClose={close} onSaved={saved} />
    </NewShell>
  );
}

export function PurchaseRequisitionNewPage() {
  const seed = useMailSeed();
  const { close, saved } = useConvertSave(
    "purchase_requisition",
    seed.threadId,
    "/procurement/purchase-requests",
  );
  const initial = React.useMemo(
    () => ({ justification: seed.subject }),
    [seed.subject],
  );
  return (
    <NewShell title={tr("New purchase request")} fromMail={seed.fromMail}>
      <PrForm initial={initial} onClose={close} onSaved={saved} />
    </NewShell>
  );
}
