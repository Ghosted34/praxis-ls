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
      aria-label="Formatting"
      aria-controls="composer-body"
      className="flex flex-wrap items-center gap-0.5 border-b border-border px-2 py-1"
    >
      <Tool label="Bold" active={editor.isActive("bold")} onClick={() => chain().toggleBold().run()}>
        <strong>B</strong>
      </Tool>
      <Tool label="Italic" active={editor.isActive("italic")} onClick={() => chain().toggleItalic().run()}>
        <em>I</em>
      </Tool>
      <Tool label="Underline" active={editor.isActive("underline")} onClick={() => chain().toggleUnderline().run()}>
        <span className="underline">U</span>
      </Tool>
      <Tool label="Strikethrough" active={editor.isActive("strike")} onClick={() => chain().toggleStrike().run()}>
        <span className="line-through">S</span>
      </Tool>

      <Divider />

      <Tool label="Heading" active={editor.isActive("heading", { level: 2 })} onClick={() => chain().toggleHeading({ level: 2 }).run()}>
        H
      </Tool>
      <Tool label="Bulleted list" active={editor.isActive("bulletList")} onClick={() => chain().toggleBulletList().run()}>
        •
      </Tool>
      <Tool label="Numbered list" active={editor.isActive("orderedList")} onClick={() => chain().toggleOrderedList().run()}>
        1.
      </Tool>
      <Tool label="Quote" active={editor.isActive("blockquote")} onClick={() => chain().toggleBlockquote().run()}>
        ❝
      </Tool>
      <Tool label="Code" active={editor.isActive("code")} onClick={() => chain().toggleCode().run()}>
        {"</>"}
      </Tool>

      <Divider />

      <Tool
        label="Link"
        active={editor.isActive("link")}
        onClick={() => {
          if (editor.isActive("link")) { chain().unsetLink().run(); return; }
          // window.prompt rather than a modal: the caret and the selection have
          // to survive, and every dialog in this app moves focus. Replaced with
          // an inline popover when one exists that does not steal focus.
          const url = window.prompt("Link to:");
          if (url) chain().setLink({ href: url }).run();
        }}
      >
        🔗
      </Tool>
      <Tool label="Insert table" onClick={() => chain().insertTable({ rows: 2, cols: 2, withHeaderRow: true }).run()}>
        ▦
      </Tool>
      <Tool label="Horizontal rule" onClick={() => chain().setHorizontalRule().run()}>
        —
      </Tool>

      <Divider />

      <label className="sr-only" htmlFor="composer-font">Font</label>
      <Select
        id="composer-font"
        className="h-7 w-auto text-xs"
        value={String(editor.getAttributes("textStyle").fontFamily || "")}
        onChange={(e) => (e.target.value
          ? chain().setFontFamily(e.target.value).run()
          : chain().unsetFontFamily().run())}
        // The note lives on the control so it is read out with it, rather than
        // as a caption a screen-reader user meets with no context.
        title="Only fonts that render on every mail client are offered. A font the recipient does not have is substituted silently."
      >
        <option value="">Default font</option>
        {FONTS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
      </Select>

      <Tool label="Clear formatting" onClick={() => chain().unsetAllMarks().clearNodes().run()}>
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
      Only fonts that render everywhere are offered — a font the recipient does not
      have is substituted without warning.
    </p>
  );
}
