/**
 * Settings › Website › Partners — carriers, clients, memberships and
 * credentials.
 *
 * ── THREE CLAIMS, NOT A LOGO WALL ──────────────────────────────────────────
 *
 * `kind` is the first field on the form because it is the most consequential.
 * A carrier, a client and a network membership assert three different things,
 * and the public site renders each differently — carriers on the corridor map
 * at the lane they serve, clients as a quiet band, memberships in the
 * credentials strip. `doc/WEB_BUILD_BRIEF.md` N11 forbids the undifferentiated
 * "trusted by" wall, and this field is how that stays true.
 *
 * ── THE PERMISSION NOTE IS A GATE, AND THE SCREEN SAYS SO ─────────────────
 *
 * These are other companies' trademarks. GIZ is a German federal agency and
 * CMA CGM operates a written-permission regime; showing a carrier's mark can
 * additionally imply an agency relationship the tenant does not have.
 *
 * So "show on the website" is disabled until somebody records who cleared the
 * mark. Not a warning that can be clicked past — the control is unavailable,
 * the reason is written beside it, and if it were somehow bypassed the API
 * refuses and a CHECK constraint refuses again. Three layers, because the cost
 * of the check is nil and the cost of publishing an uncleared mark is a letter
 * from someone's counsel.
 *
 * ── EXPIRY IS SURFACED, NOT HIDDEN ─────────────────────────────────────────
 *
 * An expired licence number presented as current is the single most damaging
 * thing a forwarder can publish. The public read already filters them out; this
 * screen shows the tenant WHICH ones lapsed, because silently disappearing from
 * their own site is the other way to lose their trust.
 */
import * as React from "react";
import { PageHeader } from "@/components/data-list";
import { HubCrumb } from "@/components/tabbed-hub";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { DateField } from "@/components/ui/date-field";
import { Input } from "@/components/ui/input";
import { Pill } from "@/components/ui/pill";
import { SettingsCard, Field } from "@/components/settings/controls";
import { ErrorState } from "@/components/ui/states";
import { tr } from "@/lib/i18n";
import { errMsg } from "@/lib/use-resource";
import * as api from "@/lib/site-settings-api";
import { WebsiteNav } from "./website-nav";
import { AssetSlotField } from "./website-assets";

const KIND_HELP: Record<api.PartnerKind, string> = {
  carrier: "We move cargo on these lines — a capability.",
  client: "These organisations trust us — a reference.",
  network: "We are a member of this — a membership.",
};

const today = () => new Date().toISOString().slice(0, 10);
const isExpired = (c: api.Credential) =>
  Boolean(c.expires_on && String(c.expires_on).slice(0, 10) < today());

/**
 * The expiry cell of a credential row — day-first, saved on blur like its
 * neighbours.
 *
 * The other fields on this row are uncontrolled (`defaultValue` + `onBlur`),
 * which `DateField` cannot be: what it displays (dd/mm/yyyy) and what it stores
 * (ISO) are two different strings, so there is nothing a single `defaultValue`
 * could seed that stays in step with both. Holding the ISO here is the whole
 * difference, and the save still happens when the operator leaves the field.
 */
function CredentialExpiry({
  credential,
  onSave,
}: {
  credential: api.Credential;
  onSave: (expiresOn: string | null) => void;
}) {
  const initial = credential.expires_on
    ? String(credential.expires_on).slice(0, 10)
    : "";
  const [value, setValue] = React.useState(initial);

  return (
    <DateField
      value={value}
      onChange={setValue}
      onBlur={() => value !== initial && onSave(value || null)}
    />
  );
}

