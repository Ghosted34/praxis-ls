import {
  BoxIcon,
  ClockIcon,
  DocumentIcon,
  GlobeIcon,
  PlaneIcon,
  ShieldIcon,
  ShipIcon,
  TruckIcon,
  WarehouseIcon,
} from "@/components/ui/icons";
import type { IconComponent } from "@/components/ui/icon-tile";

/**
 * One identity per service card: a glyph, a freight-mode colour, and a code.
 *
 * ── WHY THIS IS ONE TABLE AND NOT THREE DECISIONS ─────────────────────────
 *
 * The services grid needs a glyph (§7.3), a `--mode-*` colour (P1-1) and a mono
 * service code (P1-2), and all three have to agree — a card whose panel is green
 * and whose tile is blue is not one card, it is two half-designed ones. Keeping
 * them in one row of one table is what makes "recognisable by colour before it
 * is read" true on the home page, the services index and the service page at the
 * same time.
 *
 * ── KEYED ON POSITION, NEVER ON WHAT THE CARD SAYS ────────────────────────
 *
 * This is the rule the glyph cycle already followed, and it matters more now
 * that colour is involved. Matching an identity to a tenant-authored name — "a
 * ship for the sea-freight profile" — means this file guessing at the meaning of
 * strings it did not write, in two languages, and being wrong on the first
 * tenant who writes "Maritime & Air" or "Groupage". Position is a fact; the
 * service's mode is not ours to infer.
 *
 * The mode colours are therefore an IDENTITY PALETTE, not a taxonomy: card three
 * is `--mode-road` because it is third, and no claim is made that it moves by
 * road. That is also how the work order assigns them (customs clearance drawn in
 * `--mode-air`), so the colours read as four distinct lines rather than as a
 * legend a reader is expected to decode.
 *
 * ── AND THEREFORE ORANGE IS STILL THE ONLY THING THAT LOOKS CLICKABLE ─────
 *
 * Mode colours are used for the card's top bar, its icon tile and its panel —
 * all identity. They are never used for a button, a link or the "See this
 * service" arrow, which stay `--primary-ink`. A grid where four different
 * colours are clickable teaches a visitor nothing about which colour means "you
 * may press this".
 */
export type FreightMode = "sea" | "air" | "road" | "rail";

export type ServiceIdentity = {
  icon: IconComponent;
  mode: FreightMode;
  /**
   * The code drawn on the card's panel, in the mono face.
   *
   * It is a POSITION code, not a lookup of the tenant's own service codes —
   * which exist in the ERP and are none of this app's business. It says "this
   * is a service line, and it is that one", which is what the panel needs and
   * all it can honestly claim.
   */
  code: string;
};

const IDENTITIES: readonly ServiceIdentity[] = [
  { icon: ShipIcon, mode: "sea", code: "SVC-SEA" },
  { icon: DocumentIcon, mode: "air", code: "SVC-CUS" },
  { icon: WarehouseIcon, mode: "road", code: "SVC-WHS" },
  { icon: TruckIcon, mode: "rail", code: "SVC-HTL" },
] as const;

/** How many distinct identities exist before the cycle repeats. The home page
 *  shows exactly this many cards so that no two of them share a colour. */
export const IDENTITY_COUNT = IDENTITIES.length;

/**
 * The identity for the card at `index`.
 *
 * Cycles, so a tenant with eleven published services still gets a card for each
 * one on the services index. Repetition past four is the honest cost of a
 * four-colour palette; a fifth colour that is not in the brand's transport set
 * would be worse, and a colourless fifth card reads as the broken one.
 *
 * A negative index (a `findIndex` miss handed straight through) would otherwise
 * pick from the end of the array, so it is folded rather than trusted.
 */
export function serviceIdentity(index: number): ServiceIdentity {
  const n = IDENTITIES.length;
  return IDENTITIES[((Math.trunc(index) % n) + n) % n];
}

/** The CSS colour for a mode, as a token reference rather than a value. Every
 *  call site paints with this, so a tenant re-brand that redefines `--mode-sea`
 *  repaints the bar, the tile and the panel together. */
export const modeColor = (mode: FreightMode): string => `rgb(var(--mode-${mode}))`;

/**
 * The tenant's own choice, which outranks the positional palette above.
 *
 * `service_type_web_profile.accent` (migration 12755) stores a brand TOKEN NAME
 * — PRIMARY | ACCENT | SUCCESS, never a hex, because the palette is tenant
 * config and a stored `#EE7D04` would hardcode one tenant's brand into another
 * tenant's data. When a service carries one, it wins: `serviceIdentity` guesses
 * from position because it has nothing better, and a guess must never override
 * an answer.
 *
 * The migration describes the mapping as PRIMARY → --brand-primary and so on;
 * those token names do not exist in this app, and inventing them would paint
 * with `var(--brand-primary)` — undefined, which resolves to nothing and paints
 * transparent. These are the tokens `index.css` actually defines, as triplets so
 * they compose with `rgb()` the way `modeColor` does:
 *
 *   PRIMARY  --brand-orange  the brand fill, the same orange as the CTA
 *   ACCENT   --brand-blue    the secondary brand colour
 *   SUCCESS  --ok            the semantic green, which is what SUCCESS means here
 */
const ACCENT_TOKEN: Record<string, string> = {
  PRIMARY: "rgb(var(--brand-orange))",
  ACCENT: "rgb(var(--brand-blue))",
  SUCCESS: "rgb(var(--ok))",
};

/**
 * The colour to paint a service card with: its own `accent` when the tenant set
 * one, the positional mode colour otherwise.
 *
 * An unknown string falls back rather than throwing. The column has a CHECK
 * constraint, so a fourth value can only arrive from a future migration this
 * build has not seen — and a card in the wrong colour is a smaller failure than
 * a card that does not render.
 */
export function serviceColor(
  accent: string | null | undefined,
  fallback: FreightMode,
): string {
  return (accent && ACCENT_TOKEN[accent]) || modeColor(fallback);
}

/**
 * A pillar's icon, by NAME.
 *
 * `service_type_web_group.icon` stores a name and never markup — a
 * tenant-editable field that reached the DOM as HTML would be stored XSS on a
 * public page (migration 12755 says so in as many words). So the tenant picks
 * from a set the renderer owns, and an unrecognised name resolves to null and
 * draws nothing: a heading with no icon is a smaller failure than a heading
 * whose icon is somebody's typo.
 *
 * Names are matched case-insensitively and on the bare word, so `SHIP`, `ship`
 * and `ShipIcon` all land on the same glyph — a tenant typing into an admin
 * field is not writing an identifier.
 */
const ICONS_BY_NAME: Record<string, IconComponent> = {
  ship: ShipIcon,
  plane: PlaneIcon,
  air: PlaneIcon,
  truck: TruckIcon,
  road: TruckIcon,
  warehouse: WarehouseIcon,
  document: DocumentIcon,
  customs: DocumentIcon,
  shield: ShieldIcon,
  clock: ClockIcon,
  globe: GlobeIcon,
  box: BoxIcon,
};

export function iconByName(name: string | null | undefined): IconComponent | null {
  if (!name) return null;
  const key = name.trim().toLowerCase().replace(/icon$/, "");
  return ICONS_BY_NAME[key] || null;
}
