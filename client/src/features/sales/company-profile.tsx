import * as React from "react";
import { tenant } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/ui/modal";
import { PageHeader } from "@/components/data-list";
import { HubCrumb, HubTabs } from "@/components/tabbed-hub";
import { ErrorState, LoadingRow } from "@/components/ui/states";
import { pageShell } from "@/lib/layout";
import { ScanAttachment } from "@/components/scan-attachment";
import { dateFmt } from "@/lib/format";
import { errMsg } from "@/lib/use-resource";

type Profile = Record<string, unknown>;
const list = (v: unknown) => (Array.isArray(v) ? v.join(", ") : "");

export function CompanyProfilePage() {
  const [p, setP] = React.useState<Profile | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [suggested, setSuggested] = React.useState<string[]>([]);
  const [pending, setPending] = React.useState<Profile>({});
  const [accepted, setAccepted] = React.useState<Set<string>>(new Set());

  const load = React.useCallback(
    () =>
      tenant<Profile>("/company-profile")
        .then((res: any) => {
          const profile =
            res && typeof res === "object" && "company_profile_id" in res
              ? res
              : res?.data || res;
          setP(profile);
        })
        .catch((e) => setError(errMsg(e))),
    [],
  );

  React.useEffect(() => {
    void load();
  }, [load]);

  const field = (key: string, value: unknown) =>
    setP((x) => ({ ...x!, [key]: value }));

  function jsonField(key: string, value: string) {
    try {
      field(key, JSON.parse(value));
    } catch (_error) {
      /* retain the last valid structured value */
    }
  }

  const parseArrayField = (val: unknown): string[] => {
    if (Array.isArray(val)) return val.map((x) => String(x).trim()).filter(Boolean);
    if (typeof val === "string") return val.split(",").map((x) => x.trim()).filter(Boolean);
    return [];
  };

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await tenant("/company-profile", {
        method: "PUT",
        body: {
          slogan: p?.slogan || null,
          positioning: p?.positioning || null,
          operating_regions: parseArrayField(p?.operating_regions),
          gateways: parseArrayField(p?.gateways),
          memberships: parseArrayField(p?.memberships),
          certifications: parseArrayField(p?.certifications),
          service_promises: Array.isArray(p?.service_promises)
            ? p.service_promises
            : [],
          projects: Array.isArray(p?.projects) ? p.projects : [],
          source_document_id: p?.source_document_id || null,
        },
      });
      await load();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  async function refresh() {
    setBusy(true);
    try {
      await tenant("/company-profile/refresh", { method: "POST" });
      await load();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  if (!p && !error) return <LoadingRow />;

  return (
    <section className={pageShell.wide}>
      <PageHeader
        eyebrow={<HubCrumb area="Sales & CRM" to="/sales" />}
        title="Company profile"
        description="Declared facts and SQL-derived operating evidence used to ground proposals."
        action={
          <Button onClick={refresh} loading={busy}>
            Refresh derived facts
          </Button>
        }
      />
      <HubTabs />
      {error && <ErrorState message={error} />}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="lux-card space-y-3 p-4">
          <Field label="Slogan">
            <Input
              value={String(p?.slogan || "")}
              onChange={(e) => field("slogan", e.target.value)}
            />
          </Field>
          <Field label="Positioning">
            <Textarea
              value={String(p?.positioning || "")}
              onChange={(e) => field("positioning", e.target.value)}
              rows={5}
            />
          </Field>
          {[
            "operating_regions",
            "gateways",
            "memberships",
            "certifications",
          ].map((k) => (
            <Field key={k} label={k.replace(/_/g, " ")} hint="Comma separated">
              <Input
                value={
                  typeof p?.[k] === "string"
                    ? String(p[k])
                    : list(p?.[k])
                }
                onChange={(e) => field(k, e.target.value)}
              />
            </Field>
          ))}
          {["service_promises", "projects"].map((k) => (
            <Field
              key={k}
              label={k.replace(/_/g, " ")}
              hint="Structured JSON; extracted values still require confirmation"
            >
              <Textarea
                value={JSON.stringify(p?.[k] ?? [], null, 2)}
                rows={5}
                onChange={(e) => jsonField(k, e.target.value)}
              />
            </Field>
          ))}
          <Field
            label="Company profile PDF"
            hint="Upload a profile, copy the extracted facts into the same fields above, then confirm them."
          >
            <ScanAttachment
              vaultId={
                p?.source_document_id ? String(p.source_document_id) : null
              }
              docType="ENTITY_DOCUMENT"
              entityRef={`company_profile:${String(p?.company_profile_id ?? "tenant")}`}
              onAttached={async (id) => {
                field("source_document_id", id);
                setBusy(true);
                try {
                  const result = await tenant<{ suggestions: Profile }>(
                    "/company-profile/extract",
                    { method: "POST", body: { document_id: id } },
                  );
                  const suggestions =
                    (result && "suggestions" in result
                      ? result.suggestions
                      : (result as any)?.data?.suggestions) || {};
                  setP((current) => ({
                    ...current!,
                    source_document_id: id,
                  }));
                  setPending(suggestions);
                  setSuggested(Object.keys(suggestions));
                  setAccepted(new Set(Object.keys(suggestions)));
                } catch (e) {
                  setError(errMsg(e));
                } finally {
                  setBusy(false);
                }
              }}
              onError={(e) => setError(e)}
            />
          </Field>
          {suggested.length > 0 && (
            <div
              className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm"
              role="status"
            >
              <p className="font-medium">Review extracted suggestions</p>
              {suggested.map((key) => (
                <label key={key} className="mt-2 flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={accepted.has(key)}
                    onChange={(e) =>
                      setAccepted((old) => {
                        const next = new Set(old);
                        if (e.target.checked) next.add(key);
                        else next.delete(key);
                        return next;
                      })
                    }
                  />
                  <span>
                    <strong>{key.replace(/_/g, " ")}</strong>:{" "}
                    {typeof pending[key] === "string"
                      ? String(pending[key])
                      : JSON.stringify(pending[key])}
                  </span>
                </label>
              ))}
              <Button
                className="mt-3"
                size="sm"
                onClick={() => {
                  setP((current) => ({
                    ...current!,
                    ...Object.fromEntries(
                      [...accepted].map((key) => [key, pending[key]]),
                    ),
                  }));
                  setSuggested([]);
                }}
              >
                Apply selected fields
              </Button>
            </div>
          )}
          <Button onClick={save} loading={busy}>
            Save and confirm
          </Button>
        </div>
        <div className="lux-card p-4">
          <p className="text-sm text-muted-foreground">
            As of {p?.computed_at ? dateFmt(p.computed_at) : "not computed"}
          </p>
          <dl className="mt-4 grid grid-cols-2 gap-4">
            <div>
              <dt>Active fleet</dt>
              <dd className="text-2xl font-semibold">
                {String(p?.fleet_count ?? 0)}
              </dd>
            </div>
            <div>
              <dt>Warehouse capacity</dt>
              <dd className="text-2xl font-semibold">
                {String(p?.warehouse_capacity ?? 0)}
              </dd>
            </div>
            <div>
              <dt>Clients</dt>
              <dd className="text-2xl font-semibold">
                {String(p?.client_count ?? 0)}
              </dd>
            </div>
            <div>
              <dt>Turnover band</dt>
              <dd className="text-2xl font-semibold">
                {String(p?.turnover_band ?? "—")}
              </dd>
            </div>
          </dl>
        </div>
      </div>
    </section>
  );
}
}
