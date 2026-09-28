import * as React from "react";
import { useTranslation } from "react-i18next";

/**
 * Six boxes, one value. Typing advances, backspace retreats, and pasting the
 * whole code — or the phone offering it from the email (autocomplete
 * "one-time-code") — fills every box at once.
 *
 * One component for both emailed codes the portal asks for: signing in, and
 * signing a proposal.
 */
export function CodeInput({ value, onChange, disabled, label }: { value: string; onChange: (v: string) => void; disabled?: boolean; label?: string }) {
  const { t } = useTranslation();
  const refs = React.useRef<(HTMLInputElement | null)[]>([]);
  const digits = value.padEnd(6, " ").slice(0, 6).split("");

  React.useEffect(() => {
    refs.current[Math.min(value.length, 5)]?.focus();
    // Only on mount: moving focus on every keystroke is the handler's job.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const set = (next: string) => {
    const clean = next.replace(/\D/g, "").slice(0, 6);
    onChange(clean);
    refs.current[Math.min(clean.length, 5)]?.focus();
  };

  return (
    <div className="pt-otp mt-6" role="group" aria-label={label || t("portal.signin.codeLabel")}>
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          inputMode="numeric"
          autoComplete={i === 0 ? "one-time-code" : "off"}
          aria-label={t("portal.signin.digit", { n: i + 1 })}
          maxLength={i === 0 ? 6 : 1}
          disabled={disabled}
          value={d.trim()}
          onChange={(e) => {
            const v = e.target.value.replace(/\D/g, "");
            if (v.length > 1) return set(v); // a paste or autofill into one box
            const arr = value.split("");
            arr[i] = v;
            set(arr.join("").slice(0, i + 1) + (v ? value.slice(i + 1) : ""));
          }}
          onKeyDown={(e) => {
            if (e.key === "Backspace" && !digits[i].trim() && i > 0) {
              e.preventDefault();
              set(value.slice(0, i - 1));
            }
          }}
          onPaste={(e) => {
            e.preventDefault();
            set(e.clipboardData.getData("text"));
          }}
        />
      ))}
    </div>
  );
}
