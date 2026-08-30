/**
 * usePrompt — `await prompt({…})` with a real form behind it.
 *
 * The companion to `useConfirm`, and the more important of the two. A
 * `window.confirm` at least asks a clear question; a `window.prompt` is an
 * unlabelled single-line text box drawn by the browser, and everything a form
 * control in this product is required to have, it lacks:
 *
 *   NO LABEL          The question is the dialog's body text, not a <label>, so
 *                     there is nothing for a screen reader to associate. This is
 *                     the exact failure the audit's F4 spent a whole component
 *                     (`Field`) fixing across 565 render sites.
 *   NO VALIDATION     `margin-simulations` needs at least 10 characters and
 *                     `onboarding` needs a real date. Both had to accept
 *                     whatever was typed, submit it, and report the refusal
 *                     afterwards — a round trip to say "no, not like that".
 *   NO TYPE           A date prompt is a text box in which the user is asked, in
 *                     prose, to type YYYY-MM-DD.
 *   NO HINT, NO ERROR There is nowhere to put either.
 *   NO i18n           `tr()` can translate the message; it cannot translate the
 *                     OK button.
 *
 * So this is not a styling wrapper around the same interaction — it is the
 * interaction the prompt was standing in for. The call shape stays awaitable so
 * the conversion at each site is local:
 *
 *     const [prompt, promptDialog] = usePrompt();
 *
 *     const why = await prompt({
 *       title: "Why is this being submitted below cost?",
 *       label: "Justification",
 *       hint: "The approver reads this.",
 *       multiline: true,
 *       validate: (v) => v.trim().length < 10 ? "At least 10 characters." : null,
 *     });
 *     if (why === null) return;          // cancelled
 *
 * RESOLVES `null` ON CANCEL, and the trimmed string otherwise — the same
 * contract `window.prompt` had, so the `if (!x) return` guards at call sites
 * keep working. `validate` runs on submit and on change once the field has been
 * touched; the confirm button stays disabled while the value is invalid, so the
 * dialog cannot accept a value it is about to refuse.
 *
 * FOCUS. No `autoFocus` — Radix's Dialog focuses the first tabbable control on
 * open already, and `jsx-a11y/no-autofocus` is an error in this config (Phase 4
 * deleted eleven redundant ones for the same reason).
 */
import * as React from "react";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/modal";
import { Input } from "@/components/ui/input";

export type PromptOptions = {
  /** The question, as a heading: "Why is this being submitted below cost?" */
  title: string;
  /** Context above the field. Optional — the label often says enough. */
  description?: string;
  /** The field's label. Required: a prompt with no label is what this replaces. */
  label: string;
  /** Helper text under the field. */
  hint?: string;
  /** Starting value, like `window.prompt`'s second argument. */
  defaultValue?: string;
  placeholder?: string;
  /** `date` renders a date picker rather than asking for YYYY-MM-DD in prose. */
  type?: "text" | "date" | "email" | "url" | "number";
  /** A textarea instead of an input, for anything longer than a few words. */
  multiline?: boolean;
  /** Return an error string to block submission, or null when the value is fine. */
  validate?: (value: string) => string | null;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Trim the resolved value. Default true. */
  trim?: boolean;
};

type State = (PromptOptions & { open: boolean }) | null;

export function usePrompt(): [
  (options: PromptOptions) => Promise<string | null>,
  React.ReactNode,
] {
  const [state, setState] = React.useState<State>(null);
  const [value, setValue] = React.useState("");
  const [touched, setTouched] = React.useState(false);
  const resolver = React.useRef<((v: string | null) => void) | null>(null);

  React.useEffect(
    () => () => {
      resolver.current?.(null);
      resolver.current = null;
    },
    [],
  );

  const prompt = React.useCallback((options: PromptOptions) => {
    resolver.current?.(null);
    setValue(options.defaultValue ?? "");
    setTouched(false);
    setState({ ...options, open: true });
    return new Promise<string | null>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const settle = React.useCallback((v: string | null) => {
    resolver.current?.(v);
    resolver.current = null;
    setState((s) => (s ? { ...s, open: false } : null));
  }, []);

  const error = state?.validate ? state.validate(value) : null;

  const submit = () => {
    if (!state) return;
    setTouched(true);
    if (error) return;
    settle((state.trim ?? true) ? value.trim() : value);
  };

  const dialog = state ? (
    <Dialog
      open={state.open}
      onClose={() => settle(null)}
      title={state.title}
      description={state.description}
      footer={
        <>
          <button
            type="button"
            onClick={() => settle(null)}
            className="btn btn-outline h-9 rounded-md px-3 text-sm"
          >
            {state.cancelLabel ?? "Cancel"}
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!!error}
            className="h-9 rounded-md bg-primary px-3 text-sm font-semibold text-white transition-opacity disabled:opacity-50"
          >
            {state.confirmLabel ?? "Save"}
          </button>
        </>
      }
    >
      {/* A real <form>, so Enter submits — the one ergonomic property the
          native prompt had, and the one most easily lost in a modal. */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Field
          label={state.label}
          hint={state.hint}
          error={touched && error ? error : undefined}
          required
        >
          {state.multiline ? (
            <textarea
              rows={4}
              value={value}
              placeholder={state.placeholder}
              onChange={(e) => setValue(e.target.value)}
              onBlur={() => setTouched(true)}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          ) : (
            <Input
              type={state.type ?? "text"}
              value={value}
              placeholder={state.placeholder}
              onChange={(e) => setValue(e.target.value)}
              onBlur={() => setTouched(true)}
            />
          )}
        </Field>
        {/* Enter-to-submit needs a submit control inside the form; the visible
            one lives in the dialog footer, so this is its hidden twin. */}
        <button type="submit" className="sr-only" tabIndex={-1} aria-hidden>
          {state.confirmLabel ?? "Save"}
        </button>
      </form>
    </Dialog>
  ) : null;

  return [prompt, dialog];
}
