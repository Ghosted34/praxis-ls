/**
 * Row density — compact / default / comfortable (audit F9, F17).
 *
 * WHY THIS IS A PREFERENCE AND NOT A CONSTANT. F17 measured the table row at
 * ~46px against a 28-32px category standard, and Phase 1 took it to 32px. That
 * is the right default, but it is not the right answer for everyone: a
 * dispatcher scanning 200 open shipments on a 27" monitor wants 28px, and the
 * same table on a tablet in a warehouse wants 40px and a fat finger's worth of
 * hit area. Both users are correct, so the number belongs to them.
 *
 * HOW IT IS PLUMBED, and why not React context. The level is an attribute on
 * <html> (`data-density`), which sets one CSS variable (`--row-py`).
 * `tailwind.config.ts` maps the `row` spacing step to that variable, so every
 * existing `py-row` call site — `ui/table.tsx`'s TD, `ui/data-view.tsx`'s report
 * table — picks the preference up with no code change and no re-render. A React
 * context would have meant threading a value through every cell of a 200-row
 * table to change a padding value the browser can resolve on its own.
 *
 * The same attribute can be set on any subtree, which is what
 * `<Table density="compact">` does: a screen that KNOWS it is dense (a trial
 * balance, the permission matrix) can pin its own level without touching the
 * user's global preference. Nearest ancestor wins, which is ordinary CSS
 * cascade rather than a rule anyone has to remember.
 *
 * TOUCH IS NOT A THIRD PREFERENCE. There is deliberately no "auto" that sniffs
 * pointer type. `DataList` already swaps to cards below `sm:`, so the coarse-
 * pointer case is served by a different layout entirely rather than by a denser
 * table with bigger padding. Adding pointer detection here would make the
 * default unpredictable on the hybrid devices (Surface, iPad + trackpad) that
 * logistics operators actually carry.
 *
 * Call `initDensity()` once at boot, next to `initThemeMode()`.
 */
export type Density = "compact" | "default" | "comfortable";

const KEY = "praxis.density";
const LEVELS: Density[] = ["compact", "default", "comfortable"];

/** Vertical cell padding per level. Row height = 2 × pad + the 20px line box. */
export const DENSITY_PY: Record<Density, string> = {
  compact: "0.25rem", // 4px  → 28px rows
  default: "0.375rem", // 6px  → 32px rows
  comfortable: "0.625rem", // 10px → 40px rows
};

/**
 * The resulting row height in px — the CELL BOX, which is what the padding
 * controls. A rendered `<tr>` measures about 1px more, because it carries a
 * hairline bottom border; the browser gate allows for that explicitly rather
 * than fudging these numbers, so the figures here stay the ones the design is
 * stated in.
 *
 * The 20px term is the tallest thing a row is allowed to contain, and it is not
 * an observation — it is enforced. `--row-control-h` bounds a row-action button
 * to 20px and `.status` sets its own 16px line box. Before Phase 5 neither was
 * true: `<Button size="sm">` is 36px, so a real list row stood at 48px however
 * small the padding was, and the density work looked done for two phases while
 * the number it existed to change had not moved.
 */
export const DENSITY_ROW_PX: Record<Density, number> = {
  compact: 28,
  default: 32,
  comfortable: 40,
};

export const DENSITY_LABEL: Record<Density, string> = {
  compact: "Compact",
  default: "Default",
  comfortable: "Comfortable",
};

export const DENSITY_HINT: Record<Density, string> = {
  compact: "28px rows — most data per screen. For scanning long lists.",
  default: "32px rows — the balance most screens are designed against.",
  comfortable: "40px rows — larger hit targets, for touch and shared displays.",
};

export function isDensity(v: unknown): v is Density {
  return typeof v === "string" && (LEVELS as string[]).includes(v);
}

export function getDensity(): Density {
  try {
    const v = localStorage.getItem(KEY);
    return isDensity(v) ? v : "default";
  } catch {
    // Private-mode Safari throws on localStorage access rather than returning
    // null. A thrown preference read must not take the app down with it.
    return "default";
  }
}

function apply(d: Density) {
  document.documentElement.setAttribute("data-density", d);
}

export function setDensity(d: Density) {
  try {
    localStorage.setItem(KEY, d);
  } catch {
    /* preference is still applied for this session */
  }
  apply(d);
  // Anything measuring row geometry (the sticky-header offset, a virtualised
  // list) needs to know the row just changed height. A DOM event rather than a
  // subscriber list, because the listeners are in different trees.
  window.dispatchEvent(new CustomEvent<Density>("praxis:density", { detail: d }));
}

/** Apply the stored preference. Call once at boot, before first paint. */
export function initDensity() {
  apply(getDensity());
}
