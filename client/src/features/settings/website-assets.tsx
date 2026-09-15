/**
 * Settings › Website › the asset library — guide §6.3, carried out of PR 2, PR
 * 3 and PR 4 and built here because §9.3 and §9.4 are dead without it.
 *
 * ── IT IS A CONTROL, NOT A PAGE, AND THAT IS THE READING OF §6.3 ──────────
 *
 * §6.3 names this FILE. It does not name a screen, and a separate "assets"
 * screen would be the wrong shape: every image this product stores belongs to a
 * row somebody is already editing — this partner's mark, this person's
 * portrait, this entity's cover. A library page would mean uploading a file in
 * one place and then going somewhere else to say what it was of, which is how a
 * tenant ends up with four unattached logos and no idea which is current.
 *
 * So the control lives here, once, and the three screens that own rows mount it
 * inline. The reason that is worth stating is that it makes the §1.3 rule
 * unavoidable: there is one component, it always knows its slot, and a slot
 * always knows whether it is an evidence slot.
 *
 * ── THE CONSTRAINTS ARE SHOWN BEFORE THE FILE DIALOG OPENS ────────────────
 *
 * §6.3, in its own words: "A tenant who learns the constraint after a rejected
 * upload uploads something wrong twice." The aspect, the minimum width and the
 * byte cap are printed next to the control, and they are read from
 * `@praxis/shared`'s `SITE_MEDIA_SLOTS` — the same object the API validates
 * against — so the hint cannot promise something the server refuses.
 *
 * ── PROVENANCE IS REQUIRED, AND `generated` IS NOT OFFERED HERE ───────────
 *
 * §6.3 asks that the server refuse a generated asset for a restricted slot and
 * that "the UI disables those slots rather than failing after the fact". Every
 * slot in the register today IS restricted, so the honest version of that is
 * not a disabled option with a tooltip — it is an option that is absent, with
 * the rule written where the choice is made. The server refuses it anyway
 * (`site_settings.media.js`), and 13789 refuses it again at the row. Three
 * layers, the same shape the permission note already has.
 *
 * ── WHY THERE IS NO ALT-TEXT FIELD ────────────────────────────────────────
 *
 * §6.3 asks for a bilingual `alt` on every non-decorative asset. Every slot
 * here is a picture OF a thing the tenant has already named on the same form: a
 * portrait is of the leader whose name is in the field above it, a mark is of
 * the partner named beside it, a cover is of the entity. So the alt text is
 * that name, and the renderer composes the sentence around it from its own
 * dictionary in the visitor's language.
 *
 * A second copy of the name, typed twice, would be a copy that drifts the day
 * somebody corrects a spelling — and it would be the copy a screen-reader user
 * hears. Recorded as a deviation in the guide's §3.6.
 */
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/settings/controls";
import { tr } from "@/lib/i18n";
import { errMsg } from "@/lib/use-resource";
import * as api from "@/lib/site-settings-api";
import { FilePicker } from "@/components/ui/image-upload";
import { UploadProgress } from "@/components/ui/upload-progress";
import { useUpload } from "@/lib/use-upload";
import { fileToDataUrl } from "@/lib/image-compress";

/**
 * What each slot is called, in words a marketing administrator recognises.
 *
 * Separate from `SITE_MEDIA_SLOTS` because that object is the CONTRACT — the
 * numbers the API enforces — and this is copy. Putting a label in the shared
 * package would make the API's validation schema a place translations live.
 */
const SLOT_LABEL: Record<api.AssetSlot, () => string> = {
  "leader-portrait": () => tr("Portrait"),
  "partner-mark": () => tr("Logo"),
  "credential-mark": () => tr("Mark"),
  "entity-cover": () => tr("Cover image"),
};

/** The one sentence that explains why a slot refuses a generated image. Shown
 *  at the point of choice, not in a document. */
const EVIDENCE_NOTE = () =>
  tr(
    "This image sits beside a named person or company, so a visitor reads it as a photograph of your own operation. It must be one — generated imagery is not accepted here.",
  );

const kb = (bytes: number) => Math.round(bytes / 1024);

/** The constraint line, assembled from the shared register. */
function constraintHint(slot: api.AssetSlot): string {
  const spec = api.ASSET_SLOTS[slot];
  const parts = [
    tr("PNG, JPEG or WebP"),
    `${tr("at least")} ${spec.minWidth} px ${tr("wide")}`,
    `${tr("around")} ${spec.aspect}`,
    `${tr("up to")} ${kb(spec.maxBytes)} KB`,
  ];
  return parts.join(" · ");
}

/**
 * One image, in one slot, on one row.
 *
 * `currentId` is the vault document id the row points at, or null. It is what
 * the preview is built from — `/api/tenant/public/site/media/:id` is the same
 * URL a visitor's browser will use, so what an administrator sees here is
 * literally what the site serves, including a 404 if the row is not publishable
 * yet. That is the correct behaviour: a partner whose mark does not appear in
 * this preview is a partner whose mark does not appear on the site, and the
 * reason is on the same screen.
 */
