import * as React from "react";
import { tenant } from "@/lib/api-client";
import { pageShell } from "@/lib/layout";
import { tr } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, Field } from "@/components/ui/modal";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { StatusPill } from "@/components/ui/pill";
import { errMsg, type Row } from "@/lib/use-resource";
import { dateFmt } from "@/lib/format";

function ReconciliationPage() {
  const [rows, setRows] = React.useState<Row[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [bindRow, setBindRow] = React.useState<Row | null>(null);
  const [printJobId, setPrintJobId] = React.useState("");

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setRows(await tenant<Row[]>("/signatures/ingest/queue"));
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => { void load(); }, []);

  async function decode(id: string) {
    await tenant(`/signatures/ingest/${id}/decode`, { method: "POST", body: {} });
    await load();
  }

  async function reject(id: string) {
    await tenant(`/signatures/ingest/${id}/reject`, { method: "POST", body: { reason: "Rejected from review queue" } });
    await load();
  }

  async function bind() {
    if (!bindRow || !printJobId) return;
    await tenant(`/signatures/ingest/${bindRow.ingest_id}/bind`, {
      method: "POST",
      body: { print_job_id: printJobId },
    });
    setBindRow(null);
    setPrintJobId("");
    await load();
  }

  return (
    <section className={`${pageShell.wide} space-y-4`}>
      <div>
        <h1 className="text-2xl font-semibold">{tr("Wet-signature review")}</h1>
        <p className="text-sm text-muted-foreground">
          Returned paper signatures that need decode, manual binding or rejection.
        </p>
      </div>

      {error && <ErrorState message={error} />}
      {!loading && rows.length === 0 ? (
        <EmptyState title={tr("No scans waiting for review")} />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>{tr("Received")}</TH>
              <TH>{tr("Source")}</TH>
              <TH>{tr("Decode")}</TH>
              <TH>{tr("Match")}</TH>
              <TH>{tr("Notes")}</TH>
              <TH>{tr("Candidate")}</TH>
              <TH>{tr("Actions")}</TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((r) => (
              <TR key={String(r.ingest_id)}>
                <TD>{dateFmt(r.created_at)}</TD>
                <TD>{String(r.source ?? "—")}</TD>
                <TD><StatusPill status={String(r.decode_status ?? "PENDING")} /></TD>
                <TD><StatusPill status={String(r.match_status ?? "PENDING")} /></TD>
                <TD>{String(r.match_notes ?? "—")}</TD>
                <TD>{String(r.entity_ref ?? r.print_code ?? "—")}</TD>
                <TD>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => decode(String(r.ingest_id))}>
                      {tr("Decode")}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => { setBindRow(r); setPrintJobId(String(r.print_job_id ?? "")); }}>
                      {tr("Bind")}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => reject(String(r.ingest_id))}>
                      {tr("Reject")}
                    </Button>
                  </div>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}

      <Modal open={Boolean(bindRow)} onClose={() => setBindRow(null)} title={tr("Bind returned scan")}
        description="Paste or confirm the print job id. Use Search manually from the document detail if the barcode was not readable."
      >
        <div className="space-y-4">
          <Field label={tr("Print job id")}>
            <Input value={printJobId} onChange={(e) => setPrintJobId(e.target.value)} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setBindRow(null)}>{tr("Cancel")}</Button>
            <Button onClick={bind} disabled={!printJobId}>{tr("Bind")}</Button>
          </div>
        </div>
      </Modal>
    </section>
  );
}

export { ReconciliationPage };
export default ReconciliationPage;
