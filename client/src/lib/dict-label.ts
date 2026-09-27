/**
 * A financial-dictionary line's name, in the reader's language.
 *
 * Every picker used to read `label_en || label_fr` — English first, whatever
 * the person was working in. A French-speaking operator who named a line
 * "Code Additionnel AEC" then searched, picked it, and got a different English
 * string on the sheet (meeting 5, 01:01:49 — "it's not showing the exact name
 * we had the other side"). The catalogue carries both names; show the one the
 * reader reads, and fall back to the other rather than to nothing.
 */
import i18n from "@/lib/i18n";

export type DictLabelled = {
  label_en?: string | null;
  label_fr?: string | null;
  code?: string | null;
};

export function dictLabel(h: DictLabelled, lang: string = i18n.language || "en"): string {
  const fr = lang.startsWith("fr");
  const first = fr ? h.label_fr : h.label_en;
  const second = fr ? h.label_en : h.label_fr;
  return (first && first.trim()) || (second && second.trim()) || h.code || "";
}
