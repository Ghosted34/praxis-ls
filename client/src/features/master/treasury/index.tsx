/**
 * Master data → Treasury — the rich master-detail replacement for the old
 * flat "Bank accounts" table under Settings.
 *
 * The left rail is the list of treasury accounts (Bank / Cash / Petty Cash /
 * MTN MoMo / Orange Money / anything the treasurer added). Right rail is the
 * full 360 dossier. Same shape as Corporate entities and the Client / Supplier
 * masters, so the shell is a `SplitPane` with the same `storageKey` semantics.
 *
 * Above the list, a compact bar shows the category chips (with counts) and a
 * "+ New category" that opens the NewCategoryModal without leaving the page —
 * critical for the "Airtel arrives with SmartCash and we add it in five
 * seconds" flow.
 */
import * as React from "react";
import { tr } from "@/lib/i18n";
import { useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Pill, type Tone } from "@/components/ui/pill";
import { EmptyState, ErrorState, LoadingRow } from "@/components/ui/states";
import { SplitPane } from "@/components/ui/split-pane";
import { PageHeader } from "@/components/data-list";
import { HubCrumb, HubTabs } from "@/components/tabbed-hub";
import { pageShell } from "@/lib/layout";
import { useList, useRefresh, errMsg } from "@/lib/use-resource";
import { cell } from "@/lib/format";
import * as api from "@/lib/treasury-api";
import { TreasuryDossier } from "./dossier";
import { NewAccountModal } from "./new-account-modal";
import { NewCategoryModal } from "./new-category-modal";

const KIND_TONE: Record<string, Tone> = {
  BANK: "blue",
  CASH: "ok",
  MOMO: "orange",
};

