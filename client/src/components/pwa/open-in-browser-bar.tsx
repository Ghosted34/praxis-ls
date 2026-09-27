import * as React from "react";
import { Button } from "@/components/ui/button";
import { tr } from "@/lib/i18n";
import { browserUrlFor, isInInstalledWindow } from "@/lib/installed-window";

/**
 * Offers to reopen an outsider page (signing, verification, secure link) in the
 * browser when it is showing inside the installed staff app — see
 * lib/installed-window.ts. Rendered by PwaLayer only on those routes, and
 * renders nothing in an ordinary browser tab.
 *
 * An offer rather than an automatic hand-off: a redirect cannot tell whether it
 * worked, and on a phone without Chrome its fallback would reload the page in
 * this same window. The page underneath stays usable either way.
 */
export function OpenInBrowserBar() {
  const [show, setShow] = React.useState(false);
  React.useEffect(() => setShow(isInInstalledWindow()), []);
  if (!show) return null;

  const open = () => {
    const href = browserUrlFor(window.location.href, navigator.userAgent);
    if (href.startsWith("intent:")) window.location.href = href;
    else window.open(href, "_blank", "noopener");
  };

  return (
    <div
      role="region"
      aria-label={tr("Open in your browser")}
      data-testid="open-in-browser-bar"
      className="sticky top-0 z-50 flex flex-wrap items-center justify-between gap-2 border-b bg-popover px-4 py-2 text-sm text-foreground"
    >
      <span>{tr("This page opened inside an installed app. It works here, but it belongs in your browser.")}</span>
      <span className="flex items-center gap-1">
        <Button size="sm" onClick={open}>
          {tr("Open in browser")}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setShow(false)} aria-label={tr("Close")}>
          ×
        </Button>
      </span>
    </div>
  );
}
