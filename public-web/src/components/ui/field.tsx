import * as React from "react";
import { cn } from "@/lib/cn";

/**
 * Inputs, textareas, selects and their labels, built on the `.field` recipe in
 * `index.css`.
 *
 * Every control here takes an explicit `id` from the caller or falls back to a
 * generated one, because a placeholder is not a label: it disappears the moment
 * somebody types, it is read out by a screen reader as though it were the field's
 * name, and — the reason `client` insists on this too — a filled input with no
 * label has no accessible name at all.
 */

let seq = 0;
function useAutoId(provided?: string): string {
  const [id] = React.useState(() => provided || `f-${++seq}`);
  return provided || id;
}

export type FieldShellProps = {
  label?: React.ReactNode;
  hint?: React.ReactNode;
  error?: string | null;
  required?: boolean;
  className?: string;
  id?: string;
};

function Shell({
  id,
  label,
  hint,
  error,
  required,
  className,
  children,
}: FieldShellProps & { id: string; children: React.ReactNode }) {
  return (
    <div className={cn("min-w-0", className)}>
      {label && (
        <label className="field-label" htmlFor={id}>
          {label}
          {required && (
            <span className="ml-1 text-[var(--primary-ink)]" aria-hidden>
              *
            </span>
          )}
        </label>
      )}
      {children}
      {error ? (
        <p
          id={`${id}-error`}
          role="alert"
          className="mt-1.5 text-sm text-[rgb(var(--bad))]"
        >
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="mt-1.5 text-sm text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

const CONTROL = "field";
const INVALID = "aria-[invalid=true]:border-[rgb(var(--bad))]";

export function Input({
  label,
  hint,
  error,
  className,
  containerClassName,
  id: providedId,
  required,
  ...props
}: FieldShellProps &
  React.InputHTMLAttributes<HTMLInputElement> & {
    containerClassName?: string;
  }) {
  const id = useAutoId(providedId);
  return (
    <Shell
      id={id}
      label={label}
      hint={hint}
      error={error}
      required={required}
      className={containerClassName}
    >
      <input
        id={id}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={
          error ? `${id}-error` : hint ? `${id}-hint` : undefined
        }
        className={cn(CONTROL, INVALID, className)}
        {...props}
      />
    </Shell>
  );
}

export function Textarea({
  label,
  hint,
  error,
  className,
  containerClassName,
  id: providedId,
  required,
  rows = 4,
  ...props
}: FieldShellProps &
  React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
    containerClassName?: string;
  }) {
  const id = useAutoId(providedId);
  return (
    <Shell
      id={id}
      label={label}
      hint={hint}
      error={error}
      required={required}
      className={containerClassName}
    >
      <textarea
        id={id}
        rows={rows}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={
          error ? `${id}-error` : hint ? `${id}-hint` : undefined
        }
        className={cn(CONTROL, "resize-y", INVALID, className)}
        {...props}
      />
    </Shell>
  );
}

export type SelectOption = { value: string; label: string };

export function Select({
  label,
  hint,
  error,
  options,
  className,
  containerClassName,
  id: providedId,
  required,
  ...props
}: FieldShellProps &
  React.SelectHTMLAttributes<HTMLSelectElement> & {
    options: SelectOption[];
    containerClassName?: string;
  }) {
  const id = useAutoId(providedId);
  return (
    <Shell
      id={id}
      label={label}
      hint={hint}
      error={error}
      required={required}
      className={containerClassName}
    >
      <select
        id={id}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={
          error ? `${id}-error` : hint ? `${id}-hint` : undefined
        }
        className={cn(CONTROL, "appearance-none pr-10", INVALID, className)}
        {...props}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Shell>
  );
}

/**
 * The honeypot. Rendered, focused-able by nobody, and read by a bot as a field
 * worth filling — which is exactly how `public_intake.validator.js` rejects it
 * (`website_url: z.string().max(0)`).
 *
 * `tabIndex={-1}` + `aria-hidden` + autocomplete off, and NOT `display:none`: a
 * hidden input is a stronger signal to a filter than an offscreen one, and the
 * server's rule is "leave it empty", not "do not send it".
 */
export function Honeypot({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div
      className="absolute -left-[9999px] top-auto h-px w-px overflow-hidden"
      aria-hidden
    >
      <label htmlFor="website-url">Website</label>
      <input
        id="website-url"
        name="website_url"
        type="text"
        tabIndex={-1}
        autoComplete="off"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
