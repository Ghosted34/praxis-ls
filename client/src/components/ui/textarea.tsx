/**
 * Textarea — multi-line text input.
 *
 * No primitive existed (F6). The audit counted 18 raw `<textarea>` elements
 * styled by three local class constants; reading found MORE than three distinct
 * class strings actually in use — including two that had drifted to
 * `bg-transparent` and a `focus-visible:ring-2` treatment nothing else in the
 * app uses. Styling here matches `Input` exactly, because a form with a text
 * field above a text area should not look like two different form systems.
 *
 * `rows` defaults to 3 and the element stays user-resizable vertically —
 * `resize-none` is a common default and the wrong one here: several of these
 * fields hold a full delivery instruction or an OHADA narration, and taking
 * away the drag handle just means scrolling a 3-line window.
 *
 * @example
 * <Field label="Narration" hint="Appears on the journal entry." required>
 *   <Textarea value={form.narration} onChange={(e) => set("narration", e.target.value)} rows={4} />
 * </Field>
 *
 * BEST PRACTICE. Always inside a `<Field>` — that supplies the label
 * association and the required/invalid state (F4). Use a Textarea only when the
 * value genuinely runs to multiple lines; a single-line value in a text area
 * invites stray newlines that the backend then has to strip. When a maximum
 * length matters, say so in the field's `hint` rather than silently truncating.
 */
import * as React from "react";
import { cn } from "@/lib/cn";

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, rows = 3, ...props }, ref) => (
  <textarea
    ref={ref}
    rows={rows}
    className={cn(
      // Deliberately the same recipe as Input, minus the fixed height.
      "flex w-full rounded-[10px] border border-input bg-background px-3 py-2 text-[13px] text-foreground",
      "placeholder:text-muted-foreground",
      "transition-colors focus-visible:border-[color-mix(in_srgb,var(--primary)_50%,transparent)] focus-visible:outline-none",
      "disabled:cursor-not-allowed disabled:opacity-50",
      "resize-y",
      className,
    )}
    {...props}
  />
));
Textarea.displayName = "Textarea";
