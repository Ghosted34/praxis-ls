/**
 * The rules behind a SELECT field's option list. Pure, so they can be tested
 * directly and read by both the editor dialog and the add-field form.
 *
 * SPLIT OUT FOR THE SAME REASON `place-meta.ts` IS: a module that exports both
 * components and helpers cannot hot-reload, and the decisions here — what a valid
 * option list is, what gets sent to the server — are worth testing without
 * rendering anything.
 *
 * A `value` is what gets STORED on every file, cited by every document and grouped
 * by in every report. `label_fr`/`label_en` are what a person reads. They are
 * separate because a label is translated and rewritten and a stored code must not
 * be.
 */
import type { FieldOption } from "@/lib/operations-api";

/**
 * A draft row.
 *
 * `_key` is a render identity that survives reordering and editing a value — keying
 * on the value itself makes React tear down the input the operator is typing in the
 * moment they change its first character.
 *
 * `_original` is the value this row had when the dialog opened, and `undefined` for
 * a row added since. It is the only way to tell "renamed a stored code" (which
 * orphans data) from "typed a new one" (which does not).
 */
export type DraftOption = FieldOption & { _key: string; _original?: string };

let seq = 0;
export const nextKey = () => `opt-${(seq += 1)}`;

export const toDraft = (options: FieldOption[]): DraftOption[] =>
  (options || []).map((o) => ({
    value: o.value ?? "",
    label_fr: o.label_fr ?? "",
    label_en: o.label_en ?? "",
    _key: nextKey(),
    _original: o.value ?? "",
  }));

/**
 * What the server will accept, decided here so the operator is told before they
 * press Save rather than by a 422 afterwards.
 *
 * Mirrors the OPTION schema (`value` and `label_fr` non-empty) plus one rule the
 * schema cannot express: values must be UNIQUE. Two options sharing a value is a
 * dropdown with two identical stored answers, which nothing downstream can tell
 * apart — and it is the mistake a duplicated row makes by default.
 */
export function optionProblems(rows: FieldOption[]): string[] {
  const problems: string[] = [];
  if (!rows.length) {
    problems.push("A dropdown needs at least one option — an empty one cannot be answered.");
  }
  if (rows.some((r) => !String(r.value || "").trim())) {
    problems.push("Every option needs a stored value.");
  }
  if (rows.some((r) => !String(r.label_fr || "").trim() && !String(r.label_en || "").trim())) {
    problems.push("Every option needs a label in at least one language.");
  }
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  rows.forEach((r) => {
    const v = String(r.value || "").trim().toUpperCase();
    if (!v) return;
    if (seen.has(v)) duplicates.add(v);
    seen.add(v);
  });
  if (duplicates.size) {
    problems.push(`Two options cannot share a value — ${[...duplicates].join(", ")} appears twice.`);
  }
  return problems;
}

/** Strip the render key and normalise, so what is sent is what the schema wants:
 *  a trimmed code, and `label_fr` filled from `label_en` when only one was given. */
export function toWireOptions(rows: DraftOption[]): FieldOption[] {
  return rows.map((r) => {
    const fr = String(r.label_fr || "").trim();
    const en = String(r.label_en || "").trim();
    return {
      value: String(r.value || "").trim(),
      label_fr: fr || en,
      ...(en ? { label_en: en } : {}),
    };
  });
}
