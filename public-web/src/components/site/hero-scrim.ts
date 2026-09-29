/**
 * The hero's two-layer scrim — the stop lists, the floor they are held to, and
 * the one recipe that paints them.
 *
 * ── WHY THIS IS ITS OWN MODULE ─────────────────────────────────────────────
 *
 * Two bands wear these numbers now: the marketing hero (`hero.tsx`) and the
 * portal's sign-in (`features/portal/auth/sign-in.tsx`), which lays the same
 * photograph under the same copy and has to keep the same contrast. Importing
 * them from `hero.tsx` would have pulled the whole marketing hero — the track
 * widget, the figures rail, the count-ups — into the portal's chunk to read
 * seven numbers. So the numbers moved here, `hero.tsx` re-exports them for the
 * test that holds the floors, and neither band carries a copy that can drift.
 */
/**
 * THE SCRIM FLOORS, AS NUMBERS A TEST CAN READ.
 *
 * These were a comment. Guide §7.1 requires any new treatment of this band to
 * "re-derive them or keep them", and a comment cannot enforce that — the next
 * person to make the photograph more visible will nudge a percentage in a
 * gradient string and no gate will notice, because nothing in the tree knows
 * these numbers mean anything.
 *
 * So they are constants, `hero.test.tsx` asserts every stop where copy sits is
 * at or above the binding floor, and changing one now means changing a test
 * that says what it protects.
 *
 * The derivation, unchanged. Measured against the worst case a tenant can
 * upload — a blown-out, near-white photograph — the minimum scrim opacity for
 * each piece of hero copy is:
 *
 *   headline  #edeeee  large   3.0:1 needed   α ≥ 0.48
 *   sub-line  #9ea1a4  normal  4.5:1 needed   α ≥ 0.82
 *   eyebrow   #ff5a00  small   4.5:1 needed   α ≥ 0.87   ← binds
 */
export const SCRIM_FLOOR = 0.87;

/**
 * The two scrims, as stop lists rather than as strings.
 *
 * `over` marks the stops that sit under copy. Those are held to `SCRIM_FLOOR`;
 * the rest are where the photograph is allowed to come through, which is the
 * whole reason this is two layers and not one flat wash. The layout changes
 * shape at `lg` — copy is a left column with the track card on the right, so
 * the scrim can fall away horizontally; below `lg` the two stack and copy spans
 * the full width, so it can only fall away downward, under the card.
 */
export const SCRIM_STACKED = {
  shape: "linear-gradient(180deg",
  stops: [
    { at: "0%", alpha: 0.94, over: true },
    { at: "58%", alpha: 0.9, over: true },
    { at: "100%", alpha: 0.55, over: false },
  ],
} as const;

export const SCRIM_SPLIT = {
  shape: "radial-gradient(118% 130% at 20% 50%",
  stops: [
    { at: "0%", alpha: 0.95, over: true },
    { at: "44%", alpha: 0.92, over: true },
    { at: "74%", alpha: 0.46, over: false },
    { at: "100%", alpha: 0.2, over: false },
  ],
} as const;

/** Both scrims are the same colour at different strengths, so the recipe is
 *  written once. `--hero` is the band's own ground token, never a literal. */
const scrimCss = (scrim: { shape: string; stops: ReadonlyArray<{ at: string; alpha: number }> }) =>
  `${scrim.shape}, ${scrim.stops
    .map((s) => `color-mix(in srgb, var(--hero) ${Math.round(s.alpha * 100)}%, transparent) ${s.at}`)
    .join(", ")})`;

/** Exported for both bands, and for the test that holds the floors. */
export const HERO_SCRIMS = { stacked: SCRIM_STACKED, split: SCRIM_SPLIT, css: scrimCss };

/**
 * THE SIGN-IN'S SCRIMS BELOW `lg` — the same floor, laid where ITS copy is.
 *
 * The hero's stacked scrim holds the floor over the top 58 % of the band,
 * because on a phone the hero's copy fills it. The portal's sign-in has a third
 * as much copy above a plate that carries its own ground, so that scrim turned
 * the whole top half of a phone black: the photograph a tenant uploaded showed
 * nowhere but through the glass.
 *
 * So below `lg` the sign-in splits it in two, and neither half is a guess
 * about where the copy ends:
 *
 *   · the VEIL travels WITH the copy — it is laid in the copy's own grid cell
 *     and runs from above the header to the copy's last line at the floor,
 *     then fades out over the 90px beneath it. However the headline wraps,
 *     in whichever language, on whichever phone, the floor is under it.
 *   · the WASH covers the band. Nothing is read on it except through the
 *     plate, so it is held to the plate's floor instead: never lighter than
 *     the hero's own scrim at the foot of its band (0.55), which is the
 *     lightest ground the hero's plate was ever floated over.
 *
 * At `lg` the sign-in wears the hero's split scrim unchanged.
 */
export const SCRIM_DOOR_VEIL = {
  shape: "linear-gradient(180deg",
  stops: [
    { at: "0%", alpha: 0.94, over: true },
    { at: "calc(100% - 90px)", alpha: 0.9, over: true },
    { at: "100%", alpha: 0, over: false },
  ],
} as const;

export const SCRIM_DOOR_WASH = {
  shape: "linear-gradient(180deg",
  stops: [
    { at: "0%", alpha: 0.55, over: false },
    { at: "100%", alpha: 0.64, over: false },
  ],
} as const;

/** The plate's floor: the lightest scrim the hero ever floats its plate over. */
export const PLATE_GROUND_FLOOR = 0.55;
