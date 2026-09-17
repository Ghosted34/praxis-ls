/**
 * Avatar — initials disc for a person or organisation.
 *
 * Relocated from `features/sales/ui.tsx:135` (audit A2).
 *
 * A PHOTO IS USED WHEN ONE EXISTS. The note that used to sit here said the
 * product has no avatar upload — true of employees until GET /employees began
 * returning `avatar_ref`, which the app_user profile picture (and every screen
 * that shows a colleague: the team chat, the mail signature) already uses. The
 * initials disc is now the FALLBACK for a person with no photo rather than the
 * only thing this component can draw.
 *
 * ACCESSIBILITY. The initials are decorative — they are a compressed form of a
 * name that is essentially always rendered next to the avatar, so announcing
 * "JD" as well would be noise. The disc is therefore `aria-hidden`. If you use
 * an Avatar with NO adjacent name (a bare row of collaborators, say), pass
 * `title` so the full name is exposed as the accessible name instead.
 *
 * @example
 * <div className="flex items-center gap-2">
 *   <Avatar name={contact.full_name} />
 *   <span>{contact.full_name}</span>
 * </div>
 *
 * // Standalone, no visible name next to it:
 * <Avatar name={owner.full_name} title={owner.full_name} />
 */
import { cn } from "@/lib/cn";

/** First letter of the first two words: "Ada Lovelace" → "AL". */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "—";
  return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
}

export function Avatar({
  name,
  src,
  size = "md",
  title,
  className,
}: {
  name: string;
  /** Photo URL (`avatar_ref`, a `/media/...` path). Falls back to initials. */
  src?: string | null;
  size?: "sm" | "md";
  /** Accessible name. Pass this when no visible name sits next to the avatar. */
  title?: string;
  className?: string;
}) {
  if (src) {
    return (
      // Same accessibility contract as the disc below: the photo is decorative
      // beside a visible name (alt=""), and carries the name itself when it is
      // used standalone (title → alt).
      <img
        src={src}
        alt={title || ""}
        className={cn(
          "shrink-0 rounded-full object-cover",
          size === "sm" ? "h-7 w-7" : "h-9 w-9",
          className,
        )}
        {...(title ? {} : { "aria-hidden": true })}
      />
    );
  }
  return (
    <span
      // --primary-ink for the initials: they are type, and the raw brand orange
      // fails AA as text (F13). The tinted ground still uses --primary.
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full bg-primary/10 font-semibold text-primary-ink",
        size === "sm" ? "h-7 w-7 text-micro" : "h-9 w-9 text-label",
        className,
      )}
      {...(title
        ? { role: "img", "aria-label": title }
        : { "aria-hidden": true })}
    >
      {initials(name)}
    </span>
  );
}
