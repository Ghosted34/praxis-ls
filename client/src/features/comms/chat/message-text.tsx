import type { JSONContent } from "@tiptap/react";
import { parseMessage } from "./message-format";

export function MessageText({ body }: { body: string }) {
  const render = (node: JSONContent, key: number): React.ReactNode => {
    const children = node.content?.map(render);
    if (node.type === "orderedList")
      return (
        <ol key={key} start={node.attrs?.start} className="list-decimal pl-5">
          {children}
        </ol>
      );
    if (node.type === "bulletList")
      return (
        <ul key={key} className="list-disc pl-5">
          {children}
        </ul>
      );
    if (node.type === "listItem") return <li key={key}>{children}</li>;
    if (node.type === "paragraph")
      return (
        <p key={key} className="min-h-[1em] whitespace-pre-wrap">
          {children}
        </p>
      );
    return node.text || null;
  };
  return (
    <div className="break-words [overflow-wrap:anywhere]">
      {parseMessage(body).content?.map(render)}
    </div>
  );
}
