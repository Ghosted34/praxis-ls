import { useState } from "react";
import { ops, fmtBytes, type ObjectRestoreResult, type RestoreAccepted } from "@/lib/ops-api";
import { Button, Modal, Pill } from "@/components/ui";
// Day-first, like every other date the console shows. A native
// `datetime-local` renders its date part in the OS locale, which in a corridor
// that reads dates day-first is a month-first date nobody notices is wrong.
import { DateTimeField } from "@/components/DateTimeField";

/**
 * The recovery dialogs — the only place in the console that puts data BACK
 * into a live tenant.
 *
 * WHY THESE ARE NOT `ConfirmModal`
 *
 *   Every other action on this screen is reversible or harmless: a backup can
 *   be re-run, a drill throws its copy away, a sync copies outward. Recovery is
 *   neither. The cost of getting the TENANT wrong is a restore performed
 *   against somebody who was fine, and the cost of misreading what the button
 *   does is an operator who believes the recovery is finished when six manual
 *   steps remain. A one-click "Are you sure?" is the wrong instrument for both,
 *   so these dialogs make the operator type the tenant name and read what is
 *   still left to do.
 *
 * WHAT THE DATABASE BUTTON DOES NOT DO
 *
 *   It does not replace the live database. It restores the dump into a NEW
 *   database and stops. Nothing a tenant can see changes until a human
 *   re-points the registry — which is step 3 of eight, and the dialog says so.
 */

/** Typed-confirmation field shared by both dialogs. */
function TypeToConfirm({ slug, value, onChange }: { slug: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="stack" style={{ gap: 4, marginTop: 14 }}>
      <span className="f" style={{ fontSize: 12.5 }}>
        Type <span className="mono">{slug}</span> to confirm
      </span>
      <input
        className="mono"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={slug}
        autoFocus
        spellCheck={false}
      />
    </label>
  );
}

/* ── Database recovery ──────────────────────────────────────────────────── */

export function RestoreDatabaseModal({
  slug, onClose, onDone, onError,
}: {
  slug: string;
  onClose: () => void;
  onDone: (msg: string) => void;
  onError: (e: unknown) => void;
}) {
  const [typed, setTyped] = useState("");
  const [at, setAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<RestoreAccepted | null>(null);

  const go = () => {
    setBusy(true);
    ops.restoreDatabase(slug, typed, at ? new Date(at).toISOString() : null)
      .then((r) => { setResult(r); onDone(`Recovery restore started for ${slug}`); })
      .catch(onError)
      .finally(() => setBusy(false));
  };

  if (result) {
    return (
      <Modal title={<span>Recovery started — <span className="mono">{slug}</span></span>} onClose={onClose} maxWidth={620}>
        <div className="banner ok" style={{ marginBottom: 12 }}>
          The live database has <strong>not</strong> been touched. The dump is being restored into a
          new database: <span className="mono">{result.into}</span>. Watch the Restore drills panel —
          the result and its integrity probes land there when it finishes.
        </div>
        <div className="f" style={{ marginBottom: 4 }}>Still to do, by hand</div>
        <div className="dim" style={{ fontSize: 13 }}>{result.next_steps}</div>
      </Modal>
    );
  }

  return (
    <Modal
      title={<span>Restore <span className="mono">{slug}</span> from backup</span>}
      onClose={onClose}
      maxWidth={620}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="danger" onClick={go} loading={busy} disabled={typed !== slug}>
            Restore into a new database
          </Button>
        </>
      }
    >
      <div className="banner warn" style={{ marginBottom: 12 }}>
        This is a <strong>real recovery</strong>, not a drill. Use it when this tenant&rsquo;s data is
        lost or corrupted — not when the tenant is merely unreachable.
      </div>

      <div className="dim" style={{ fontSize: 13.5 }}>
        <p style={{ marginTop: 0 }}>
          The backup is restored into a <strong>new</strong> database. The tenant&rsquo;s current
          database is left exactly as it is and keeps serving traffic, so this step is reversible:
          if the restore is the wrong call, nothing has been lost by trying it.
        </p>
        <p>
          <strong>It is step 2 of 8.</strong> After it finishes someone still has to park the tenant,
          re-point the registry at the new database, re-issue its credentials and refresh the pooler,
          run any migrations the backup predates, restore documents, and verify by downloading one —
          incident runbook §4.3a. Nothing the tenant sees changes until that is done.
        </p>
        <p>
          <strong>Everything written after the backup is gone</strong> once you do cut over. Check the
          dump&rsquo;s age on the row behind this dialog before continuing, and get the database owner
          on the call.
        </p>
      </div>

      <label className="stack" style={{ gap: 4, marginTop: 10 }}>
        <span className="f" style={{ fontSize: 12.5 }}>
          Recover to an earlier point <span className="muted">(optional — leave blank for the latest dump)</span>
        </span>
        <DateTimeField value={at} onChange={setAt} aria-label="Recover to an earlier point" />
        <span className="muted" style={{ fontSize: 12 }}>
          Use this when the damage was written <em>before</em> the last backup, so the newest dump
          contains it too.
        </span>
      </label>

      <TypeToConfirm slug={slug} value={typed} onChange={setTyped} />
    </Modal>
  );
}

