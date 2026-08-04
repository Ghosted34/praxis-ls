/**
 * Shared helpers for the Finance screens.
 *
 * Extracted in Phase 3 when `features/finance/pages.tsx` was split one screen
 * per file. That file was 2,581 lines holding 34 components behind 4 exports,
 * with `useOptions`, a local `errMessage`, a local `money` and a local `cell`
 * all private to it — the audit's worst single instance of F7, and the reason
 * the Finance area could not share anything with Operations or Sales except by
 * copy.
 *
 * The local `errMessage` and `money` are already gone: they were folded into
 * `lib/use-resource.errMsg` and `lib/format.amount` during Phase 2 (F6), and
 * the consolidation kept Finance's better 422-`details` unpacking rather than
 * flattening to the lowest common version.
 */
import * as React from "react";
import type { Option } from "@/lib/finance-api";

/**
 * Load a set of select options once, when `enabled` flips true — i.e. when a
 * form opens rather than when its screen mounts.
 *
 * Deliberately NOT a `useQuery`: these loaders are `lib/finance-api` functions
 * that map an API list into `{value,label,extra}` for a `<Select>`, and half of
 * them read the SAME endpoints the surrounding screen already has cached. The
 * shim is here so the forms keep working unchanged; a form migrating to
 * `<Form>` + a shared schema (Phase 4) should take its options from `useList`
 * and drop this.
 */
export function useOptions(loader: () => Promise<Option[]>, enabled: boolean) {
  const [opts, setOpts] = React.useState<Option[]>([]);
  const [err, setErr] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!enabled) return;
    let live = true;
    loader()
      .then((o) => live && setOpts(o))
      .catch(() => live && setErr("Couldn't load options."));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);
  return { opts, err };
}

/** "706100 — Sea freight income", when the option carries an account code. */
export function optionLabel(o: Option) {
  return o.extra ? `${o.extra} — ${o.label}` : o.label;
}

/**
 * A document line under edit.
 *
 * Shared by the final-invoice forms and the credit-note forms because they post
 * the same shape — amounts are held as STRINGS while typing so a half-entered
 * "1200." is not coerced to a number mid-keystroke.
 */
export type InvLine = { dictionary_item_id: string; amount: string; is_debours: boolean; label: string };

export const blankInvLine = (): InvLine => ({ dictionary_item_id: "", amount: "", is_debours: false, label: "" });
