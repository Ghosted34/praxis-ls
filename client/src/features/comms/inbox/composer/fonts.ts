/**
 * The font families the composer offers, and the ONLY ones it may.
 *
 * Web-safe stacks, keyed by the value stored on the TipTap `textStyle` mark and
 * matching `FONT_STACKS` in `src/modules/mail/mail/compose.js`. The two lists
 * move together: a family here without a stack there renders as Times New Roman
 * at the recipient and nobody can explain why — the @font-face lesson from
 * notification.service.js.
 *
 * In its own file rather than beside the editor component, because a constants
 * export in a component module breaks fast refresh for that whole module.
 */
export const FONTS = [
  { value: "arial", label: "Arial" },
  { value: "helvetica", label: "Helvetica" },
  { value: "georgia", label: "Georgia" },
  { value: "times", label: "Times New Roman" },
  { value: "verdana", label: "Verdana" },
  { value: "tahoma", label: "Tahoma" },
  { value: "trebuchet", label: "Trebuchet MS" },
  { value: "courier", label: "Courier New" },
] as const;
