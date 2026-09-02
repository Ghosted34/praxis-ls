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
import { Modal, Field } from "@/components/ui/modal";
import { Input } from "@/components/ui/input";
import { useDeepLinkEdit, useFieldHighlight } from "@/lib/use-url-tab";
import { useToast } from "@/components/ui/toast";
import { tr } from "@/lib/i18n";
import * as api from "@/lib/mail-api";
import { errMsg, useResource } from "@/lib/use-resource";
import { reportActionError } from "@/lib/action-error";

/**
 * THE MOTTO / SLOGAN EDITOR.
 *
 * WHY IT HAD TO EXIST BEFORE THE DEEP LINK COULD. The card renders a motto — the
 * script-face line across the bottom — and the signature already reported a
 * missing one as a gap pointing at this tab. There was nothing here to type it
 * into: the field existed in the seed data, in the renderer and in the gap
 * list, and in no screen. So the link was honest about the destination and the
 * destination could not help, which is the failure this whole change is about.
 *
 * PER LANGUAGE, because the card is bilingual and a French motto is not a
 * translation the product may invent. Blank clears it — "no motto" is a value.
 */
function MottoModal({
  template,
  onClose,
  onSaved,
}: {
  template: api.SignatureTemplate;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [en, setEn] = React.useState("");
  const [fr, setFr] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [loaded, setLoaded] = React.useState(false);

  React.useEffect(() => {
    let live = true;
    api
      .getSignatureMotto(template.signature_template_id)
      .then((m) => {
        if (!live) return;
        setEn(m.en);
        setFr(m.fr);
        setLoaded(true);
      })
      .catch((e) => live && setError(errMsg(e)));
    return () => {
      live = false;
    };
  }, [template.signature_template_id]);

  // Runs once the inputs are actually in the document, so `?field=motto`
  // focuses the English box rather than finding nothing.
  useFieldHighlight([loaded]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.saveSignatureMotto(template.signature_template_id, { en, fr });
      toast.success(tr("Motto saved"));
      onSaved();
      onClose();
    } catch (err) {
      reportActionError(err);
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={tr("Motto")}
      description={tr(
        "The line in the script face across the bottom of the card. Leave a language blank to show no motto there.",
      )}
    >
      <form className="space-y-4" onSubmit={save}>
        {error && <Callout tone="bad" title={tr("Could not save")}>{error}</Callout>}
        <Field label={tr("English")} data-field="motto">
          <Input
            value={en}
            onChange={(e) => setEn(e.target.value)}
            maxLength={120}
            placeholder="Moving cargo. Moving Africa."
          />
        </Field>
        <Field label={tr("French")} data-field="motto_fr">
          <Input
            value={fr}
            onChange={(e) => setFr(e.target.value)}
            maxLength={120}
            placeholder="Faire bouger le fret. Faire bouger l'Afrique."
          />
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            {tr("Cancel")}
          </Button>
          <Button type="submit" loading={busy} disabled={busy}>
            {tr("Save motto")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function TemplatesTab() {
  const toast = useToast();
  const [confirm, confirmDialog] = useConfirm();
  const [busy, setBusy] = React.useState(false);
  const { data, error, reload } = useResource(() => api.listSignatureTemplates(), []);
  const templates = React.useMemo(() => (Array.isArray(data) ? data : []), [data]);

  // `?edit=motto&row=<templateId>` — where a "no motto" signature gap lands.
  const [motto, setMotto] = React.useState<api.SignatureTemplate | null>(null);
  const deepEdit = useDeepLinkEdit("motto");
  React.useEffect(() => {
    if (!deepEdit.open || !templates.length) return;
    const found = templates.find(
      (t) => t.signature_template_id === deepEdit.row,
    );
    if (!found) return;
    setMotto(found);
    deepEdit.clear();
  }, [deepEdit, templates]);

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
              <Button
                size="sm"
                variant="outline"
                onClick={() => setMotto(tpl)}
              >
                {tr("Motto")}
              </Button>
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
      {motto && (
        <MottoModal
          template={motto}
          onClose={() => setMotto(null)}
          onSaved={reload}
        />
      )}
      {confirmDialog}
    </div>
  );
}

export default TemplatesTab;
