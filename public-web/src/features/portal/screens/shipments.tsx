/**
 * Shipments — every file we are moving for them, as cards.
 *
 * Two lists, one switch: on the move, and delivered. A search box narrows by
 * reference, place or vessel as they type — a client with forty files is
 * looking for ONE, and usually knows a word of it.
 */
import * as React from "react";
import { useTranslation } from "react-i18next";
import { portalShipments, type ShipmentCard } from "@/lib/portal-api";
import { getLang } from "@/lib/i18n";
import { usePageChrome, PageHeader } from "../shell/portal-shell";
import { Seg, SkeletonCards, EmptyState, ErrorCard, useLoad } from "../ui/kit";
import { ShipIcon, SearchIcon, CloseIcon } from "../ui/icons";
import { ShipmentCardView } from "./shipment-parts";

type Which = "active" | "done";

const matches = (s: ShipmentCard, q: string) =>
  [s.ref, s.title, s.service, s.origin, s.destination, s.conveyance, s.transport_ref, s.current_step]
    .filter(Boolean)
    .some((v) => String(v).toLowerCase().includes(q));

export function ShipmentsPage() {
  const { t } = useTranslation();
  usePageChrome(null);
  const lang = getLang();
  const [which, setWhich] = React.useState<Which>("active");
  const [q, setQ] = React.useState("");
  const list = useLoad(() => portalShipments(which, lang), `ships:${which}:${lang}`);
  const query = q.trim().toLowerCase();
  const shown = (list.data || []).filter((s) => !query || matches(s, query));

  return (
    <div>
      <PageHeader title={t("portal.nav.shipments")} />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Seg<Which>
          label={t("portal.ship.filter")}
          value={which}
          onChange={setWhich}
          items={[
            { value: "active", label: t("portal.ship.active") },
            { value: "done", label: t("portal.ship.delivered") },
          ]}
        />
        <div className="relative sm:w-72">
          <SearchIcon size={18} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            className="pt-field !min-h-[44px] !rounded-full !py-2 pl-11 pr-11"
            placeholder={t("portal.ship.search")}
            aria-label={t("portal.ship.search")}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          {q ? (
            <button type="button" className="absolute right-1.5 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full text-muted-foreground" aria-label={t("portal.common.clear")} onClick={() => setQ("")}>
              <CloseIcon size={16} />
            </button>
          ) : null}
        </div>
      </div>

      {list.error && !list.data ? <ErrorCard message={list.error} onRetry={list.reload} /> : null}
      {!list.data && !list.error ? <SkeletonCards count={4} /> : null}
      {list.data ? (
        shown.length ? (
          <div className="grid gap-3 md:grid-cols-2">
            {shown.map((s) => (
              <ShipmentCardView key={s.dossier_id} s={s} />
            ))}
          </div>
        ) : (
          <div className="pt-card">
            <EmptyState
              icon={<ShipIcon size={28} />}
              title={query ? t("portal.ship.noMatch") : which === "active" ? t("portal.ship.noneActive") : t("portal.ship.noneDone")}
            />
          </div>
        )
      ) : null}
    </div>
  );
}
