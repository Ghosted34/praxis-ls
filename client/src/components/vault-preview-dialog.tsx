/** In-app preview for a document already stored in the tenant vault. */
import * as React from "react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ErrorState, LoadingRow } from "@/components/ui/states";
import { fetchVaultDoc, downloadVaultDoc } from "@/lib/vault-file";
import { errMsg } from "@/lib/use-resource";
import { tr } from "@/lib/i18n";

export type VaultPreviewDocument = {
  doc_id: string;
  title: string;
  filename?: string | null;
};

const browserPreviewable = (type: string) =>
  type === "application/pdf" || type.startsWith("image/") || type.startsWith("text/");

export function VaultPreviewDialog({
  document,
  onClose,
}: {
  document: VaultPreviewDocument | null;
  onClose: () => void;
}) {
  const [url, setUrl] = React.useState<string | null>(null);
  const [type, setType] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!document) return;
    let disposed = false;
    let objectUrl: string | null = null;
    setUrl(null);
    setType("");
    setError(null);
    fetchVaultDoc(document.doc_id)
      .then((blob) => {
        if (disposed) return;
        objectUrl = URL.createObjectURL(blob);
        setType(blob.type.toLowerCase());
        setUrl(objectUrl);
      })
      .catch((e) => {
        if (!disposed) setError(errMsg(e));
      });
    return () => {
      disposed = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [document]);

  if (!document) return null;
  const filename = document.filename || document.title || "document";
  const canPreview = url && browserPreviewable(type);

  return (
    <Dialog
      open
      onClose={onClose}
      title={document.title}
      description={tr("Preview the stored document without leaving this file.")}
      size="wide"
    >
      <div className="space-y-3">
        {!url && !error && <LoadingRow label={tr("Loading document…")} />}
        {error && <ErrorState message={error} />}
        {canPreview && type.startsWith("image/") && (
          <div className="flex max-h-[70vh] justify-center overflow-auto rounded-lg border border-border bg-muted/30 p-3">
            <img src={url} alt={document.title} className="max-h-[66vh] max-w-full object-contain" />
          </div>
        )}
        {canPreview && !type.startsWith("image/") && (
          <iframe
            src={url}
            title={document.title}
            className="h-[70vh] w-full rounded-lg border border-border bg-white"
          />
        )}
        {url && !canPreview && (
          <div className="rounded-lg border border-border bg-muted/30 px-4 py-8 text-center">
            <p className="text-sm font-medium text-foreground">
              {tr("This file type cannot be displayed by the browser.")}
            </p>
            <p className="micro mt-1 text-muted-foreground">
              {tr("Download it to open it in Word, Excel, or another installed application.")}
            </p>
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>{tr("Close")}</Button>
          <Button
            type="button"
            disabled={!url}
            onClick={() => void downloadVaultDoc(document.doc_id, filename)}
          >
            {tr("Download")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
