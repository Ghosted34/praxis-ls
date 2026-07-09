/**
 * Segmented one-time-code input. `length` boxes, one digit each; handles typing,
 * backspace, arrow keys, and paste of a full code. Value is the joined string;
 * onComplete fires when all boxes are filled.
 */
import * as React from "react";
import { cn } from "@/lib/cn";

export function OtpInput({
  length = 6,
  value,
  onChange,
  onComplete,
  autoFocus,
  disabled,
}: {
  length?: number;
  value: string;
  onChange: (v: string) => void;
  onComplete?: (v: string) => void;
  autoFocus?: boolean;
  disabled?: boolean;
}) {
  const refs = React.useRef<(HTMLInputElement | null)[]>([]);
  const digits = React.useMemo(() => value.padEnd(length, " ").slice(0, length).split(""), [value, length]);

  React.useEffect(() => {
    if (autoFocus) refs.current[0]?.focus();
  }, [autoFocus]);

  function setAt(i: number, d: string) {
    const next = value.split("");
    next[i] = d;
    const joined = next.join("").replace(/\s/g, "").slice(0, length);
    onChange(joined);
    if (joined.length === length) onComplete?.(joined);
  }

  function onKey(i: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace") {
      e.preventDefault();
      if (digits[i].trim()) setAt(i, "");
      else if (i > 0) {
        refs.current[i - 1]?.focus();
        setAt(i - 1, "");
      }
    } else if (e.key === "ArrowLeft" && i > 0) refs.current[i - 1]?.focus();
    else if (e.key === "ArrowRight" && i < length - 1) refs.current[i + 1]?.focus();
  }

  function onInput(i: number, e: React.ChangeEvent<HTMLInputElement>) {
    const d = e.target.value.replace(/\D/g, "").slice(-1);
    if (!d) return;
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
    <div className="flex justify-center gap-2" role="group" aria-label="One-time code">
      {Array.from({ length }).map((_, i) => (
        <input
          key={i}
          ref={(el) => (refs.current[i] = el)}
          inputMode="numeric"
          autoComplete={i === 0 ? "one-time-code" : "off"}
          maxLength={1}
          disabled={disabled}
          value={digits[i].trim()}
          onChange={(e) => onInput(i, e)}
          onKeyDown={(e) => onKey(i, e)}
          onPaste={onPaste}
          className={cn(
            "h-12 w-10 rounded-lg border text-center text-lg font-medium",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
            digits[i].trim() ? "border-ring" : "border-input",
          )}
        />
      ))}
    </div>
  );
}
