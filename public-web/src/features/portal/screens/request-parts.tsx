/**
 * What we are waiting for from the client — and the two ways they answer.
 *
 * A REQUEST is one row: a document we need (a commercial invoice, a packing
 * list) or a piece of information (the consignee's tax number). It comes from
 * a rule on their shipment or from a person on the team, and it is answered in
 * a sheet that is nothing but the answer: take a photo or choose a file, watch
 * it go up, done. A document sent back comes back to the same row with the
 * reviewer's reason on it.
 *
 * SHARING is the other direction: the client sends a document nobody asked for
 * yet — pick what it is, pick the shipment, pick the file.
 */
import * as React from "react";
import { useTranslation } from "react-i18next";
import {
  portalUploadForRequest,
  portalAnswerRequest,
  portalShareDocument,
  portalDocumentTypes,
  type ClientRequest,
  type DocType,
  type ShipmentCard,
} from "@/lib/portal-api";
import { getLang } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { Sheet, Pill, IconDisc, TextArea, errorText, Busy, useToast, type Tone } from "../ui/kit";
import { FileChooser, UploadProgress, type Picked } from "../ui/upload";
import { DocIcon, InfoIcon, ShipIcon, CalendarIcon, AlertIcon, CheckCircleIcon, ClockIcon, UploadIcon, ChevronRightIcon } from "../ui/icons";
import { relDay, daysFromToday } from "../lib/when";

export function requestName(r: ClientRequest): string {
  const fr = getLang() === "fr";
  return r.title || (fr ? r.doc_type_fr || r.doc_type_en : r.doc_type_en || r.doc_type_fr) || r.doc_type_code || "—";
}

export const docTypeName = (d: { name_en: string | null; name_fr: string | null; code?: string | null }) =>
  (getLang() === "fr" ? d.name_fr || d.name_en : d.name_en || d.name_fr) || d.code || "—";

const TONE: Record<ClientRequest["status"], Tone> = {
  OPEN: "warn",
  REJECTED: "bad",
  SUBMITTED: "info",
  ACCEPTED: "ok",
  CANCELLED: "mute",
};

export function RequestStatusPill({ r }: { r: ClientRequest }) {
  const { t } = useTranslation();
  return <Pill tone={TONE[r.status]}>{t(`portal.req.status.${r.status}`)}</Pill>;
}

export function DuePill({ on }: { on: string | null }) {
  const { t } = useTranslation();
  if (!on) return null;
  const late = (daysFromToday(on) ?? 1) < 0;
  return (
    <Pill tone={late ? "bad" : "mute"} plain>
      <CalendarIcon size={13} />
      {t("portal.req.due", { when: relDay(on) })}
    </Pill>
  );
}

/** One thing we need. The button says the verb: Upload, Answer, Send again.
 *  One quiet line under the name says which shipment and by when — pills are
 *  kept for the state that needs attention (sent back, in review). */
export function RequestRow({ r, onOpen, showShipment = true }: { r: ClientRequest; onOpen: (r: ClientRequest) => void; showShipment?: boolean }) {
  const { t } = useTranslation();
  const actionable = r.status === "OPEN" || r.status === "REJECTED";
  const isDoc = r.kind === "DOCUMENT";
  const late = r.due_on ? (daysFromToday(r.due_on) ?? 1) < 0 : false;
  const meta: React.ReactNode[] = [];
  if (showShipment && r.dossier_ref) meta.push(<span key="ref" className="pt-mono">{r.dossier_ref}</span>);
  if (r.status === "OPEN" && r.due_on)
    meta.push(
      <span key="due" className={late ? "font-semibold text-[rgb(var(--bad))]" : undefined}>
        {t("portal.req.due", { when: relDay(r.due_on) })}
      </span>,
    );
  return (
    <button type="button" className="pt-row" onClick={() => onOpen(r)}>
      <IconDisc tone={TONE[r.status]}>
        {r.status === "ACCEPTED" ? <CheckCircleIcon /> : r.status === "SUBMITTED" ? <ClockIcon /> : isDoc ? <DocIcon /> : <InfoIcon />}
      </IconDisc>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[0.95rem] font-semibold text-foreground">{requestName(r)}</span>
        {r.status !== "OPEN" ? (
          <span className="mt-1 flex">
            <RequestStatusPill r={r} />
          </span>
        ) : null}
        {meta.length ? (
          <span className="mt-0.5 block truncate text-xs text-muted-foreground">
            {meta.map((m, i) => (
              <React.Fragment key={i}>
                {i ? " · " : null}
                {m}
              </React.Fragment>
            ))}
          </span>
        ) : null}
      </span>
      {actionable ? (
        <span className="pt-btn pt-btn-soft pt-btn-sm shrink-0">
          {r.status === "REJECTED" ? t("portal.req.again") : isDoc ? t("portal.req.upload") : t("portal.req.answer")}
        </span>
      ) : (
        <ChevronRightIcon size={18} className="text-muted-foreground" />
      )}
    </button>
  );
}

