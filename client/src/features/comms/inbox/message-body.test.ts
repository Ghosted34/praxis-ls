/**
 * The two reading-pane rules from §5.6.3, tested where they are decidable.
 *
 * Both are pure string transforms on already-sanitized markup, so they are
 * testable without a renderer — which is the reason they live in their own
 * module rather than inside the component that draws them.
 */
import { describe, expect, it } from "vitest";
import {
  blockRemoteContent,
  restoreRemoteContent,
  splitQuotedHtml,
  splitQuotedText,
} from "./message-body";

describe("remote content", () => {
  it("holds back an http(s) image and keeps the address for later", () => {
    const out = blockRemoteContent('<p>hi</p><img src="https://track.example/p.gif" alt="">');
    expect(out.blocked).toBe(1);
    // The leading space matters: `data-blocked-src="…"` trivially contains the
    // substring `src="…"`, and asserting on the bare substring would pass for
    // a version of this that had done nothing.
    expect(out.html).not.toContain(' src="https://track.example/p.gif"');
    expect(out.html).toContain('data-blocked-src="https://track.example/p.gif"');
    expect(restoreRemoteContent(out.html)).toContain('src="https://track.example/p.gif"');
  });

  it("leaves cid: and data: alone — neither reaches a third party", () => {
    const html = '<img src="cid:logo@praxis"><img src=\'data:image/png;base64,AAA\'>';
    const out = blockRemoteContent(html);
    expect(out.blocked).toBe(0);
    expect(out.html).toBe(html);
  });

  it("catches the background image people forget", () => {
    const out = blockRemoteContent('<td style="background:url(https://x.example/bg.png)">a</td>');
    expect(out.blocked).toBe(1);
    expect(out.html).toContain("background:none");
  });

  it("catches srcset and poster too", () => {
    const out = blockRemoteContent(
      '<img srcset="https://a.example/1.png 1x"><video poster="https://a.example/p.jpg"></video>',
    );
    expect(out.blocked).toBe(2);
  });
});

describe("quoted history", () => {
  it("folds at the first blockquote", () => {
    const { visible, quoted } = splitQuotedHtml("<p>My answer.</p><blockquote><p>Yours</p></blockquote>");
    expect(visible).toBe("<p>My answer.</p>");
    expect(quoted).toContain("Yours");
  });

  it("does not fold a forward whose whole body is the quotation", () => {
    const html = "<blockquote><p>the forwarded thing</p></blockquote>";
    expect(splitQuotedHtml(html)).toEqual({ visible: html, quoted: null });
  });

  it("folds on the English attribution when there is no blockquote", () => {
    const html = "<div>Noted, thanks.</div><div>On 12 Feb 2026, Ada wrote:</div><div>original</div>";
    const { visible, quoted } = splitQuotedHtml(html);
    expect(visible).toContain("Noted, thanks.");
    expect(quoted).toContain("original");
  });

  it("folds on the French attribution, non-breaking space and all", () => {
    const text = "Bien reçu.\n\nLe 12 février 2026, Ada a écrit :\n> l'original";
    const { visible, quoted } = splitQuotedText(text);
    expect(visible).toBe("Bien reçu.");
    expect(quoted).toContain("l'original");
  });

  it("folds a trailing run of > lines", () => {
    const { visible, quoted } = splitQuotedText("Yes.\n\n> the question\n> continued");
    expect(visible).toBe("Yes.");
    expect(quoted).toContain("> the question");
  });

  it("leaves an interleaved reply alone", () => {
    // A `>` run that does NOT reach the end is somebody answering point by
    // point. Folding from the first `>` would hide half of what they wrote.
    const text = "> your first point\nAgreed.\n\n> your second\nNot this one.";
    expect(splitQuotedText(text).quoted).toBeNull();
  });

  it("leaves a message with no history alone", () => {
    expect(splitQuotedText("Just a note.").quoted).toBeNull();
    expect(splitQuotedHtml("<p>Just a note.</p>").quoted).toBeNull();
  });
});
