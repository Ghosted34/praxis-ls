/**
 * DocumentView — the shared "click a row → see the document" surface
 * (doc/DOC_UI_OVERHAUL_STEP1.md). Renders a record in its real template layout
 * (the same HTML the PDF is built from) in a full-screen sheet, with Download
 * (generate + vault the PDF) and, for docs that go to a recipient, Send. Reused
 * by every list screen that produces a document.
 */
import * as React from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { tenant } from "@/lib/api-client";
import { errMsg } from "@/lib/use-resource";

export function DocumentView({
  docType,
  recordId,
  title,
  sendable,
  onClose,
}: {
  docType: string;
  recordId: string;
  title?: string;
  sendable?: boolean;
  onClose: () => void;
}) {
  const [html, setHtml] = React.useState("");
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [note, setNote] = React.useState<string | null>(null);

  React.useEffect(() => {
    let live = true;
    setError(null);
    tenant<{ html: string }>(`/document-templates/${docType}/preview`, { method: "POST", body: { record_id: recordId } })
      .then((r) => { if (live) setHtml(r.html); })
      .catch((e) => { if (live) setError(errMsg(e)); });
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => { live = false; document.removeEventListener("keydown", onKey); };
  }, [docType, recordId, onClose]);

  async function download() {
    setBusy("dl"); setError(null); setNote(null);
    try {
      const out = await tenant<{ public_url?: string }>(`/document-templates/${docType}/generate`, { method: "POST", body: { record_id: recordId } });
      if (out.public_url) window.open(out.public_url, "_blank");
      else setNote("Generated and stored in the document vault.");
    } catch (e) { setError(errMsg(e)); } finally { setBusy(null); }
  }
  async function send() {
    const to = window.prompt("Send document to (email):");
    if (!to) return;
    setBusy("send"); setError(null); setNote(null);
    try { await tenant(`/document-templates/${docType}/${recordId}/send`, { method: "POST", body: { to } }); setNote(`Sent to ${to}.`); }
    catch (e) { setError(errMsg(e)); } finally { setBusy(null); }
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex flex-col bg-black/50 backdrop-blur-sm" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="lux-topbar flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="font-display text-lg tracking-tight">{title || docType}</div>
        <div className="flex items-center gap-2">
          {sendable && <Button size="sm" variant="outline" loading={busy === "send"} onClick={send}>Send</Button>}
          <Button size="sm" loading={busy === "dl"} onClick={download}>Download PDF</Button>
          <Button size="sm" variant="ghost" onClick={onClose}>Close</Button>
        </div>
      </div>
      {error && <div className="bg-background px-4 py-2 text-sm text-[rgb(var(--bad))]">{error}</div>}
      {note && <div className="bg-background px-4 py-2 text-sm text-[rgb(var(--ok))]">{note}</div>}
      <div className="flex-1 overflow-auto bg-[rgb(var(--ink)_/_0.12)] p-4">
        <iframe title="document" srcDoc={html} className="mx-auto block h-full min-h-[80vh] w-full max-w-[820px] rounded bg-white shadow-2xl" sandbox="" />
      </div>
    </div>,
    document.body,
  );
}

export default DocumentView;
