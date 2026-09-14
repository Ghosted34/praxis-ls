import * as React from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { tr } from "@/lib/i18n";
import { parseMessage, serializeMessage } from "./message-format";

export function MessageEditor({
  reset,
  onChange,
  onSend,
  onEditLast,
  onCancel,
  disabled,
  editorRef,
}: {
  /** New object only for external replacements (draft load, edit, successful send). */
  reset: { body: string };
  onChange: (text: string) => void;
  onSend: () => void;
  onEditLast?: () => void;
  onCancel?: () => void;
  disabled?: boolean;
  editorRef: React.MutableRefObject<Editor | null>;
}) {
  const callbacks = React.useRef({ onChange, onSend, onEditLast, onCancel });
  callbacks.current = { onChange, onSend, onEditLast, onCancel };
  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({
          heading: false,
          blockquote: false,
          codeBlock: false,
          horizontalRule: false,
          bold: false,
          italic: false,
          strike: false,
          code: false,
        }),
        Placeholder.configure({ placeholder: tr("Write a message…") }),
      ],
      content: parseMessage(reset.body),
      onUpdate: ({ editor: current }) =>
        callbacks.current.onChange(serializeMessage(current.getJSON())),
      editorProps: {
        attributes: {
          role: "textbox",
          "aria-multiline": "true",
          "aria-label": tr("Write a message"),
          class:
            "min-h-10 max-h-32 overflow-y-auto px-3 py-2 text-sm focus:outline-none [&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-5 [&_ol]:pl-5 [&_p.is-editor-empty:first-child]:before:content-[attr(data-placeholder)] [&_p.is-editor-empty:first-child]:before:text-muted-foreground [&_p.is-editor-empty:first-child]:before:float-left [&_p.is-editor-empty:first-child]:before:pointer-events-none",
        },
        handleKeyDown: (view, event) => {
          if (event.isComposing || view.composing || event.keyCode === 229)
            return false;
          if (event.key === "Enter") {
            event.preventDefault();
            if (!event.shiftKey) callbacks.current.onSend();
            else {
              const current = editorRef.current;
              if (current?.isActive("listItem")) {
                if (!current.commands.splitListItem("listItem"))
                  current.commands.liftListItem("listItem");
              } else current?.commands.splitBlock();
            }
            return true;
          }
          if (
            event.key === "ArrowUp" &&
            !view.state.doc.textContent.trim() &&
            callbacks.current.onEditLast
          ) {
            event.preventDefault();
            callbacks.current.onEditLast();
            return true;
          }
          if (event.key === "Escape" && callbacks.current.onCancel) {
            callbacks.current.onCancel();
            return true;
          }
          return false;
        },
      },
    },
    [],
  );
  React.useEffect(() => {
    editorRef.current = editor;
    return () => {
      editorRef.current = null;
    };
  }, [editor, editorRef]);
  React.useEffect(() => {
    if (editor && serializeMessage(editor.getJSON()) !== reset.body)
      editor.commands.setContent(parseMessage(reset.body), false);
  }, [editor, reset]);
  React.useEffect(() => {
    editor?.setEditable(!disabled);
  }, [editor, disabled]);
  return (
    <EditorContent
      editor={editor}
      className="min-w-0 flex-1 rounded-2xl border border-input bg-background focus-within:ring-2 focus-within:ring-ring"
    />
  );
}