/** Upload progress state for one send — the bar, the tick, the error. */
function useSend() {
  const [pct, setPct] = React.useState(0);
  const [state, setState] = React.useState<"idle" | "sending" | "done">("idle");
  const [error, setError] = React.useState<string | null>(null);
  const run = React.useCallback(async (fn: (onProgress: (p: number) => void) => Promise<unknown>) => {
    setError(null);
    setPct(0);
    setState("sending");
    try {
      await fn(setPct);
      setState("done");
      return true;
    } catch (e) {
      setError(errorText(e));
      setState("idle");
      return false;
    }
  }, []);
  const reset = React.useCallback(() => {
    setPct(0);
    setState("idle");
    setError(null);
  }, []);
  return { pct, state, error, run, reset };
}

/** Answering one request: a file for a document, a sentence for information. */
export function RequestSheet({ r, onClose, onDone }: { r: ClientRequest | null; onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [file, setFile] = React.useState<Picked | null>(null);
  const [text, setText] = React.useState("");
  const send = useSend();
  const resetSend = send.reset;
  const open = !!r;

  React.useEffect(() => {
    setFile(null);
    setText(r?.answer_text || "");
    resetSend();
  }, [r, resetSend]);

  if (!r) return <Sheet open={false} onClose={onClose}>{null}</Sheet>;
  const actionable = r.status === "OPEN" || r.status === "REJECTED" || r.status === "SUBMITTED";
  const isDoc = r.kind === "DOCUMENT";
  const replacing = r.status === "SUBMITTED";

  async function submit() {
    if (!r) return;
    const ok = await send.run((onProgress) =>
      isDoc && file ? portalUploadForRequest(r.client_request_id, file.file, onProgress) : portalAnswerRequest(r.client_request_id, text.trim()),
    );
    if (ok) {
      toast(t("portal.req.sent"));
      window.setTimeout(() => {
        onDone();
        onClose();
      }, 700);
    }
  }

  const ready = isDoc ? !!file : text.trim().length > 0;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={requestName(r)}
      footer={
        actionable && (!replacing || file || !isDoc) ? (
          <button type="button" className="pt-btn pt-btn-primary pt-btn-block" disabled={!ready || send.state !== "idle"} onClick={() => void submit()}>
            <Busy busy={send.state === "sending"}>{isDoc ? <UploadIcon size={20} /> : null}</Busy>
            {isDoc ? (replacing ? t("portal.req.replace") : t("portal.req.send")) : t("portal.req.sendAnswer")}
          </button>
        ) : null
      }
    >
      <div className="flex flex-wrap items-center gap-1.5">
        {r.dossier_ref ? (
          <Pill plain>
            <ShipIcon size={13} />
            <span className="pt-mono">{r.dossier_ref}</span>
          </Pill>
        ) : null}
        <RequestStatusPill r={r} />
        {r.status === "OPEN" || r.status === "REJECTED" ? <DuePill on={r.due_on} /> : null}
      </div>

      {r.status === "REJECTED" && r.review_note ? (
        <div className="mt-4 flex gap-3 rounded-[16px] bg-[rgb(var(--bad)/0.08)] p-4">
          <AlertIcon size={20} className="mt-0.5 text-[rgb(var(--bad))]" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">{t("portal.req.sentBack")}</p>
            <p className="mt-0.5 text-sm text-foreground">{r.review_note}</p>
          </div>
        </div>
      ) : null}

      {r.note ? (
        <div className="mt-4 rounded-[16px] bg-[var(--pt-soft)] p-4">
          <p className="text-xs font-semibold text-muted-foreground">{t("portal.req.fromTeam")}</p>
          <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">{r.note}</p>
        </div>
      ) : null}

      {r.status === "SUBMITTED" || r.status === "ACCEPTED" ? (
        <div className="mt-4 flex items-center gap-3 rounded-[16px] border border-[var(--pt-line)] p-3">
          <IconDisc tone={r.status === "ACCEPTED" ? "ok" : "info"} size={40}>
            {r.status === "ACCEPTED" ? <CheckCircleIcon size={20} /> : <ClockIcon size={20} />}
          </IconDisc>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-foreground">{r.answer_doc_name || r.answer_text || "—"}</p>
            <p className="text-xs text-muted-foreground">
              {r.status === "ACCEPTED" ? t("portal.req.acceptedHint") : t("portal.req.reviewHint")}
            </p>
          </div>
        </div>
      ) : null}

      {actionable ? (
        <div className="mt-5">
          {isDoc ? (
            <>
              {replacing && !file ? <p className="mb-3 text-sm font-semibold text-foreground">{t("portal.req.replaceTitle")}</p> : null}
              <FileChooser value={file} onChange={setFile} disabled={send.state !== "idle"} compact />
            </>
          ) : (
            <TextArea
              label={t("portal.req.yourAnswer")}
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={3}
              maxLength={4000}
              disabled={send.state !== "idle"}
            />
          )}
          {send.state !== "idle" && isDoc ? (
            <div className="mt-4">
              <UploadProgress pct={send.pct} done={send.state === "done"} />
            </div>
          ) : null}
          {send.error ? (
            <p role="alert" className="mt-3 text-sm font-medium text-[rgb(var(--bad))]">
              {send.error}
            </p>
          ) : null}
        </div>
      ) : null}
    </Sheet>
  );
}

