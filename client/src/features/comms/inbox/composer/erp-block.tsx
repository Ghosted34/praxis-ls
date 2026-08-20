/**
 * `erpBlock` — the node a slash command inserts.
 *
 * ── IT HOLDS NODES, NOT AN HTML STRING, AND THAT IS THE SECURITY BOUNDARY ───
 *
 * `content: "block+"` — the block's rows are ordinary paragraphs and tables,
 * rendered by the same escaped path as everything the user typed. The obvious
 * alternative, an `html` attribute the serializer emits verbatim, is an HTML
 * injection straight through: a TipTap document arrives in a request body, so
 * anyone who can POST a draft could put anything in that string and have it sent
 * as the company. See the header of `src/modules/mail/mail/compose.js`.
 *
 * ── AND IT IS NOT EDITABLE ──────────────────────────────────────────────────
 *
 * `atom: false` with the content non-editable: the figures are pinned at insert
 * time and are a statement of what the system holds. Letting someone hand-edit
 * an invoice total inside a block that looks system-generated is how a customer
 * receives a number nobody in the company can account for. Delete it and insert
 * it again if it is wrong.
 */
import { Node, mergeAttributes } from "@tiptap/core";
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer } from "@tiptap/react";

function BlockView({ node }: { node: { attrs: Record<string, unknown> } }) {
  const label = node.attrs.label as string | null;
  return (
    <NodeViewWrapper
      className="my-3 rounded-lg border border-border bg-muted/40 px-3 py-2"
      data-erp-block={String(node.attrs.command || "")}
    >
      {label && (
        <p
          className="mb-1 text-[0.6875rem] font-semibold uppercase tracking-wide text-muted-foreground"
          contentEditable={false}
        >
          {label}
        </p>
      )}
      {/* contentEditable={false} on the content: pinned figures are a statement
          of what the system holds, not a draft to be adjusted. */}
      <NodeViewContent className="text-sm" contentEditable={false} />
    </NodeViewWrapper>
  );
}

export const ErpBlock = Node.create({
  name: "erpBlock",
  group: "block",
  content: "block+",
  defining: true,
  isolating: true,
  selectable: true,

  addAttributes() {
    return {
      command: { default: null },
      label: { default: null },
      // When the figures were true. Kept on the node so a draft reopened in a
      // week still says what it is showing.
      pinned_at: { default: null },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-erp-block]" }];
  },

  renderHTML({ HTMLAttributes }) {
    // Only ever used for the editor's own clipboard/DOM. The server serializes
    // the JSON; this is never what gets sent.
    return ["div", mergeAttributes(HTMLAttributes, { "data-erp-block": "" }), 0];
  },

  addNodeView() {
    return ReactNodeViewRenderer(BlockView);
  },
});