export function WebsitePartnersPage() {
  const [partners, setPartners] = React.useState<api.Partner[] | null>(null);
  const [creds, setCreds] = React.useState<api.Credential[] | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(() => {
    Promise.all([api.listPartners(), api.listCredentials()])
      .then(([p, c]) => {
        setPartners(p);
        setCreds(c);
        setLoadError(null);
      })
      .catch((e) => setLoadError(errMsg(e)));
  }, []);

  React.useEffect(load, [load]);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setActionError(null);
    try {
      await fn();
      load();
    } catch (e) {
      setActionError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  if (loadError) {
    return (
      <ErrorState message={loadError} action={<Button onClick={load}>{tr("Try again")}</Button>} />
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={<HubCrumb area="Settings" to="/settings" />}
        title={tr("Partners and credentials")}
        description={tr(
          "Carriers, clients and memberships, and the certifications you publish.",
        )}
        action={
          <Button
            onClick={() =>
              run(() => api.createPartner({ name: tr("New partner"), kind: "client" }))
            }
            disabled={busy}
          >
            {tr("Add partner")}
          </Button>
        }
      />
      <WebsiteNav />

      {actionError && (
        <Callout tone="bad" title={tr("Not saved")}>
          {actionError}
        </Callout>
      )}

      <SettingsCard
        title={tr("Partners and clients")}
        desc={tr(
          "A mark cannot be shown until you record who cleared it. These are other companies' trademarks.",
        )}
      >
        {!partners?.length ? (
          <p className="text-sm text-muted-foreground">{tr("None yet.")}</p>
        ) : (
          <ul className="space-y-4">
            {partners.map((p) => (
              <li key={p.partner_id} className="rounded-lg border border-[var(--border)] p-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label={tr("Name")}>
                    <Input
                      defaultValue={p.name}
                      onBlur={(e) =>
                        e.target.value !== p.name &&
                        run(() => api.updatePartner(p.partner_id, { name: e.target.value }))
                      }
                    />
                  </Field>
                  <Field label={tr("What this claims")}>
                    <select
                      className="h-9 w-full rounded-md border border-input bg-card px-2 text-sm"
                      value={p.kind}
                      onChange={(e) =>
                        run(() =>
                          api.updatePartner(p.partner_id, {
                            kind: e.target.value as api.PartnerKind,
                          }),
                        )
                      }
                      aria-label={tr("What this claims")}
                    >
                      <option value="carrier">{tr("Carrier")}</option>
                      <option value="client">{tr("Client")}</option>
                      <option value="network">{tr("Network membership")}</option>
                    </select>
                    <p className="text-xs text-muted-foreground">{tr(KIND_HELP[p.kind])}</p>
                  </Field>
                </div>

                <div className="mt-3">
                  <AssetSlotField
                    slot="partner-mark"
                    ownerId={p.partner_id}
                    currentId={p.logo_vault_id ?? null}
                    disabled={busy}
                    onChange={load}
                  />
                </div>

                <div className="mt-3">
                  <Field label={tr("Who cleared this mark, and when")}>
                    <Input
                      defaultValue={p.permission_note ?? ""}
                      placeholder={tr("Written clearance by email, 12 March 2026")}
                      onBlur={(e) =>
                        e.target.value !== (p.permission_note ?? "") &&
                        run(() =>
                          api.updatePartner(p.partner_id, { permission_note: e.target.value }),
                        )
                      }
                    />
                  </Field>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <Button
                    size="sm"
                    variant={p.is_active ? "outline" : "default"}
                    // Disabled, not warned. The reason sits beside it.
                    disabled={busy || (!p.is_active && !String(p.permission_note || "").trim())}
                    onClick={() =>
                      run(() => api.updatePartner(p.partner_id, { is_active: !p.is_active }))
                    }
                  >
                    {p.is_active ? tr("Hide from website") : tr("Show on website")}
                  </Button>
                  {p.is_active ? (
                    <Pill tone="ok">{tr("Shown")}</Pill>
                  ) : (
                    <Pill>{tr("Not shown")}</Pill>
                  )}
                  {!p.is_active && !String(p.permission_note || "").trim() && (
                    <span className="text-xs text-muted-foreground">
                      {tr("Record who cleared it before showing it.")}
                    </span>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => run(() => api.deletePartner(p.partner_id))}
                  >
                    {tr("Remove")}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </SettingsCard>

      <SettingsCard
        title={tr("Certifications and licences")}
        desc={tr(
          "Earned, dated and verifiable — the most persuasive thing on a forwarder's site. An expired one is removed from the site automatically.",
        )}
      >
        <div className="mb-4">
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => run(() => api.createCredential({ name: tr("New certification") }))}
          >
            {tr("Add certification")}
          </Button>
        </div>
        {!creds?.length ? (
          <p className="text-sm text-muted-foreground">{tr("None yet.")}</p>
        ) : (
          <ul className="space-y-4">
            {creds.map((c) => (
              <li key={c.credential_id} className="rounded-lg border border-[var(--border)] p-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label={tr("Name")}>
                    <Input
                      defaultValue={c.name}
                      onBlur={(e) =>
                        e.target.value !== c.name &&
                        run(() => api.updateCredential(c.credential_id, { name: e.target.value }))
                      }
                    />
                  </Field>
                  <Field label={tr("Issued by")}>
                    <Input
                      defaultValue={c.issuer ?? ""}
                      onBlur={(e) =>
                        run(() => api.updateCredential(c.credential_id, { issuer: e.target.value }))
                      }
                    />
                  </Field>
                  <Field label={tr("Reference number")}>
                    <Input
                      defaultValue={c.identifier ?? ""}
                      onBlur={(e) =>
                        run(() =>
                          api.updateCredential(c.credential_id, { identifier: e.target.value }),
                        )
                      }
                    />
                  </Field>
                  <Field label={tr("Expires")}>
                    <CredentialExpiry
                      credential={c}
                      onSave={(expiresOn) =>
                        run(() =>
                          api.updateCredential(c.credential_id, {
                            expires_on: expiresOn,
                          }),
                        )
                      }
                    />
                  </Field>
                </div>
                <div className="mt-3">
                  <AssetSlotField
                    slot="credential-mark"
                    ownerId={c.credential_id}
                    currentId={c.logo_vault_id ?? null}
                    disabled={busy}
                    onChange={load}
                  />
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-3">
                  {isExpired(c) ? (
                    <Pill tone="bad">{tr("Expired — not shown on the site")}</Pill>
                  ) : c.is_active ? (
                    <Pill tone="ok">{tr("Shown")}</Pill>
                  ) : (
                    <Pill>{tr("Not shown")}</Pill>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => run(() => api.deleteCredential(c.credential_id))}
                  >
                    {tr("Remove")}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </SettingsCard>
    </div>
  );
}
