/**
 * The formatting toolbar.
 *
 * ── EVERY CONTROL IS A BUTTON WITH aria-pressed ─────────────────────────────
 *
 * A toolbar built from divs with click handlers is the most common
 * mouse-only-by-construction control on the web, and a formatting toolbar is
 * exactly where a keyboard user needs to be able to tell what is currently ON.
 * `aria-pressed` reflects the mark at the caret, so a screen reader announces
 * "Bold, pressed" rather than just "Bold".
 *
 * ── THE FONT MENU OFFERS EIGHT FAMILIES, AND SAYS WHY ───────────────────────
 *
 * Those eight render at the recipient. The note under the menu is not decoration
 * — without it the list looks arbitrarily short, and somebody will eventually
 * "fix" it by adding the tenant's brand font, which renders as Times New Roman
 * in Outlook with nobody able to explain why.
 */
import * as React from "react";
import { cn } from "@/lib/cn";
import { Select } from "@/components/ui/modal";
import { tr } from "@/lib/i18n";
import { FONTS } from "./fonts";
import { type Editor } from "./use-editor";

function Tool({
  label,
  active,
  onClick,
  disabled,
  children,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active ?? undefined}
      disabled={disabled}
      // onMouseDown, not onClick: clicking a toolbar button blurs the editor and
      // the selection is lost before the command runs.
      onMouseDown={(e) => { e.preventDefault(); onClick(); }}
      className={cn(
        "inline-flex h-7 min-w-7 items-center justify-center rounded px-1.5 text-sm transition-colors",
        active ? "bg-primary/15 font-semibold text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
        disabled && "cursor-not-allowed opacity-40",
      )}
    >
      {children}
    </button>
  );
}

const Divider = () => <span aria-hidden className="mx-0.5 h-5 w-px bg-border" />;

/**
 * The colours on offer, and why it is a short list rather than a picker.
 *
 * `compose.js` accepts a colour only as `#rgb`, `#rrggbb` or `rgb()` — anything
 * else is dropped on the way out, silently, because a mark it cannot parse
 * contributes no style rather than an error. A native `<input type="color">`
 * would satisfy that, and would also let somebody set 14pt #f2f4f5 body text
 * that is unreadable in every dark-mode client and invisible on a printout.
 * These are the colours that survive both: dark enough to read on white, and
 * distinguishable from one another for the ~8% of men with a colour deficiency.
 *
 * The palette is deliberately NOT the app's theme tokens. These values are
 * baked into the recipient's mail, where our CSS variables do not exist.
 */
const TEXT_COLOURS: { value: string; label: string }[] = [
  { value: "", label: "Default" },
  { value: "#111827", label: "Black" },
  { value: "#4b5563", label: "Grey" },
  { value: "#b91c1c", label: "Red" },
  { value: "#c2410c", label: "Orange" },
  { value: "#a16207", label: "Amber" },
  { value: "#15803d", label: "Green" },
  { value: "#1a56db", label: "Blue" },
  { value: "#6d28d9", label: "Purple" },
];

/** Highlights are backgrounds, so they run the other way: pale enough that the
 *  text on top of them stays legible when a client ignores our text colour. */
const HIGHLIGHTS: { value: string; label: string }[] = [
  { value: "", label: "None" },
  { value: "#fff3a3", label: "Yellow" },
  { value: "#c7f5d9", label: "Green" },
  { value: "#cfe3ff", label: "Blue" },
  { value: "#ffd6d6", label: "Red" },
];

/** A swatch menu: a `<select>` whose options carry their colour, so the choice
 *  is visible before it is made and reachable from the keyboard. */
function ColourMenu({
  id,
  label,
  options,
  value,
  onPick,
}: {
  id: string;
  label: string;
  options: { value: string; label: string }[];
  value: string;
  onPick: (value: string) => void;
}) {
  return (
    <>
      <label className="sr-only" htmlFor={id}>{label}</label>
      <Select
        id={id}
        title={label}
        className="h-7 w-auto text-xs"
        value={value}
        onChange={(e) => onPick(e.target.value)}
      >
        {options.map((o) => (
          <option key={o.value || "none"} value={o.value} style={o.value ? { color: o.value } : undefined}>
            {tr(o.label)}
          </option>
        ))}
      </Select>
    </>
  );
}

