/**
 * The signature method cards — one component, three audiences.
 *
 * The sender sees them when dispatching, the signer sees them on the public
 * signing page (PR-3), and an administrator sees them as checkboxes at
 * Settings → Signatures. All three render from the SAME catalogue
 * (`signature_preset`, seeded in migration 10741), which is the point: a tenant
 * that renames a card renames it everywhere, and a card that has not shipped
 * cannot appear in one surface and not another.
 *
 * doc/SIGNATURE_ENGINEERING_GUIDE.md §3.3, §3.4.
 */

import { cn } from "@/lib/cn";
import { Pill } from "@/components/ui/pill";
import { ASSURANCE_WORDS, BLOCKED_REASON, look } from "./signature-vocab";

export type PresetCard = {
  preset_code: string;
  label: string;
  blurb?: string | null;
  tier?: string | null;
  assurance_level: string;
  visual_mark: string;
};

export type BlockedCard = {
  preset_code: string;
  reason: string;
  feature?: string;
};

export type SignatureMenu = {
  cards: PresetCard[];
  default: string;
  blocked: BlockedCard[];
  ceiling?: { signable: boolean; allowsQes: boolean; allowsWet: boolean };
};

export function SignatureCard({
  card,
  selected,
  disabled,
  disabledReason,
  onSelect,
}: {
  card: Pick<PresetCard, "preset_code" | "label" | "blurb" | "tier" | "assurance_level">;
  selected?: boolean;
  disabled?: boolean;
  disabledReason?: string;
  onSelect?: (code: string) => void;
}) {
  const interactive = !disabled && typeof onSelect === "function";
  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={selected}
      onClick={interactive ? () => onSelect(card.preset_code) : undefined}
      className={cn(
        "flex w-full flex-col gap-1 rounded-lg border p-3 text-left transition",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        selected && "border-primary bg-primary/5 ring-1 ring-primary",
        !selected && !disabled && "border-border hover:border-primary/60 hover:bg-muted/40",
        disabled && "cursor-not-allowed border-dashed border-border bg-muted/30 opacity-60",
      )}
    >
      <span className="flex items-center gap-2">
        <span className="text-sm font-semibold">{card.label}</span>
        {card.tier ? (
          <Pill tone="mute" className="shrink-0">
            <span>Tier {card.tier}</span>
          </Pill>
        ) : null}
      </span>
      {card.blurb ? (
        <span className="text-xs text-muted-foreground">{card.blurb}</span>
      ) : null}
      <span className="text-xs text-muted-foreground">
        {disabled
          ? (disabledReason ?? "Not available")
          : look(ASSURANCE_WORDS, card.assurance_level, card.assurance_level)}
      </span>
    </button>
  );
}

/**
 * The full menu: what the signer may pick, plus what they may not and why.
 *
 * `menu.blocked` is rendered after the available cards rather than interleaved,
 * so the choice reads first and the explanations sit below it.
 */
export function SignatureCardGrid({
  menu,
  value,
  onChange,
  showBlocked = true,
}: {
  menu: SignatureMenu;
  value: string | null;
  onChange: (code: string) => void;
  showBlocked?: boolean;
}) {
  const known = new Map(menu.cards.map((c) => [c.preset_code, c]));
  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2">
        {menu.cards.map((c) => (
          <SignatureCard
            key={c.preset_code}
            card={c}
            selected={value === c.preset_code}
            onSelect={onChange}
          />
        ))}
      </div>
      {showBlocked && menu.blocked.length > 0 ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {menu.blocked
            .filter((b) => !known.has(b.preset_code))
            .map((b) => (
              <SignatureCard
                key={b.preset_code}
                card={{
                  preset_code: b.preset_code,
                  label: b.preset_code
                    .toLowerCase()
                    .replace(/_/g, " ")
                    .replace(/^./, (m) => m.toUpperCase()),
                  blurb: null,
                  tier: null,
                  assurance_level: "",
                }}
                disabled
                disabledReason={look(BLOCKED_REASON, b.reason, "Not available")}
              />
            ))}
        </div>
      ) : null}
    </div>
  );
}
