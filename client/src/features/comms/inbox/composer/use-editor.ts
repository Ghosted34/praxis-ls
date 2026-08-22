/**
 * The TipTap editor instance, and the extension set the serializer knows how to
 * render.
 *
 * ── THE EXTENSION LIST IS A CONTRACT WITH compose.js ────────────────────────
 *
 * Every node and mark enabled here has a case in the server's serializer. Adding
 * one without adding the matching case does not throw — the serializer passes an
 * unknown node's children through — it silently drops the formatting, which
 * looks exactly like the editor being buggy. So the two lists move together, and
 * `editor.test.tsx` asserts they still match.
 *
 * ── FONTS: WEB-SAFE STACKS ONLY, AND THE UI SAYS SO ─────────────────────────
 *
 * The menu offers eight families because those are the eight that render at the
 * recipient. Offering Montserrat would look richer and produce Times New Roman
 * in Outlook, with nobody able to explain why — the codebase learned this from
 * @font-face being stripped (see notification.service.js).
 *
 * ── THIS IS THE PREVIEW, NOT THE OUTPUT ─────────────────────────────────────
 *
 * What the user sees here is TipTap's own rendering with the app's stylesheet.
 * What is SENT is the server's serialization of the same document. They are
 * deliberately not the same code: a client-side serializer drifts, and if it
 * were authoritative a bug in it would produce mail nobody reviewed.
 */
import * as React from "react";
import { useEditor, type Editor, type JSONContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";
import CharacterCount from "@tiptap/extension-character-count";
import TextStyle from "@tiptap/extension-text-style";
import Color from "@tiptap/extension-color";
import Highlight from "@tiptap/extension-highlight";
import FontFamily from "@tiptap/extension-font-family";
import TextAlign from "@tiptap/extension-text-align";
import Table from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import { ErpBlock } from "./erp-block";
import { tr } from "@/lib/i18n";

export function useComposerEditor({
  initial,
  placeholder,
  onChange,
  editable = true,
}: {
  initial?: JSONContent | null;
  placeholder?: string;
  onChange?: (doc: JSONContent) => void;
  editable?: boolean;
}): Editor | null {
  const changeRef = React.useRef(onChange);
  changeRef.current = onChange;

  return useEditor(
    {
      editable,
      extensions: [
        StarterKit.configure({
          // The editor's own history is fine; the heading levels are capped at
          // what the serializer styles.
          heading: { levels: [1, 2, 3, 4, 5, 6] },
        }),
        Underline,
        Link.configure({
          openOnClick: false,        // clicking a link mid-compose should place the caret
          autolink: true,
          protocols: ["http", "https", "mailto", "tel"],
          HTMLAttributes: { rel: "noopener noreferrer", target: "_blank" },
        }),
        Image.configure({ inline: false, allowBase64: false }),
        Placeholder.configure({ placeholder: placeholder || tr("Write your message…") }),
        CharacterCount,
        TextStyle,
        Color,
        Highlight.configure({ multicolor: true }),
        FontFamily,
        TextAlign.configure({ types: ["heading", "paragraph"] }),
        Table.configure({ resizable: false }),  // a resized column means nothing in email
        TableRow,
        TableHeader,
        TableCell,
        ErpBlock,
      ],
      content: initial || undefined,
      onUpdate: ({ editor }) => changeRef.current?.(editor.getJSON()),
      editorProps: {
        attributes: {
          class: "prose prose-sm max-w-none min-h-[12rem] px-3 py-2 focus:outline-none",
          // Announced as what it is. A contenteditable div with no role is a
          // black hole to a screen reader.
          role: "textbox",
          "aria-multiline": "true",
          "aria-label": tr("Message body"),
        },
      },
    },
    // Remount only when the draft being edited changes. Rebuilding the editor on
    // every keystroke would lose the caret, which is the classic controlled-
    // editor mistake.
    [],
  );
}

export type { Editor, JSONContent };
