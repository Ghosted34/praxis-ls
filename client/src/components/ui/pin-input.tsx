/**
 * Quick PIN boxes — premium segmented PIN input for the dark login modal.
 * Large boxes, auto-advance, paste, backspace/arrow handling, masked dots with
 * peek toggle. Reuses the interaction model of OtpInput but with a distinct
 * visual (login-card tokens).
 *
 * PIN_LENGTH is FIXED at 4 and is the only length the product accepts — the
 * backend validator spells the same 4. It used to render 8 boxes for a
 * 4-to-8-digit PIN, which cost two things: the boxes stopped describing the
 * secret (a 4-digit PIN sat in an 8-box row reading "4 / 8"), and `onComplete`
 * only fires at `length`, so a 4-digit PIN never auto-submitted and the button
 * was the only way in. Both are the same off-by-four.
 */
import * as React from "react";
import { EyeIcon, EyeOffIcon } from "@/components/ui/icons";
import { cn } from "@/lib/cn";

/** The one PIN length the product accepts. Backend: /^\d{4}$/. */
export const PIN_LENGTH = 4;

export function PinInput({
  value,
  onChange,
  onComplete,
  disabled,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  onComplete?: (v: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
}) {
  const length = PIN_LENGTH;
  const [show, setShow] = React.useState(false);
  const refs = React.useRef<(HTMLInputElement | null)[]>([]);
  // Pad value to length for rendering; actual stored value is trimmed.
  const digits = React.useMemo(
    () => value.padEnd(length, " ").slice(0, length).split(""),
    [value, length],
  );

  React.useEffect(() => {
    if (autoFocus) refs.current[0]?.focus();
  }, [autoFocus]);

  function setAt(i: number, d: string) {
    const arr = value.split("");
    // Ensure array length covers i
    while (arr.length <= i) arr.push("");
    arr[i] = d;
    const joined = arr.join("").replace(/\s/g, "").replace(/\D/g, "").slice(0, length);
    onChange(joined);
    if (joined.length === length) onComplete?.(joined);
  }

  function onKey(i: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace") {
      e.preventDefault();
      if (digits[i].trim()) {
        setAt(i, "");
      } else if (i > 0) {
        refs.current[i - 1]?.focus();
        // remove previous
        const arr = value.split("");
        arr.splice(i - 1, 1);
        const joined = arr.join("").replace(/\s/g, "").replace(/\D/g, "").slice(0, length);
        onChange(joined);
      }
    } else if (e.key === "ArrowLeft" && i > 0) refs.current[i - 1]?.focus();
    else if (e.key === "ArrowRight" && i < length - 1) refs.current[i + 1]?.focus();
  }

  function onInput(i: number, e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value.replace(/\D/g, "");
    if (!raw) return;
    const d = raw.slice(-1);
    setAt(i, d);
    if (i < length - 1) refs.current[i + 1]?.focus();
  }

  function onPaste(e: React.ClipboardEvent<HTMLInputElement>) {
    e.preventDefault();
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, length);
    if (!pasted) return;
    onChange(pasted);
    if (pasted.length === length) onComplete?.(pasted);
    refs.current[Math.min(pasted.length, length - 1)]?.focus();
  }

  return (
    <div className="flex flex-col gap-2">
      <div
        className="flex items-center justify-center gap-1.5 sm:gap-2"
        role="group"
        aria-label="Quick PIN"
      >
        {Array.from({ length }).map((_, i) => {
          const hasValue = digits[i].trim() !== "";
          // Visual: masked dots unless show === true. Keep digit for screen readers? Use actual digit masked visually.
          const display = hasValue ? (show ? digits[i] : "•") : "";
          const isActive = i === value.length; // next to fill
          return (
            <input
              key={i}
              ref={(el) => (refs.current[i] = el)}
              inputMode="numeric"
              autoComplete="off"
              maxLength={1}
              disabled={disabled}
              // We keep value as display char, but onChange handles digit. Using display for visual.
              // To avoid browser autofill fighting, we set value to display.
              value={display}
              // IMPORTANT: onChange receives the raw typed character, but value prop is masked,
              // so we need to use onInput logic; we bypass React's value mapping for show toggle.
              // When show===false, value is "•" but the underlying digit is stored in value state.
              // That's okay because the input's DOM value is controlled as display; on paste/type we parse digit.
              onChange={(e) => onInput(i, e)}
              onKeyDown={(e) => onKey(i, e)}
              onPaste={onPaste}
              // When masked, still show "•" but keep input type text so • renders large.
              aria-label={`PIN digit ${i + 1}`}
              className={cn(
                "h-[46px] w-[36px] sm:h-[52px] sm:w-[42px] rounded-xl border text-center text-[18px] font-semibold transition-all",
                "bg-white/[0.06] backdrop-blur",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-0 focus-visible:border-primary/40",
                hasValue
                  ? "border-primary/30 bg-primary/[0.08] text-white shadow-[0_0_0_1px_color-mix(in_srgb,var(--primary)_18%,transparent)]"
                  : "border-white/[0.10] text-white/90",
                isActive && !hasValue ? "border-primary/40 bg-white/[0.08]" : "",
                disabled && "opacity-50",
              )}
              style={{
                // Slight letter spacing for dots
                fontVariantNumeric: "tabular-nums",
              }}
            />
          );
        })}
      </div>
      <div className="flex items-center justify-between px-1">
        <span className="text-[11px] tracking-wide text-white/45">
          {value.length === 0
            ? `${length} digits`
            : `${value.length} / ${length}`}
        </span>
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] font-medium text-white/70 hover:text-white hover:bg-white/[0.08] transition-colors"
          aria-label={show ? "Hide PIN" : "Show PIN"}
        >
          {show ? <EyeOffIcon width={14} height={14} /> : <EyeIcon width={14} height={14} />}
          {show ? "Hide" : "Show"}
        </button>
      </div>
    </div>
  );
}

/**
 * Rendered numeric keypad for touch — optional. Calls onPress(digit).
 * Fires onDigit for 0-9, onBackspace for ⌫.
 */
export function PinKeypad({
  onDigit,
  onBackspace,
  disabled,
}: {
  onDigit: (d: string) => void;
  onBackspace: () => void;
  disabled?: boolean;
}) {
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"];
  return (
    <div className="mx-auto grid max-w-[260px] grid-cols-3 gap-2">
      {keys.map((k, i) => {
        if (k === "") return <span key={i} />;
        const isBack = k === "⌫";
        return (
          <button
            key={k + i}
            type="button"
            disabled={disabled}
            onClick={() => (isBack ? onBackspace() : onDigit(k))}
            className={cn(
              "h-11 rounded-xl border text-sm font-semibold transition-colors active:scale-[0.98]",
              isBack
                ? "border-white/10 bg-white/[0.04] text-white/70 hover:bg-white/[0.08]"
                : "border-white/10 bg-white/[0.06] text-white hover:bg-white/[0.10] hover:border-white/15",
              disabled && "opacity-50",
            )}
          >
            {k}
          </button>
        );
      })}
    </div>
  );
}