const COMMON_TYPES = ["COMMERCIAL_INVOICE", "PACKING_LIST", "BL", "MAWB", "CERTIFICATE_OF_ORIGIN", "CUSTOMS_DECLARATION", "INSURANCE", "INSURANCE_POLICY"];

/** Send a document nobody asked for yet: what it is, which shipment, the file. */
export function ShareSheet({
  open,
  onClose,
  onDone,
  shipments,
  dossierId = null,
}: {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
  shipments: ShipmentCard[];
  dossierId?: string | null;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const [types, setTypes] = React.useState<DocType[] | null>(null);
  const [type, setType] = React.useState<string | null>(null);
  const [allTypes, setAllTypes] = React.useState(false);
  const [dossier, setDossier] = React.useState<string | null>(dossierId);
  const [file, setFile] = React.useState<Picked | null>(null);
  const [note, setNote] = React.useState("");
  const send = useSend();
  const resetSend = send.reset;

  React.useEffect(() => {
    if (!open) return;
    setType(null);
    setAllTypes(false);
    setDossier(dossierId);
    setFile(null);
    setNote("");
    resetSend();
    if (!types) {
      portalDocumentTypes()
        .then(setTypes)
        .catch(() => setTypes([])); // class D, best-effort — "Other" still works
    }
  }, [open, dossierId, types, resetSend]);

  const shown = React.useMemo(() => {
    const list = types || [];
    if (allTypes) return list;
    const common = list.filter((d) => COMMON_TYPES.includes(d.code));
    return common.length ? common : list.slice(0, 8);
  }, [types, allTypes]);

  async function submit() {
    if (!file) return;
    const ok = await send.run((onProgress) =>
      portalShareDocument({ docTypeCode: type, dossierId: dossier, note: note.trim() || null }, file.file, onProgress),
    );
    if (ok) {
      toast(t("portal.share.sent"));
      window.setTimeout(() => {
        onDone();
        onClose();
      }, 700);
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t("portal.share.title")}
      footer={
        <button type="button" className="pt-btn pt-btn-primary pt-btn-block" disabled={!file || send.state !== "idle"} onClick={() => void submit()}>
          <Busy busy={send.state === "sending"}>
            <UploadIcon size={20} />
          </Busy>
          {t("portal.share.send")}
        </button>
      }
    >
      <p className="pt-label">{t("portal.share.what")}</p>
      <div className="flex flex-wrap gap-2">
        {shown.map((d) => (
          <button key={d.code} type="button" className="pt-chip" aria-pressed={type === d.code} onClick={() => setType(type === d.code ? null : d.code)}>
            {docTypeName(d)}
          </button>
        ))}
        {types && types.length > shown.length && !allTypes ? (
          <button type="button" className="pt-chip text-muted-foreground" onClick={() => setAllTypes(true)}>
            {t("portal.share.more")}
          </button>
        ) : null}
        <button type="button" className="pt-chip" aria-pressed={type === null} onClick={() => setType(null)}>
          {t("portal.share.other")}
        </button>
      </div>

      {shipments.length ? (
        <>
          <p className="pt-label mt-5">{t("portal.share.which")}</p>
          <div className="pt-hide-scrollbar -mx-5 flex gap-2 overflow-x-auto px-5 pb-1">
            <button type="button" className="pt-chip shrink-0" aria-pressed={dossier === null} onClick={() => setDossier(null)}>
              {t("portal.share.noShipment")}
            </button>
            {shipments.map((s) => (
              <button key={s.dossier_id} type="button" className="pt-chip shrink-0" aria-pressed={dossier === s.dossier_id} onClick={() => setDossier(s.dossier_id)}>
                <ShipIcon size={16} />
                <span className="pt-mono">{s.ref}</span>
              </button>
            ))}
          </div>
        </>
      ) : null}

      <p className="pt-label mt-5">{t("portal.share.file")}</p>
      <FileChooser value={file} onChange={setFile} disabled={send.state !== "idle"} compact />

      <TextArea
        className={cn("mt-5", !file && "hidden")}
        label={t("portal.share.note")}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={2}
        maxLength={2000}
        disabled={send.state !== "idle"}
      />

      {send.state !== "idle" ? (
        <div className="mt-4">
          <UploadProgress pct={send.pct} done={send.state === "done"} />
        </div>
      ) : null}
      {send.error ? (
        <p role="alert" className="mt-3 text-sm font-medium text-[rgb(var(--bad))]">
          {send.error}
        </p>
      ) : null}
    </Sheet>
  );
}