export function TreasuryMasterPage() {
  const reload = useRefresh();
  const { rows, error, loading } =
    useList<api.TreasuryAccountRich>("/treasury-accounts");
  const [cats, setCats] = React.useState<api.TreasuryCategory[] | null>(null);
  const [catFilter, setCatFilter] = React.useState<string>("");
  const [q, setQ] = React.useState("");
  const [selId, setSelId] = React.useState<string | null>(null);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [newCatOpen, setNewCatOpen] = React.useState(false);
  const [rowError, setRowError] = React.useState<string | null>(null);
  const [params, setParams] = useSearchParams();

  React.useEffect(() => {
    let cancelled = false;
    api
      .listCategories()
      .then((r) => {
        if (!cancelled) setCats(r);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const accts = React.useMemo(() => rows || [], [rows]);
  const filtered = React.useMemo(() => {
    let out = accts;
    if (catFilter) out = out.filter((a) => a.category_id === catFilter);
    if (q) {
      const needle = q.toLowerCase();
      out = out.filter((a) =>
        `${a.label} ${a.bank_name || ""} ${a.iban || ""} ${a.momo_number || ""} ${a.category_label || ""}`
          .toLowerCase()
          .includes(needle),
      );
    }
    return out;
  }, [accts, catFilter, q]);

  React.useEffect(() => {
    if (!selId && filtered.length) setSelId(filtered[0].treasury_account_id);
  }, [filtered, selId]);

  // /master/treasury-accounts?open=<id> deep-links from other screens.
  const openId = params.get("open");
  React.useEffect(() => {
    if (!openId) return;
    setSelId(openId);
    params.delete("open");
    setParams(params, { replace: true });
  }, [openId, params, setParams]);

  const countByCat = React.useMemo(() => {
    const m: Record<string, number> = {};
    for (const a of accts)
      if (a.category_id) m[a.category_id] = (m[a.category_id] || 0) + 1;
    return m;
  }, [accts]);

  const selected =
    filtered.find((a) => a.treasury_account_id === selId) || null;

  return (
    <section className={pageShell.wide}>
      <PageHeader
        eyebrow={<HubCrumb area="Master data" to="/master" />}
        title="Treasury"
        description="Bank, cash, petty-cash and mobile-money accounts. Every account owns an auto-minted class-5 CoA leaf, so balances, statements and reconciliation come from one source of truth."
        action={
          <Button onClick={() => setCreateOpen(true)}>{tr("New account")}</Button>
        }
      />
      <HubTabs />

      {/* Category chips + "+ New category" */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-card p-3">
        <button
          onClick={() => setCatFilter("")}
          className={`rounded-full px-3 py-1 text-xs ${catFilter === "" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}
        >
          All ({accts.length})
        </button>
        {(cats || [])
          .filter((c) => c.is_active)
          .map((c) => (
            <button
              key={c.treasury_category_id}
              onClick={() => setCatFilter(c.treasury_category_id)}
              className={`rounded-full px-3 py-1 text-xs ${catFilter === c.treasury_category_id ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}
            >
              {c.label} ({countByCat[c.treasury_category_id] || 0})
            </button>
          ))}
        <div className="ml-auto">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setNewCatOpen(true)}
          >
            + New category
          </Button>
        </div>
      </div>

      {rowError && <ErrorState message={rowError} />}

      {error ? (
        <ErrorState message={error} />
      ) : (
        <SplitPane
          storageKey="master.treasury-accounts"
          label="Treasury list width"
          defaultSize={320}
          min={260}
          max={480}
        >
          <div className="space-y-2">
            <Input
              placeholder="Search label / IBAN / MoMo…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <div className="max-h-[70vh] space-y-1 overflow-auto rounded-lg border p-1">
              {loading ? (
                <LoadingRow label="Loading accounts…" />
              ) : filtered.length === 0 ? (
                <div className="p-3">
                  <EmptyState
                    title="No accounts"
                    hint={
                      catFilter
                        ? "No accounts in this category yet."
                        : "Add a bank, cash, petty-cash or mobile-money account."
                    }
                  />
                </div>
              ) : (
                filtered.map((a) => {
                  const id = a.treasury_account_id;
                  const sel = id === selId;
                  return (
                    <button
                      key={id}
                      onClick={() => setSelId(id)}
                      className={`flex w-full flex-col gap-1 rounded-md px-3 py-2 text-left text-sm transition-colors ${sel ? "bg-primary/10 text-foreground" : "hover:bg-muted"}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="min-w-0 truncate font-medium">
                          {cell(a.label)}
                        </span>
                        <div className="flex shrink-0 items-center gap-1">
                          {a.is_primary && <Pill tone="blue">★</Pill>}
                          {a.is_verified ? (
                            <Pill tone="ok">✓</Pill>
                          ) : (
                            <Pill tone="warn">?</Pill>
                          )}
                          <Pill tone={KIND_TONE[a.kind] || "mute"}>
                            {a.kind}
                          </Pill>
                        </div>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="micro text-muted-foreground truncate">
                          {a.category_label || "—"} ·{" "}
                          <code className="rounded bg-muted px-1">
                            {cell(a.coa_code)}
                          </code>
                        </span>
                        <span className="micro text-muted-foreground shrink-0">
                          {cell(a.currency)}
                        </span>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>
          {selected ? (
            <TreasuryDossier
              id={selected.treasury_account_id}
              onChanged={reload}
            />
          ) : (
            <EmptyState
              title="No account selected"
              hint="Pick an account from the list to see its 360."
            />
          )}
        </SplitPane>
      )}

      <NewAccountModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(created) => {
          reload();
          setSelId(created.treasury_account_id);
        }}
      />
      <NewCategoryModal
        open={newCatOpen}
        onClose={() => setNewCatOpen(false)}
        onCreated={async () => {
          try {
            const r = await api.listCategories();
            setCats(r);
          } catch (e) {
            setRowError(errMsg(e));
          }
        }}
      />
    </section>
  );
}

// Re-export the dossier route wrapper for the deep-link path.
export { TreasuryDossierPage } from "./dossier";
