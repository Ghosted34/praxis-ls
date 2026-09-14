/** Safe, deliberately small Markdown dialect: paragraphs and nested lists.
 * Text stays text (never HTML), so drafts, search, notifications and exports
 * keep working with older clients. The editor and bubbles share this codec. */
import type { JSONContent } from "@tiptap/react";

export function parseMessage(body: string): JSONContent {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  const paragraph = (text: string): JSONContent => ({
    type: "paragraph",
    content: text ? [{ type: "text", text }] : [],
  });
  const content: JSONContent[] = [];
  const stack: { indent: number; list: JSONContent }[] = [];
  for (const line of lines) {
    const match = /^(\s*)([-*]|\d+\.)\s+(.*)$/.exec(line);
    if (!match) {
      stack.length = 0;
      content.push(paragraph(line));
      continue;
    }
    const indent = match[1].length;
    const type = /\d/.test(match[2]) ? "orderedList" : "bulletList";
    while (
      stack.length &&
      (stack.at(-1)!.indent > indent ||
        (stack.at(-1)!.indent === indent && stack.at(-1)!.list.type !== type))
    )
      stack.pop();
    let list = stack.at(-1)?.indent === indent ? stack.at(-1)!.list : undefined;
    if (!list) {
      list = {
        type,
        ...(type === "orderedList"
          ? { attrs: { start: parseInt(match[2], 10) } }
          : {}),
        content: [],
      };
      const parent = stack.at(-1)?.list.content?.at(-1);
      (parent?.content || content).push(list);
      stack.push({ indent, list });
    }
    list.content!.push({ type: "listItem", content: [paragraph(match[3])] });
  }
  return { type: "doc", content: content.length ? content : [paragraph("")] };
}

export function serializeMessage(doc: JSONContent): string {
  const text = (node: JSONContent): string =>
    node.type === "hardBreak"
      ? "\n"
      : node.text || (node.content || []).map(text).join("");
  const blocks = (nodes: JSONContent[], indent = ""): string[] =>
    nodes.flatMap((node) => {
      if (node.type === "bulletList" || node.type === "orderedList") {
        return (node.content || []).flatMap((item, index) => {
          const prefix =
            node.type === "orderedList"
              ? `${Number(node.attrs?.start || 1) + index}. `
              : "- ";
          return [
            `${indent}${prefix}${text(item.content?.[0] || {})}`,
            ...blocks((item.content || []).slice(1), indent + "  "),
          ];
        });
      }
      return [indent + text(node)];
    });
  return blocks(doc.content || []).join("\n");
}