export function AssetSlotField({
  slot,
  ownerId,
  currentId,
  onChange,
  disabled,
}: {
  slot: api.AssetSlot;
  ownerId: string;
  currentId: string | null;
  /** Called after a successful upload or removal so the caller can reload the
   *  row. The new id is passed for a caller that would rather patch than
   *  refetch. */
  onChange: (docId: string | null) => void;
  disabled?: boolean;
}) {
  const spec = api.ASSET_SLOTS[slot];
  const [provenance, setProvenance] = React.useState<api.AssetProvenance>("owned");
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const inputId = React.useId();

  /**
   * Through the upload engine. `profile="brand"` for two reasons: these are
   * marks and wordmarks whose colours must come back unchanged, and the profile
   * keeps the SOURCE format — which matters here more than anywhere, because
   * several slots require a transparent background and are refused server-side
   * without one.
   */
  const upload = useUpload<{ doc_id: string }>({
    profile: "brand",
    maxBytes: spec.maxBytes,
    send: async (file, ctx) =>
      api.uploadAsset(
        {
          slot,
          owner_id: ownerId,
          provenance,
          data_url: await fileToDataUrl(file),
          original_name: file.name,
        },
        ctx.onProgress,
      ),
    onAllComplete: ([created]) => {
      if (created) onChange(created.doc_id);
    },
  });

  const item = upload.items[0] ?? null;
  const uploading =
    item?.state === "uploading" || item?.state === "compressing";

  React.useEffect(() => {
    // The server's message is shown verbatim: for a mark with a baked-in white
    // background it names the fix ("export it as a PNG with transparency at
    // twice the display size"), and rewriting that here would lose the only
    // sentence that helps.
    if (item?.state === "error" && item.error) setErr(item.error);
  }, [item?.state, item?.error]);

  function onFile(file?: File | null) {
    if (!file) return;
    setErr(null);
    // The cap is checked by the engine too, but the message here names the SLOT
    // limit rather than a generic one — a 6 MB upload over a Douala connection
    // refused on arrival costs the tenant the whole upload before it tells them
    // anything.
    if (file.size > spec.maxBytes) {
      setErr(
        `${tr("That file is too large for this slot. The limit is")} ${kb(spec.maxBytes)} KB.`,
      );
      return;
    }
    void upload.pick([file]);
  }

  async function onRemove() {
    setBusy(true);
    setErr(null);
    try {
      await api.removeAsset(slot, ownerId);
      onChange(null);
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Field label={SLOT_LABEL[slot]()}>
      <div className="flex flex-wrap items-start gap-3">
        {item?.previewUrl || currentId ? (
          <img
            src={item?.previewUrl || `/api/tenant/public/site/media/${currentId}`}
            /* The row's own name is the alt text and it is supplied by the
               caller's context, not by a second field — see the header. Here in
               the editor the image is a PREVIEW of a control, so it is labelled
               as one. */
            alt={tr("Current image")}
            className="h-14 w-auto max-w-[140px] rounded border border-[var(--border)] bg-[var(--muted)] object-contain"
          />
        ) : (
          <div className="flex h-14 w-[140px] items-center justify-center rounded border border-dashed border-[var(--border)] text-xs text-muted-foreground">
            {tr("None")}
          </div>
        )}

        <div className="min-w-[240px] flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <FilePicker
              variant="inline"
              accept="image/png,image/jpeg,image/webp"
              disabled={disabled || busy || uploading}
              trigger={
                <span className="inline-flex h-9 items-center rounded-md border border-input px-3 text-sm font-medium no-underline hover:bg-accent/40">
                  {uploading
                    ? tr("Uploading…")
                    : currentId
                      ? tr("Replace")
                      : tr("Upload")}
                </span>
              }
              onPick={(files) => onFile(files?.[0])}
            />
            {currentId ? (
              <Button size="sm" variant="ghost" disabled={disabled || busy} onClick={onRemove}>
                {tr("Remove")}
              </Button>
            ) : null}
          </div>

          {item && item.state !== "idle" && (
            <UploadProgress
              state={item.state}
              percent={item.percent}
              error={item.error}
            />
          )}

          {/* BEFORE the dialog, not after a rejection. §6.3. */}
          <p className="text-xs text-muted-foreground">{constraintHint(slot)}</p>
          {spec.transparent ? (
            <p className="text-xs text-muted-foreground">
              {tr(
                "This mark sits on a dark band, so it needs a transparent background. A logo exported on white renders as a white rectangle and is refused.",
              )}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <label className="text-xs text-muted-foreground" htmlFor={`${inputId}-prov`}>
              {tr("Where this image came from")}
            </label>
            <select
              id={`${inputId}-prov`}
              className="h-8 rounded-md border border-input bg-card px-2 text-sm"
              value={provenance}
              disabled={disabled || busy}
              onChange={(e) => setProvenance(e.target.value as api.AssetProvenance)}
            >
              <option value="owned">{tr("Ours — we took or made it")}</option>
              <option value="licensed">{tr("Licensed — we have the right to use it")}</option>
              {/* `generated` is deliberately absent. Every slot in the register
                  is an evidence slot; see the header and EVIDENCE_NOTE below. */}
            </select>
          </div>
          {spec.evidence ? (
            <p className="text-xs text-muted-foreground">{EVIDENCE_NOTE()}</p>
          ) : null}

          {err ? (
            <p role="alert" className="text-xs text-destructive">
              {err}
            </p>
          ) : null}
        </div>
      </div>
    </Field>
  );
}
