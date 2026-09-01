/**
 * Signatures → Templates. Which layout each part of the company gets.
 *
 * READ-MOSTLY, DELIBERATELY. What an admin can do here is choose the tenant-wide
 * default and turn a template off. What they cannot do is retype the card's
 * colours, because the card takes them from Appearance — one brand, set once,
 * used by the app, the documents and the signature alike. A colour picker here
 * would be a second place to set the brand and a first place for the two to
 * disagree.
 *
 * The link to Appearance is the whole answer to "how do I change the blue?",
 * so it is on the screen rather than in a document nobody opens.
 */
import * as React from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/pill";
import { Callout } from "@/components/ui/callout";
import { ErrorState, EmptyState } from "@/components/ui/states";
import { SkeletonTable } from "@/components/ui/skeleton";
import { useConfirm } from "@/components/ui/use-confirm";
import { useToast } from "@/components/ui/toast";
import { tr } from "@/lib/i18n";
import * as api from "@/lib/mail-api";
import { errMsg, useResource } from "@/lib/use-resource";
import { reportActionError } from "@/lib/action-error";

export function TemplatesTab() {
  const toast = useToast();
  const [confirm, confirmDialog] = useConfirm();
  const [busy, setBusy] = React.useState(false);
  const { data, error, reload } = useResource(() => api.listSignatureTemplates(), []);
  const templates = Array.isArray(data) ? data : [];

  async function makeDefault(tpl: api.SignatureTemplate) {
    const ok = await confirm({
      title: tr("Make this the company default?"),
      body: tr(
        "New signatures across the company will use “{name}”. Anyone on a department template keeps theirs.",
      ).replace("{name}", tpl.name),
      confirmLabel: tr("Make default"),
    });
    if (!ok) return;
    setBusy(true);
    try {
      await api.updateSignatureTemplate(tpl.signature_template_id, { is_default: true });
      toast.success(tr("Default updated"));
      reload();
    } catch (err) {
      reportActionError(err);
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  if (error) return <ErrorState message={error} />;
  if (data === null) return <SkeletonTable />;

  return (
    <div className="space-y-4">
      <Callout tone="info" title={tr("Colours come from your brand")}>
        {tr(
          "The card uses your brand colours and logo. Change them once in Appearance and every signature follows.",
        )}{" "}
        <Link className="underline" to="/settings/appearance">
          {tr("Open Appearance")}
        </Link>
      </Callout>

      {templates.length === 0 ? (
        <EmptyState title={tr("No templates")} hint={tr("Nothing is configured yet.")} />
      ) : (
        <ul className="space-y-2">
          {templates.map((tpl) => (
            <li key={tpl.signature_template_id} className="lux-card flex flex-wrap items-center gap-3 p-4">
              <div className="min-w-[200px] flex-1">
                <p className="text-sm font-medium">
                  {tpl.name}
                  {tpl.is_system && <Pill tone="mute" className="ml-2">{tr("built in")}</Pill>}
                  {tpl.is_default && <Pill tone="blue" className="ml-2">{tr("default")}</Pill>}
                </p>
                {tpl.description && (
                  <p className="mt-1 text-xs text-muted-foreground">{tpl.description}</p>
                )}
              </div>
              <span className="text-xs text-muted-foreground">
                {tpl.scope_kind}
                {tpl.scope_value ? ` · ${tpl.scope_value}` : ""}
              </span>
              {!tpl.is_default && tpl.scope_kind === "TENANT" && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => makeDefault(tpl)}
                >
                  {tr("Make default")}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {confirmDialog}
    </div>
  );
}

export default TemplatesTab;
