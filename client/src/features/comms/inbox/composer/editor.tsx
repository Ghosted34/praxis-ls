/**
 * The editor's rendered surface.
 *
 * Split from the hook that builds it — a module that exports both a hook and a
 * component loses fast refresh, so editing the surface would remount the editor
 * and lose the caret on every save. `use-editor.ts` holds the extension set and
 * the reasoning behind it.
 */
import { EditorContent } from "@tiptap/react";
import type { Editor } from "@tiptap/react";

export function EditorSurface({ editor }: { editor: Editor | null }) {
  return (
    <div className="min-h-[12rem] rounded-lg border border-border bg-background">
      <EditorContent editor={editor} />
    </div>
  );
}
