/**
 * The box you type into — one component, two sizes, both surfaces.
 *
 * The drawer's composer and the workspace's hero composer are the same control
 * at different scales. That is not a saving, it is the point: the scope you
 * picked, the mode you were in and the way Enter behaves must not change when
 * you press expand. `size="hero"` is the landing state on the full page,
 * `size="compact"` is the drawer and the workspace once a thread is running.
 *
 * WHAT IT CARRIES, AND WHAT IT DELIBERATELY DOES NOT.
 *
 *   Scope    Which part of the product the question is about. The ERP-native
 *            answer to "work vs web" — there is no web here, there is Finance
 *            and Operations and Procurement, and an assistant that searches all
 *            of them for a question about one is an assistant that is often
 *            confidently wrong. Permission-aware (`useAiScopes`).
 *   Mode     Ask / Draft / Analyse / Act — the assistant's posture, and the
 *            SHAPE of the answer expected. Act does not skip the confirm step;
 *            nothing does.
 *   Mic      Dictation, because half of this product's users are not sitting
 *            down. Browser API, no vendor. Hidden entirely where unsupported.
 *   Context  A removable chip naming the screen the drawer was opened from, so
 *            "summarise this" resolves without anyone pasting a reference.
 *
 * No attachments and no slash-command menu. Both were considered and declined
 * for this pass: an attachment surface that cannot yet be read is a promise the
 * product does not keep, and a slash menu duplicates the command palette the
 * shell already has (`command-palette-context`).
 *
 * ENTER SENDS, SHIFT+ENTER NEWLINES. The convention every assistant shares, and
 * worth matching exactly — this is muscle memory, not a design decision to make
 * fresh. The textarea grows to a ceiling and then scrolls, so a long question
 * never pushes the thread off screen.
 */
import * as React from "react";
import { cn } from "@/lib/cn";
import { Tooltip } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownLabel,
  DropdownRadioGroup,
  DropdownRadioItem,
} from "@/components/ui/dropdown-menu";
import { XIcon } from "@/components/ui/icons";
import {
  AI_MODES,
  scopeByKey,
  useAiScopes,
  type AiMode,
  type AiScope,
  type ScreenContext,
} from "./context";
import { MicIcon, PraxisMark, ScopeIcon } from "./icons";
import { useDictation } from "./speech";

/** Send — an upward arrow in a filled disc, matching the reference ERP. */
function SendArrow() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={16}
      height={16}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 19V5M5.5 11.5L12 5l6.5 6.5" />
    </svg>
  );
}

export type ComposerValue = { scope: string; mode: AiMode };

