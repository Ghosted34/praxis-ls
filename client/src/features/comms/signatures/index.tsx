/**
 * Comms → Signatures. The signature workstation.
 *
 * WHY IT IS HERE AND NOT ONLY IN SETTINGS. A signature is part of how mail goes
 * out, and this is where mail lives. Settings → Email signatures still works and
 * still appears on the Settings hub — the route was not moved, because a
 * bookmark and a hub card that stop working are their own small betrayal — but
 * this is the surface with room for the preview, the batch and the templates
 * side by side.
 *
 * DESIGNER IS VISIBLE TO EVERYONE. It is the caller's own signature, the same
 * personal-preference rule that governs /mail/signature on the server. Batch and
 * Templates are MOD-70: generating other people's identity assets, and choosing
 * what the company's mail looks like, are brand governance.
 *
 * The admin tabs are hidden until the capability answer arrives rather than
 * shown and retracted — the pattern the Setup hub next door already uses, and
 * for the same reason: offering a tab and taking it away teaches people to
 * distrust the ones that work.
 */
import * as React from "react";
import { cn } from "@/lib/cn";
import { pageShell } from "@/lib/layout";
import { PageHeader } from "@/components/data-list";
import { tr } from "@/lib/i18n";
import * as api from "@/lib/mail-api";
import { useResource } from "@/lib/use-resource";
import { DesignerTab } from "./designer-tab";
import { BatchTab } from "./batch-tab";
import { TemplatesTab } from "./templates-tab";
import { DeliveryTab } from "./delivery-tab";

type TabKey = "designer" | "batch" | "templates" | "delivery";

const TABS: { key: TabKey; label: string; adminOnly: boolean; hint: string }[] = [
  {
    key: "designer",
    label: "My signature",
    adminOnly: false,
    hint: "Your own card, and the image to paste into Outlook or Gmail",
  },
  {
    key: "batch",
    label: "Batch",
    adminOnly: true,
    hint: "Generate signatures for several people at once",
  },
  {
    key: "templates",
    label: "Templates",
    adminOnly: true,
    hint: "Which layout each part of the company gets",
  },
  {
    key: "delivery",
    label: "Delivery check",
    adminOnly: true,
    hint: "Why the card image is missing from sent mail",
  },
];

export function SignaturesPage() {
  const caps = useResource(() => api.mailCapabilities(), []);
  const isAdmin = caps.data?.can_administer === true;
  const visible = TABS.filter((t) => !t.adminOnly || isAdmin);

  const [tab, setTab] = React.useState<TabKey>("designer");
  React.useEffect(() => {
    if (!visible.some((t) => t.key === tab)) setTab("designer");
  }, [visible, tab]);

  return (
    <section className={pageShell.wide}>
      <PageHeader
        title={tr("Email signatures")}
        description={tr(
          "Your signature card, exactly as it goes out. Name and job title come from HR; colours and logo from your brand.",
        )}
      />

      {visible.length > 1 && (
        <nav
          className="mb-4 flex flex-wrap items-end gap-1 border-b border-border"
          aria-label={tr("Signature sections")}
        >
          {visible.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              title={tr(t.hint)}
              aria-current={tab === t.key ? "page" : undefined}
              className={cn(
                "-mb-px border-b-2 px-3 pb-2 pt-1 text-sm font-medium transition-colors",
                tab === t.key
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:border-border hover:text-foreground",
              )}
            >
              {tr(t.label)}
            </button>
          ))}
        </nav>
      )}

      {tab === "designer" && <DesignerTab />}
      {tab === "batch" && isAdmin && <BatchTab />}
      {tab === "templates" && isAdmin && <TemplatesTab />}
      {tab === "delivery" && isAdmin && <DeliveryTab />}
    </section>
  );
}

export default SignaturesPage;
