/**
 * Auditor data room — staff side (MOD-67).
 *
 * The auditor's document requests land here: every request with who asked and
 * when, the vault documents shared in answer (attach straight from the vault
 * list), and an explicit "Mark answered". Everything is tenant-scoped and the
 * auditor only ever sees their own rooms — this screen is where the tenant's
 * side of that conversation happens.
 */
import { pageShell } from "@/lib/layout";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/panel";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { SkeletonTable } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/data-list";
import { HubCrumb } from "@/components/tabbed-hub";
import { tenant } from "@/lib/api-client";
import { errMsg, useList } from "@/lib/use-resource";
import { dateFmt } from "@/lib/format";

type Room = {
  room_id: string;
  subject_email: string;
  request_note: string;
  status: "OPEN" | "ANSWERED";
  created_at: string;
  answered_at: string | null;
  doc_count: number;
};

type RoomDoc = {
  doc_id: string;
  doc_type: string | null;
  original_name: string | null;
  created_at: string;
  doc_type_code: string | null;
};

type VaultRow = {
  doc_id: string;
  doc_type: string | null;
  original_name: string | null;
  entity_ref: string | null;
  status: string;
  created_at: string;
};

const docLabel = (d: RoomDoc) =>
  d.original_name || (d.doc_type_code || d.doc_type || "document") + ".pdf";

export function AuditRoomPage() {
  const { t } = useTranslation();
  const { rows: vaultRows, error: vaultErr } = useList<VaultRow>("/documents");
  const [rooms, setRooms] = React.useState<Room[] | null>(null);
  const [openId, setOpenId] = React.useState<string | null>(null);
  const [docs, setDocs] = React.useState<RoomDoc[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [attachPick, setAttachPick] = React.useState<Record<string, string>>({});

  const reload = React.useCallback(() => {
    tenant<Room[]>("/portal/data-room")
      .then((r) => setRooms(r))
      .catch((e) => setError(errMsg(e)));
  }, []);

  React.useEffect(reload, [reload]);

  async function openRoom(id: string) {
    if (openId === id) {
      setOpenId(null);
      setDocs(null);
      return;
    }
    setOpenId(id);
    setDocs(null);
    setError(null);
    try {
      const out = await tenant<{ room: Room; docs: RoomDoc[] }>(
        `/portal/data-room/${id}`,
      );
      setDocs(out.docs);
    } catch (e) {
      setError(errMsg(e));
    }
  }

  async function attach(roomId: string) {
    const docId = attachPick[roomId];
    if (!docId) return;
    setBusy(`attach:${roomId}`);
    setError(null);
    try {
      await tenant(`/portal/data-room/${roomId}/documents`, {
        method: "POST",
        body: { doc_id: docId },
      });
      setAttachPick((p) => ({ ...p, [roomId]: "" }));
      reload();
      if (openId === roomId) await openRoom(roomId);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  async function answer(roomId: string) {
    setBusy(`answer:${roomId}`);
    setError(null);
    try {
      await tenant(`/portal/data-room/${roomId}/answer`, {
        method: "POST",
      });
      reload();
      if (openId === roomId) await openRoom(roomId);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  // Only VERIFIED vault documents can be shared.
  const attachable = (vaultRows || []).filter(
    (v) => String(v.status).toUpperCase() === "VERIFIED",
  );

  return (
    <section className={pageShell.wide}>
      <PageHeader
        eyebrow={<HubCrumb area="Settings" to="/settings" />}
        title={t("settings.auditorDataRoom")}
        description={t("dataRoom.staffDesc")}
        action={
          <Button variant="outline" size="sm" onClick={reload}>
            {t("common.refresh")}
          </Button>
        }
      />

      {error && (
        <div className="mb-3">
          <ErrorState message={error} />
        </div>
      )}
      {vaultErr && !vaultRows && (
        <div className="mb-3">
          <ErrorState message={errMsg(vaultErr)} />
        </div>
      )}

      {rooms === null ? (
        <SkeletonTable />
      ) : rooms.length === 0 ? (
        <EmptyState
          title={t("dataRoom.noRequests")}
          hint={t("dataRoom.noRequestsHint")}
        />
      ) : (
        <ul className="space-y-4">
          {rooms.map((r) => {
            const open = openId === r.room_id;
            return (
              <li key={r.room_id}>
                <Panel
                  title={
                    <span className="flex flex-wrap items-center gap-2">
                      {r.request_note}
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide ${
                          r.status === "ANSWERED"
                            ? "bg-[rgb(var(--ok)/0.12)] text-[rgb(var(--ok))]"
                            : "bg-[rgb(var(--warn)/0.12)] text-[rgb(var(--warn))]"
                        }`}
                      >
                        {r.status === "ANSWERED" ? t("portal.answered") : t("portal.open")}
                      </span>
                    </span>
                  }
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <p className="text-muted-foreground">
                      {r.subject_email} · {dateFmt(r.created_at)} ·{" "}
                      {r.doc_count} document{r.doc_count === 1 ? "" : "s"}
                      {r.answered_at
                        ? ` · answered ${dateFmt(r.answered_at)}`
                        : ""}
                    </p>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void openRoom(r.room_id)}
                      >
                        {open ? "Hide" : "Open"}
                      </Button>
                      {r.status !== "ANSWERED" && (
                        <Button
                          size="sm"
                          variant="ghost"
                          loading={busy === `answer:${r.room_id}`}
                          onClick={() => void answer(r.room_id)}
                        >
                          {t("dataRoom.markAnswered")}
                        </Button>
                      )}
                    </div>
                  </div>

                  {open && (
                    <div className="mt-4 space-y-3 border-t border-border pt-3">
                      {docs === null ? (
                        <p className="text-sm text-muted-foreground">
                          Loading…
                        </p>
                      ) : (
                        <>
                          {docs.length === 0 ? (
                            <p className="text-sm text-muted-foreground">
                              {t("dataRoom.noDocsShared")}
                            </p>
                          ) : (
                            <ul className="divide-y divide-border">
                              {docs.map((d) => (
                                <li
                                  key={d.doc_id}
                                  className="flex items-center justify-between gap-3 py-2 text-sm"
                                >
                                  <span className="truncate text-foreground">
                                    {docLabel(d)}
                                  </span>
                                  <span className="shrink-0 text-xs text-muted-foreground">
                                    {dateFmt(d.created_at)}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          )}

                          <div className="flex flex-wrap items-center gap-2">
                            <select
                              value={attachPick[r.room_id] || ""}
                              onChange={(e) =>
                                setAttachPick((p) => ({
                                  ...p,
                                  [r.room_id]: e.target.value,
                                }))
                              }
                              className="max-w-sm rounded-lg border border-border bg-card px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
                            >
                              <option value="">
                                {attachable.length === 0
                                  ? t("dataRoom.noVerified")
                                  : t("dataRoom.attachPlaceholder")}
                              </option>
                              {attachable.map((v) => (
                                <option key={v.doc_id} value={v.doc_id}>
                                  {v.original_name ||
                                    `${v.doc_type || "document"} · ${
                                      v.entity_ref || v.doc_id.slice(0, 8)
                                    }`}
                                </option>
                              ))}
                            </select>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={!attachPick[r.room_id]}
                              loading={busy === `attach:${r.room_id}`}
                              onClick={() => void attach(r.room_id)}
                            >
                              {t("dataRoom.shareDocument")}
                            </Button>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </Panel>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export default AuditRoomPage;