export function AiComposer({
  onSend,
  busy,
  size = "compact",
  value,
  onValueChange,
  screen,
  focusOnMount,
  placeholder = "Ask Praxis anything…",
  className,
}: {
  onSend: (text: string, opts: ComposerValue) => void;
  busy?: boolean;
  size?: "hero" | "compact";
  /** Scope + mode, owned by the surface so they survive expand-to-page. */
  value: ComposerValue;
  onValueChange: (v: ComposerValue) => void;
  /** The screen behind the drawer. Renders the removable context chip. */
  screen?: ScreenContext | null;
  /** Put the caret here on mount. Pointer-input viewports only — see below. */
  focusOnMount?: boolean;
  placeholder?: string;
  className?: string;
}) {
  const [text, setText] = React.useState("");
  const [contextOn, setContextOn] = React.useState(true);
  const scopes = useAiScopes();
  const scope = scopeByKey(scopes, value.scope);
  const ref = React.useRef<HTMLTextAreaElement>(null);
  const dictation = useDictation(setText);

  // A new screen means a new subject: re-arm the chip the user may have
  // dismissed for the last one. Dismissing "Viewing: Receivables" is a statement
  // about that question, not a preference about every future one.
  React.useEffect(() => setContextOn(true), [screen?.route]);

  /**
   * Focus on mount, imperatively and conditionally — NOT via `autoFocus`.
   *
   * Two reasons, and the second is the substantive one. The DOM `autoFocus`
   * attribute is a blunt instrument the a11y lint rules rightly object to; more
   * importantly, focusing a textarea on a phone RAISES THE KEYBOARD, which on a
   * 360px viewport covers the suggestion chips the empty state just offered.
   * The drawer opens for the purpose of typing, so the caret belongs in the box
   * — but only where putting it there does not eat half the panel.
   */
  React.useEffect(() => {
    if (!focusOnMount) return;
    if (!window.matchMedia?.("(min-width: 768px)").matches) return;
    ref.current?.focus();
  }, [focusOnMount]);

  // Auto-grow to a ceiling, then scroll. Measured off `scrollHeight` after a
  // reset to `auto`, which is the only way to let it SHRINK again on delete.
  const hero = size === "hero";
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, hero ? 220 : 160)}px`;
  }, [text, hero]);

  function submit() {
    const q = text.trim();
    if (!q || busy) return;
    if (dictation.listening) dictation.stop();
    setText("");
    onSend(q, value);
  }

  const canSend = !!text.trim() && !busy;

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {/* Context chip — what the assistant will assume "this" means. */}
      {screen && contextOn && (
        <div className="flex">
          <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-brand-blue/30 bg-brand-blue/10 py-1 pl-2.5 pr-1.5 text-micro text-brand-blue-ink">
            <PraxisMark width={11} height={11} className="shrink-0" />
            <span className="truncate">
              Viewing: <span className="font-semibold">{screen.label}</span>
            </span>
            <button
              type="button"
              onClick={() => setContextOn(false)}
              aria-label={`Stop using ${screen.label} as context`}
              className="tap-24 grid h-4 w-4 shrink-0 place-items-center rounded-full text-brand-blue-ink/70 transition-colors hover:bg-brand-blue/20 hover:text-brand-blue-ink"
            >
              <XIcon width={10} height={10} />
            </button>
          </span>
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className={cn(
          // The focus ring lives on the WRAPPER, not the textarea: the whole box
          // is the control as far as the user is concerned, and a ring around an
          // inner element inside a bordered box reads as two nested fields.
          "rounded-lg border border-border bg-card transition-colors focus-within:border-primary",
          hero && "shadow-sm",
        )}
      >
        <textarea
          ref={ref}
          value={text}
          rows={1}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (
              e.key === "Enter" &&
              !e.shiftKey &&
              !e.nativeEvent.isComposing
            ) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={dictation.listening ? "Listening…" : placeholder}
          aria-label="Ask Praxis"
          className={cn(
            "block w-full resize-none bg-transparent px-3.5 text-foreground outline-none placeholder:text-muted-foreground",
            hero ? "pt-3.5 text-base" : "pt-2.5 text-sm",
          )}
        />

        {/* Controls row. Scope and mode on the left because they qualify what
            you are about to say; send on the right because it ends it. */}
        <div
          className={cn(
            "flex items-center gap-1.5 px-2",
            hero ? "pb-2 pt-1.5" : "pb-1.5 pt-1",
          )}
        >
          <ScopePicker
            scopes={scopes}
            value={scope}
            onChange={(k) => onValueChange({ ...value, scope: k })}
          />
          <ModeChips
            value={value.mode}
            onChange={(m) => onValueChange({ ...value, mode: m })}
            compact={!hero}
          />

          <span className="flex-1" />

          {dictation.supported && (
            <Tooltip
              content={dictation.listening ? "Stop dictating" : "Dictate"}
            >
              <button
                type="button"
                onClick={dictation.toggle}
                aria-label={
                  dictation.listening ? "Stop dictating" : "Dictate a question"
                }
                aria-pressed={dictation.listening}
                className={cn(
                  "tap-24 relative grid h-8 w-8 shrink-0 place-items-center rounded-md transition-colors",
                  dictation.listening
                    ? "bg-bad-fill/12 text-bad"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                <MicIcon width={16} height={16} />
                {/* The pulse is the only decorative motion here, and it is
                    carrying meaning: the microphone is live. Suppressed under
                    prefers-reduced-motion globally (index.css). */}
                {dictation.listening && (
                  <span
                    aria-hidden
                    className="absolute h-8 w-8 animate-ping rounded-md bg-bad-fill/20"
                  />
                )}
              </button>
            </Tooltip>
          )}

          <button
            type="submit"
            disabled={!canSend}
            aria-label="Send"
            className={cn(
              "grid h-8 w-8 shrink-0 place-items-center rounded-md transition-all",
              canSend
                ? "bg-primary text-primary-foreground hover:opacity-90"
                : "bg-muted text-muted-foreground/60",
            )}
          >
            <SendArrow />
          </button>
        </div>
      </form>
    </div>
  );
}

/**
 * The scope chip.
 *
 * A menu rather than a `<Select>` because the list is short, the labels carry
 * icons the user already knows from the ribbon, and the trigger has to READ as
 * current state ("Scope: Finance") rather than as an empty form field.
 */
function ScopePicker({
  scopes,
  value,
  onChange,
}: {
  scopes: AiScope[];
  value: AiScope;
  onChange: (key: string) => void;
}) {
  const scoped = value.key !== "all";
  const Icon = value.Icon;
  return (
    <DropdownMenu
      align="start"
      trigger={
        <button
          type="button"
          aria-label={`Scope: ${value.label}`}
          className={cn(
            "tap-24 inline-flex h-7 max-w-[13rem] items-center gap-1.5 rounded-md px-2 text-micro font-medium transition-colors",
            scoped
              ? "bg-primary/12 text-primary-ink hover:bg-primary/20"
              : "text-muted-foreground hover:bg-accent hover:text-foreground",
          )}
        >
          {scoped ? (
            <Icon width={12} height={12} />
          ) : (
            <ScopeIcon width={12} height={12} />
          )}
          <span className="truncate">{value.label}</span>
        </button>
      }
    >
      <DropdownLabel>Scope this question to</DropdownLabel>
      <DropdownRadioGroup value={value.key} onValueChange={onChange}>
        {scopes.map((s) => (
          <DropdownRadioItem
            key={s.key}
            value={s.key}
            hint={s.key === "all" ? "Every area you have access to" : undefined}
          >
            {s.label}
          </DropdownRadioItem>
        ))}
      </DropdownRadioGroup>
    </DropdownMenu>
  );
}

/**
 * Mode chips.
 *
 * NOT `<Segmented>`, and this is the one place the shared primitive was the
 * wrong answer. Segmented is a track with a lifted active segment — a view
 * switcher, sized and weighted to be the primary control of a toolbar. Sitting
 * inside a composer next to the scope chip, it out-shouted the text you are
 * writing. These are the same choice at chip weight, and they inherit the same
 * WAI-ARIA radio-group semantics so nothing is given up for it.
 *
 * Below `sm` in the drawer, only the active mode is shown as a chip that cycles
 * on tap. Four chips plus a scope plus a mic does not fit a 360px composer, and
 * wrapping the row is worse than cycling.
 */
function ModeChips({
  value,
  onChange,
  compact,
}: {
  value: AiMode;
  onChange: (m: AiMode) => void;
  compact?: boolean;
}) {
  const idx = AI_MODES.findIndex((m) => m.value === value);
  return (
    <div
      role="radiogroup"
      aria-label="Answer mode"
      className={cn("flex items-center gap-0.5", compact && "max-sm:hidden")}
    >
      {AI_MODES.map((m) => {
        const on = m.value === value;
        return (
          <Tooltip key={m.value} content={m.hint}>
            <button
              type="button"
              role="radio"
              aria-checked={on}
              tabIndex={on ? 0 : -1}
              onClick={() => onChange(m.value)}
              onKeyDown={(e) => {
                if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
                e.preventDefault();
                const d = e.key === "ArrowRight" ? 1 : -1;
                onChange(
                  AI_MODES[(idx + d + AI_MODES.length) % AI_MODES.length].value,
                );
              }}
              className={cn(
                "tap-24 h-7 rounded-md px-2 text-micro font-medium transition-colors",
                on
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {m.label}
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
}

/** The compact cycling variant, for a drawer on a phone. */
export function ModeChipCompact({
  value,
  onChange,
}: {
  value: AiMode;
  onChange: (m: AiMode) => void;
}) {
  const idx = AI_MODES.findIndex((m) => m.value === value);
  const mode = AI_MODES[idx === -1 ? 0 : idx];
  return (
    <button
      type="button"
      onClick={() => onChange(AI_MODES[(idx + 1) % AI_MODES.length].value)}
      aria-label={`Answer mode: ${mode.label}. Tap to change.`}
      className="tap-24 h-7 rounded-md px-2 text-micro font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground sm:hidden"
    >
      {mode.label}
    </button>
  );
}