export function ComposerToolbar({
  editor,
  slotRight,
}: {
  editor: Editor | null;
  /** PR-4's AI menu and voice button register here rather than editing this JSX. */
  slotRight?: React.ReactNode;
}) {
  // TipTap mutates the editor in place, so React has nothing to re-render on.
  // Subscribing to its transactions is what keeps aria-pressed honest.
  const [, force] = React.useReducer((n: number) => n + 1, 0);
  React.useEffect(() => {
    if (!editor) return undefined;
    editor.on("transaction", force);
    return () => { editor.off("transaction", force); };
  }, [editor]);

  if (!editor) return null;
  const chain = () => editor.chain().focus();

  return (
    <div
      role="toolbar"
      aria-label={tr("Formatting")}
      aria-controls="composer-body"
      className="flex flex-wrap items-center gap-0.5 border-b border-border px-2 py-1"
    >
      <Tool label={tr("Bold")} active={editor.isActive("bold")} onClick={() => chain().toggleBold().run()}>
        <strong>B</strong>
      </Tool>
      <Tool label={tr("Italic")} active={editor.isActive("italic")} onClick={() => chain().toggleItalic().run()}>
        <em>I</em>
      </Tool>
      <Tool label={tr("Underline")} active={editor.isActive("underline")} onClick={() => chain().toggleUnderline().run()}>
        <span className="underline">U</span>
      </Tool>
      <Tool label={tr("Strikethrough")} active={editor.isActive("strike")} onClick={() => chain().toggleStrike().run()}>
        <span className="line-through">S</span>
      </Tool>

      <Divider />

      <Tool label={tr("Heading")} active={editor.isActive("heading", { level: 2 })} onClick={() => chain().toggleHeading({ level: 2 }).run()}>
        H
      </Tool>
      <Tool label={tr("Bulleted list")} active={editor.isActive("bulletList")} onClick={() => chain().toggleBulletList().run()}>
        •
      </Tool>
      <Tool label={tr("Numbered list")} active={editor.isActive("orderedList")} onClick={() => chain().toggleOrderedList().run()}>
        1.
      </Tool>
      <Tool label={tr("Quote")} active={editor.isActive("blockquote")} onClick={() => chain().toggleBlockquote().run()}>
        ❝
      </Tool>
      <Tool label={tr("Code")} active={editor.isActive("code")} onClick={() => chain().toggleCode().run()}>
        {"</>"}
      </Tool>

      <Divider />

      <Tool
        label={tr("Link")}
        active={editor.isActive("link")}
        onClick={() => {
          if (editor.isActive("link")) { chain().unsetLink().run(); return; }
          // window.prompt rather than a modal: the caret and the selection have
          // to survive, and every dialog in this app moves focus. Replaced with
          // an inline popover when one exists that does not steal focus.
          const url = window.prompt(tr("Link to:"));
          if (url) chain().setLink({ href: url }).run();
        }}
      >
        🔗
      </Tool>
      <Tool label={tr("Insert table")} onClick={() => chain().insertTable({ rows: 2, cols: 2, withHeaderRow: true }).run()}>
        ▦
      </Tool>
      <Tool label={tr("Horizontal rule")} onClick={() => chain().setHorizontalRule().run()}>
        —
      </Tool>

      <Tool
        label={tr("Insert an image")}
        onClick={() => {
          // https only, and the serializer enforces it again: `safeSrc` accepts
          // an https URL or a `cid:` part and nothing else. An http image is
          // stripped by most mail clients as mixed content anyway, so accepting
          // one here would only move the disappointment to the recipient.
          const url = window.prompt(tr("Image address (https://…):"));
          if (!url) return;
          const alt = window.prompt(tr("Describe the image — recipients who block images see this instead:")) || "";
          chain().setImage({ src: url, alt }).run();
        }}
      >
        ▣
      </Tool>

      <Divider />

      {/* Alignment. TextAlign has been in the extension set and rendered by
          `compose.js` (`align()`) since PR-1B; there was simply no control, so
          a centred heading was reachable only by pasting one in. */}
      {([
        { v: "left", glyph: "⯇", label: "Align left" },
        { v: "center", glyph: "≡", label: "Centre" },
        { v: "right", glyph: "⯈", label: "Align right" },
      ] as const).map((a) => (
        <Tool
          key={a.v}
          label={tr(a.label)}
          active={editor.isActive({ textAlign: a.v })}
          onClick={() => (editor.isActive({ textAlign: a.v })
            ? chain().unsetTextAlign().run()
            : chain().setTextAlign(a.v).run())}
        >
          {a.glyph}
        </Tool>
      ))}

      <Divider />

      {/* Text colour and highlight — both marks the serializer emits as inline
          hex (`textStyle`, `highlight`), both loaded in `use-editor.ts`, and
          neither previously reachable from this bar. */}
      <ColourMenu
        id="composer-colour"
        label={tr("Text colour")}
        options={TEXT_COLOURS}
        value={String(editor.getAttributes("textStyle").color || "")}
        onPick={(v) => (v ? chain().setColor(v).run() : chain().unsetColor().run())}
      />
      <ColourMenu
        id="composer-highlight"
        label={tr("Highlight")}
        options={HIGHLIGHTS}
        value={String(editor.getAttributes("highlight").color || "")}
        onPick={(v) => (v ? chain().setHighlight({ color: v }).run() : chain().unsetHighlight().run())}
      />

      <Divider />

      <label className="sr-only" htmlFor="composer-font">{tr("Font")}</label>
      <Select
        id="composer-font"
        className="h-7 w-auto text-xs"
        value={String(editor.getAttributes("textStyle").fontFamily || "")}
        onChange={(e) => (e.target.value
          ? chain().setFontFamily(e.target.value).run()
          : chain().unsetFontFamily().run())}
        // The note lives on the control so it is read out with it, rather than
        // as a caption a screen-reader user meets with no context.
        title={tr("Only fonts that render on every mail client are offered. A font the recipient does not have is substituted silently.")}
      >
        <option value="">{tr("Default font")}</option>
        {FONTS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
      </Select>

      <Tool label={tr("Clear formatting")} onClick={() => chain().unsetAllMarks().clearNodes().run()}>
        ⌫
      </Tool>

      <span className="ml-auto flex items-center gap-1">{slotRight}</span>
    </div>
  );
}

/** Shown under the editor: what the recipient will and will not see. */
export function FontNote() {
  return (
    <p className="px-3 pb-1 text-[0.6875rem] text-muted-foreground">
      {tr("Only fonts that render everywhere are offered — a font the recipient does not have is substituted without warning.")}
    </p>
  );
}
