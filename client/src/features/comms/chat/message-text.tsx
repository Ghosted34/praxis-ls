import type { JSONContent } from "@tiptap/react";
import { Link } from "react-router-dom";
import { linkDetect } from "@praxis/shared";
import { tr } from "@/lib/i18n";
import { parseMessage } from "./message-format";

/**
 * The words of a message, with the links in them made real.
 *
 * ── WHY THE TOKENIZER IS THE SHARED ONE ────────────────────────────────────
 *
 * `linkDetect.extractLinks` is the same function the server runs to decide which
 * URLs to fetch a preview for. If the client had its own copy — a different regex,
 * a different rule about `www.` — the two would disagree, and every direction that
 * disagreement can go is visible: a link the server previewed and the bubble shows
 * as text, or a link the bubble underlines and no card was ever made for. Two
 * copies of a route table is how `entity-route.js` got written; this is the same
 * lesson one feature later.
 *
 * ── AN EXTERNAL LINK SHOWS ITS ADDRESS. AN INTERNAL ONE DOES NOT. ───────────
 *
 * `https://maersk.com/vessel/…` renders as the text the sender typed, underlined,
 * so the reader can see whose site they are about to leave for before they leave
 * for it. Truncating or prettifying a third-party URL is how a chat app turns
 * `https://maersk.com.example/` into something that reads like the real thing.
 *
 * `/workspace/tasks?task=4f873a78-9790-…` renders as a chip that says "Task". The
 * address is hidden because it carries no information a person can use — the UUID
 * is not a destination, it is the reason the last three lines of an automated
 * blockage notice were unreadable — and because hiding it is safe here in a way it
 * is never safe out there: the route came from `entity-route`, the click is a
 * `navigate()` inside this SPA, and where it lands is a fact about our own router
 * rather than a promise about a stranger's.
 *
 * ── NOTHING HERE CREATES MARKUP ────────────────────────────────────────────
 *
 * Text stays text and becomes React children. The one `<a>` in this file gets an
 * `href` from `linkDetect`, which only ever returns `http(s)://` or `mailto:` —
 * `javascript:`, `data:` and `file:` are refused at the tokenizer, so there is no
 * path from a message body to a `href` that executes. No `dangerouslySetInnerHTML`
 * appears in this feature, and adding one would need a very good day.
 */

type DetectedLink = ReturnType<typeof linkDetect.extractLinks>[number];

/** The bubble's own ground shows through, so a link is not allowed to be a colour
 *  the tenant's theme happens not to contrast with: on the primary bubble the
 *  underline carries it, on a surface bubble the token does. Same problem
 *  `attachments.tsx` solves with `tone`. */
function linkClass(mine: boolean) {
  return mine
    ? "underline decoration-primary-foreground/50 underline-offset-2 hover:decoration-primary-foreground"
    : "text-primary-ink underline decoration-primary/40 underline-offset-2 hover:decoration-primary";
}

function ExternalLink({ link, mine }: { link: DetectedLink; mine: boolean }) {
  return (
    <a
      href={link.href}
      // `noreferrer` for a link out of a work product is not paranoia: without it
      // the destination learns which tenant's chat sent the reader, which is
      // information the sender never agreed to hand over by pasting a link.
      rel="noreferrer noopener nofollow ugc"
      target="_blank"
      // A tap inside a bubble must not also reveal the message's action rail, so
      // the bubble's own tap handler ignores events that started on a control
      // (see `message-bubble.tsx`). Stopping propagation here is what makes the
      // link do exactly one thing.
      onClick={(e) => e.stopPropagation()}
      className={`break-all [overflow-wrap:anywhere] ${linkClass(mine)}`}
    >
      {link.raw}
    </a>
  );
}

function MailLink({ link, mine }: { link: DetectedLink; mine: boolean }) {
  return (
    <a
      href={link.href}
      onClick={(e) => e.stopPropagation()}
      className={linkClass(mine)}
    >
      {link.raw}
    </a>
  );
}

/** An in-app destination, as a chip. `label` is English surface copy from
 *  `linkDetect.APP_LABEL` and goes through `tr()` here, at the only place in the
 *  product that shows it. */
function AppLink({ link, mine }: { link: DetectedLink; mine: boolean }) {
  const label = link.label ? tr(link.label) : null;
  return (
    <Link
      to={link.href}
      onClick={(e) => e.stopPropagation()}
      className={
        mine
          ? "my-0.5 inline-flex max-w-full items-center gap-1.5 rounded-md border border-primary-foreground/30 bg-primary-foreground/10 px-1.5 py-0.5 align-middle text-[12px] font-medium text-primary-foreground no-underline transition-colors hover:bg-primary-foreground/20"
          : "my-0.5 inline-flex max-w-full items-center gap-1.5 rounded-md border border-primary/30 bg-primary/10 px-1.5 py-0.5 align-middle text-[12px] font-medium text-primary-ink no-underline transition-colors hover:bg-primary/20"
      }
      title={link.raw}
    >
      <span aria-hidden className="text-[13px] leading-none">
        ↗
      </span>
      {label ? (
        <span className="truncate">{label}</span>
      ) : (
        <span className="truncate break-all">{link.raw}</span>
      )}
      {!label && <span className="sr-only">{tr("Open in Praxis")}</span>}
    </Link>
  );
}

/** One text node, with its links turned into elements. */
function renderText(text: string, mine: boolean): React.ReactNode {
  const found = linkDetect.extractLinks(text);
  if (!found.length) return text;
  const out: React.ReactNode[] = [];
  let cursor = 0;
  found.forEach((link, i) => {
    if (link.start > cursor) out.push(text.slice(cursor, link.start));
    const key = `${link.start}-${i}`;
    if (link.kind === "app") out.push(<AppLink key={key} link={link} mine={mine} />);
    else if (link.kind === "mail") out.push(<MailLink key={key} link={link} mine={mine} />);
    else out.push(<ExternalLink key={key} link={link} mine={mine} />);
    cursor = link.end;
  });
  if (cursor < text.length) out.push(text.slice(cursor));
  return out;
}

export function MessageText({ body, mine = false }: { body: string; mine?: boolean }) {
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
          {node.content?.map((child, ci) =>
            child.type === "text" ? (
              <span key={ci}>{renderText(child.text || "", mine)}</span>
            ) : (
              render(child, ci)
            ),
          )}
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
