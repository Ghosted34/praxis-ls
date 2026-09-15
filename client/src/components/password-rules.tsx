/**
 * The password policy, rendered as a live checklist.
 *
 * The rules themselves live in `@/lib/password-policy` — one statement, shared
 * with the predicate the submit buttons gate on, so a form cannot enable itself
 * on one rule set while ticking boxes against another. See that file for why
 * the client mirrors the server here at all, and for the two rules it does not.
 */
import { tr } from "@/lib/i18n";
import { CheckIcon } from "@/components/ui/icons";
import { passwordRules } from "@/lib/password-policy";

export function PasswordRules({ value }: { value: string }) {
  return (
    <ul className="mt-1.5 space-y-0.5">
      {passwordRules(value).map((r) => (
        <li
          key={r.label}
          className={`flex items-center gap-1.5 text-xs ${
            r.ok ? "text-primary-ink" : "text-muted-foreground"
          }`}
        >
          <span aria-hidden className="grid h-3.5 w-3.5 place-items-center">
            {r.ok ? <CheckIcon className="h-3 w-3" /> : "·"}
          </span>
          {tr(r.label)}
          {/* The state is carried by the icon, which a screen reader does not
              read out — so it is in words as well. A checklist that announces
              as five plain labels says nothing about which have been met. */}
          <span className="sr-only">
            {r.ok ? tr(" — met") : tr(" — not yet")}
          </span>
        </li>
      ))}
    </ul>
  );
}