/* ── Document recovery ──────────────────────────────────────────────────── */

/**
 * Safe by construction, which is the only reason this one gets a button at
 * all: it writes back files that are MISSING and never overwrites a file that
 * survived, and it checks each file's fingerprint before writing it. The
 * console always runs the rehearsal first and shows the operator the numbers.
 */
export function RestoreObjectsModal({
  slug, onClose, onDone, onError,
}: {
  slug: string;
  onClose: () => void;
  onDone: (msg: string) => void;
  onError: (e: unknown) => void;
}) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState<"dry" | "real" | null>(null);
  const [preview, setPreview] = useState<ObjectRestoreResult | null>(null);
  const [started, setStarted] = useState(false);

  const dryRun = () => {
    setBusy("dry");
    ops.restoreObjects(slug, typed, true)
      .then((r) => setPreview(r as ObjectRestoreResult))
      .catch(onError)
      .finally(() => setBusy(null));
  };

  const real = () => {
    setBusy("real");
    ops.restoreObjects(slug, typed, false)
      .then(() => { setStarted(true); onDone(`Document restore started for ${slug}`); })
      .catch(onError)
      .finally(() => setBusy(null));
  };

  const unrecoverable = (preview?.missing_offsite.length || 0) + (preview?.mismatched.length || 0);

  return (
    <Modal
      title={<span>Restore documents — <span className="mono">{slug}</span></span>}
      onClose={onClose}
      maxWidth={620}
      footer={
        started ? (
          <Button variant="primary" onClick={onClose}>Close</Button>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose} disabled={!!busy}>Cancel</Button>
            <Button variant="ghost" onClick={dryRun} loading={busy === "dry"} disabled={typed !== slug}>
              Rehearse (changes nothing)
            </Button>
            <Button variant="danger" onClick={real} loading={busy === "real"} disabled={typed !== slug || !preview}>
              Restore {preview ? `${preview.restored} document${preview.restored === 1 ? "" : "s"}` : ""}
            </Button>
          </>
        )
      }
    >
      {started ? (
        <div className="banner ok">
          Started. Files are being written back now; the result appears in the Run log as an
          <span className="mono"> object restore</span> row. Run an integrity scan afterwards to
          confirm every document the database promises is present.
        </div>
      ) : (
        <>
          <div className="dim" style={{ fontSize: 13.5 }}>
            <p style={{ marginTop: 0 }}>
              Puts back documents that are <strong>missing</strong> from primary storage. A file that
              is still there is left alone — the live copy is never older than the backup, so
              replacing it could only lose work. Every file is checked against the fingerprint the
              database recorded before it is written.
            </p>
            <p>
              Do this <strong>after</strong> the database is back, never before: the database is the
              list of which documents should exist.
            </p>
          </div>

          <TypeToConfirm slug={slug} value={typed} onChange={setTyped} />

          {preview && (
            <div style={{ marginTop: 14 }}>
              <div className="f" style={{ marginBottom: 6 }}>Rehearsal result — nothing was written</div>
              <dl className="kv" style={{ gridTemplateColumns: "180px 1fr" }}>
                <dt>Documents on record</dt><dd>{preview.considered}</dd>
                <dt>Would be restored</dt><dd><strong>{preview.restored}</strong> ({fmtBytes(preview.bytes)})</dd>
                <dt>Already present</dt><dd className="muted">{preview.skipped} — left untouched</dd>
                <dt>Unrecoverable</dt>
                <dd>
                  {unrecoverable === 0
                    ? <span className="muted">none</span>
                    : <Pill tone="bad">{unrecoverable}</Pill>}
                </dd>
              </dl>
              {unrecoverable > 0 && (
                <div className="banner warn" style={{ marginTop: 10 }}>
                  {preview.missing_offsite.length} document{preview.missing_offsite.length === 1 ? " is" : "s are"} in
                  neither primary storage nor the offsite copy
                  {preview.mismatched.length > 0 && `, and ${preview.mismatched.length} offsite ${preview.mismatched.length === 1 ? "copy does" : "copies do"} not match the fingerprint on record`}.
                  Restoring will not bring those back — the rest will still be written.
                </div>
              )}
              {preview.restored === 0 && unrecoverable === 0 && (
                <div className="banner ok" style={{ marginTop: 10 }}>
                  Nothing to restore: every document this tenant&rsquo;s database expects is already
                  in primary storage.
                </div>
              )}
            </div>
          )}
        </>
      )}
    </Modal>
  );
}
