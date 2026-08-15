/**
 * SMTP fix-guide components — render the "how to fix this" panel for an
 * outbound-mail failure wherever it surfaces. Registry + sniffing live in
 * lib/smtp-errors.ts (SMTP_GUIDES, smtpCodeFor) so the machine-code → steps
 * mapping is testable on its own.
 *
 * `<SmtpErrorGuide />`          — collapsible guide for ONE failure; render
 *                                 directly UNDER the error state.
 * `<MailTroubleshootingCard />` — always-visible condensed help for the two
 *                                 screens where admins configure mail, so the
 *                                 guidance is findable BEFORE the error hits.
 */
import * as React from "react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { SMTP_GUIDES, smtpCodeFor, smtpGuideFor } from "@/lib/smtp-errors";

/* Collapsible "How to fix this" panel — render directly UNDER the error state. */
export function SmtpErrorGuide({
  err,
  code,
  message,
  open = false,
  className,
}: {
  err?: unknown;
  code?: unknown;
  message?: unknown;
  open?: boolean;
  className?: string;
}) {
  const [isOpen, setIsOpen] = React.useState(open);
  const resolved = code
    ? String(code)
    : smtpCodeFor(err, message != null ? String(message) : undefined);
  const guide = smtpGuideFor(resolved);
  if (!guide) return null;
  return (
    <details
      open={isOpen}
      onToggle={(e) => setIsOpen((e.target as HTMLDetailsElement).open)}
      className={cn(
        "mt-2 rounded-lg border border-border bg-muted/40 text-[11px] leading-relaxed text-muted-foreground",
        className,
      )}
    >
      <summary className="flex cursor-pointer select-none items-center gap-2 px-2.5 py-2 font-medium text-foreground">
        <span aria-hidden>🛠</span> How to fix this — {guide.title}
        <span
          className={cn(
            "ml-auto text-muted-foreground transition-transform",
            isOpen && "rotate-180",
          )}
          aria-hidden
        >
          ▾
        </span>
      </summary>
      <div className="border-t border-border/60 px-3 py-2.5">
        <p className="mb-2">{guide.intro}</p>
        <ol className="list-decimal space-y-1 pl-4">
          {guide.steps.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
      </div>
    </details>
  );
}

/* Always-visible condensed help for the mail-config screens (Comms → Setup,
 * and in adapted form the platform console → Integrations). Rendered once per
 * screen, under the credentials card — BEFORE anyone hits the error. */
export function MailTroubleshootingCard({ className }: { className?: string }) {
  const [open, setOpen] = React.useState(false);
  const senderVerify = SMTP_GUIDES.SMTP_SENDER_REJECTED;
  return (
    <div
      className={cn(
        "rounded-2xl border border-border bg-card p-5 shadow-sm",
        className,
      )}
    >
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h3 className="font-display text-base">Email troubleshooting</h3>
          <p className="micro">
            The three checks that fix almost every send failure — expanded guide
            appears next to the error itself.
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
        >
          {open ? "Hide" : "Show"} guide
        </Button>
      </div>
      <ol className="list-decimal space-y-1 pl-4 text-[11px] leading-relaxed text-muted-foreground">
        <li>
          <strong className="text-foreground">
            From address must be a real mailbox
          </strong>{" "}
          on its domain — with valid <span className="num">MX</span>,{" "}
          <span className="num">SPF</span> and <span className="num">DKIM</span>{" "}
          records.
        </li>
        <li>
          <strong className="text-foreground">
            From must match the SMTP login
          </strong>{" "}
          — the address you send as is the account you authenticate as (or an
          alias of it).
        </li>
        <li>
          <strong className="text-foreground">Host, port, credentials</strong> —
          587 STARTTLS / 465 SSL; app password for 2FA accounts. Press{" "}
          <strong>Test</strong> after every change.
        </li>
      </ol>
      {open && (
        <div className="mt-3 rounded-lg border border-border bg-muted/40 p-2.5">
          <p className="mb-2 font-medium text-foreground">
            🛠 {senderVerify.title}
          </p>
          <ol className="list-decimal space-y-1 pl-4">
            {senderVerify.steps.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
