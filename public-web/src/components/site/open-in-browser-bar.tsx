import * as React from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { browserUrlFor, isInInstalledWindow } from "@/lib/installed-window";

/**
 * A slim bar offering to reopen the page in the browser, shown only when this
 * app is displayed inside an installed window — which, for an app with no
 * manifest of its own, means the staff PWA captured a link meant for a client
 * (see lib/installed-window.ts). Invisible in a normal browser tab.
 *
 * An offer, not a redirect: an automatic hand-off cannot tell whether it
 * worked, and on a phone without Chrome its fallback would load the page in
 * this same window again. The page underneath stays fully usable either way.
 */
export function OpenInBrowserBar() {
  const { t } = useTranslation();
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
      aria-label={t("common.openInBrowser.label")}
      data-testid="open-in-browser-bar"
      className="sticky top-0 z-50 flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted px-4 py-2 text-sm text-foreground"
    >
      <span>{t("common.openInBrowser.message")}</span>
      <span className="flex items-center gap-1">
        <Button size="sm" onClick={open}>
          {t("common.openInBrowser.action")}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setShow(false)} aria-label={t("common.close")}>
          ×
        </Button>
      </span>
    </div>
  );
}
