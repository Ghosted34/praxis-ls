/**
 * THE PHONE SHELLS — the three mobile fixes, side by side, in the real
 * components.
 *
 * SET THE WORKBENCH WIDTH TO "phone" (390) before reading this story. Every
 * branch below is chosen by a real media query, not by a prop, so at 1280 the
 * same story shows the desktop shell — which is the point: one story proves
 * both, and neither is a mock-up that can drift from what ships.
 *
 * WHAT IT SHOWS
 *
 *   1. The KPI band, once a column of 208px tiles (`basis-[13rem]` is a
 *      VERTICAL basis in a `flex-col` row), now a two-up grid of cards with the
 *      brand-blue data edge.
 *   2. The section strip, once four wrapped rows of buttons, now one scrollable
 *      row with the active section centred and its counts badged.
 *   3. A document card, where six wrapped controls used to be: one visible
 *      action plus `⋯`.
 */
import * as React from "react";

import { KpiRow, KpiTile } from "./kpi-tile";
import { SectionTabs } from "./section-tabs";
import { ResponsiveList, RecordCard } from "./responsive-list";
import { ScanCardActions } from "@/components/scan-attachment";
import { DropdownItem, DropdownSeparator } from "./dropdown-menu";
import { Pill } from "./pill";

const ENTITY_TABS = [
  "Overview",
  "Identity & registrations",
  "Documents",
  "Tax & jurisdiction",
  "People & shareholding",
  "Contacts & addresses",
  "Structure",
  "Banking & treasury",
  "Letterhead",
  "Renewals",
  "Working calendar",
  "Public story",
] as const;

const DOCUMENTS = [
  {
    id: "d1",
    title: "Certificate of incorporation",
    type: "RCCM",
    number: "RC/DLA/2021/B/1234",
    country: "CM",
    expires: "—",
    scan: "SCANNED",
    verification: "VERIFIED",
    vaultId: "vault-1",
  },
  {
    id: "d2",
    title: "Tax clearance 2026",
    type: "Tax clearance",
    number: "M1021165575B",
    country: "CM",
    expires: "31/03/2027",
    scan: "PENDING",
    verification: "PENDING",
    vaultId: null as string | null,
  },
];

const SCAN_TONE: Record<string, "blue" | "ok" | "warn"> = {
  SCANNED: "blue",
  VERIFIED: "ok",
  PENDING: "warn",
};

/** One document — the phone card, or the table row it replaces. */
function DocumentRow({ doc }: { doc: (typeof DOCUMENTS)[number] }) {
  const card = (
    <RecordCard
      leading={
        <input type="checkbox" className="h-4 w-4 accent-primary" aria-label={`Select ${doc.title}`} />
      }
      title={doc.title}
      subtitle={doc.type}
      pills={
        <>
          <Pill tone={SCAN_TONE[doc.scan] || "mute"}>{doc.scan}</Pill>
          <Pill tone={doc.verification === "VERIFIED" ? "ok" : "warn"}>
            {doc.verification}
          </Pill>
        </>
      }
      meta={[
        ["Number", doc.number],
        ["Country", doc.country],
        ["Expires", doc.expires],
      ]}
      actions={
        <ScanCardActions
          vaultId={doc.vaultId}
          docType="ENTITY_DOCUMENT"
          entityRef={`entity_document:${doc.id}`}
          onAttached={() => {}}
          menuLabel="Document actions"
          menuItems={
            <>
              {doc.vaultId && doc.verification !== "VERIFIED" && (
                <DropdownItem onSelect={() => {}}>Verify</DropdownItem>
              )}
              <DropdownItem onSelect={() => {}}>Edit</DropdownItem>
              <DropdownSeparator />
              <DropdownItem destructive onSelect={() => {}}>
                Remove
              </DropdownItem>
            </>
          }
        />
      }
    />
  );

  return (
    <ResponsiveList items={[doc]} renderItem={() => card}>
      <table className="w-full text-sm">
        <tbody>
          <tr className="border-b">
            <td className="px-3 py-2">
              <input
                type="checkbox"
                className="h-4 w-4 accent-primary"
                aria-label={`Select ${doc.title}`}
              />
            </td>
            <td className="px-3 py-2 font-medium">{doc.title}</td>
            <td className="px-3 py-2">{doc.type}</td>
            <td className="px-3 py-2 num">{doc.number}</td>
            <td className="px-3 py-2">{doc.country}</td>
            <td className="px-3 py-2">{doc.expires}</td>
            <td className="px-3 py-2">
              <Pill tone={SCAN_TONE[doc.scan] || "mute"}>{doc.scan}</Pill>
            </td>
            <td className="px-3 py-2">
              <Pill tone={doc.verification === "VERIFIED" ? "ok" : "warn"}>
                {doc.verification}
              </Pill>
            </td>
            <td className="px-3 py-2 text-right whitespace-nowrap">
              View · Replace · Verify · Edit · Remove
            </td>
          </tr>
        </tbody>
      </table>
    </ResponsiveList>
  );
}

export const MobileShells = () => {
  const [tab, setTab] = React.useState<string>("Documents");
  return (
    <div className="space-y-8">
      <section>
        <p className="mb-2 text-sm font-semibold">
          1 · KPI band — a two-up grid below `md`
        </p>
        <KpiRow stack>
          <KpiTile
            label="Shareholders"
            value="1"
            icon={<span className="text-[11px]">◆</span>}
            onClick={() => {}}
          />
          <KpiTile label="Ownership recorded" value="100%" hint="Balanced" />
          <KpiTile label="Employees" value="3" onClick={() => {}} />
          <KpiTile label="Subsidiaries" value="0" onClick={() => {}} />
          <KpiTile label="Journal entries" value="128" onClick={() => {}} />
        </KpiRow>
      </section>

      <section>
        <p className="mb-2 text-sm font-semibold">
          2 · Section strip — one row, scrolled, active centred
        </p>
        <SectionTabs
          label="Entity sections"
          value={tab}
          onChange={setTab}
          tabs={ENTITY_TABS.map((t) => ({ value: t, label: t }))}
        />
        <p className="mt-4 text-sm text-muted-foreground">
          Showing <span className="font-semibold text-foreground">{tab}</span>.
          Swipe the strip; the fades say which way the rest is.
        </p>
      </section>

      <section>
        <p className="mb-2 text-sm font-semibold">
          3 · Document rows — a table on a desktop, cards on a phone
        </p>
        <div className="space-y-2">
          {DOCUMENTS.map((d) => (
            <DocumentRow key={d.id} doc={d} />
          ))}
        </div>
      </section>
    </div>
  );
};
