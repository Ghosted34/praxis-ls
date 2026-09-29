/**
 * The small table a 360's tab renders a child collection in — documents,
 * banks, registrations, owners, the client portal's people.
 *
 * Lifted out of party-360.tsx unchanged so a tab built in another file (the
 * Client 360's Portal tab lives in features/portal) draws the SAME table as the
 * tabs beside it: the same border, heading ground and cell padding. A second
 * look for one tab is how a record's sections stop reading as one screen.
 *
 * Desktop only. Pair it with `<ResponsiveList>` and a `<RecordCard>` for the
 * phone, as every 360 tab does (FRONTEND_GUIDE §3.16).
 */
import * as React from "react";
import { tr } from "@/lib/i18n";

export function MiniTable({
  head,
  children,
  empty,
}: {
  head: React.ReactNode;
  children: React.ReactNode;
  empty: boolean;
}) {
  if (empty)
    return <div className="px-3 py-6 text-center micro">{tr("Nothing here yet.")}</div>;
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-muted-foreground">
          <tr>{head}</tr>
        </thead>
        <tbody className="divide-y divide-border">{children}</tbody>
      </table>
    </div>
  );
}

export const Th = ({ children, r }: { children?: React.ReactNode; r?: boolean }) => (
  <th className={`px-3 py-2 font-medium ${r ? "text-right" : "text-left"}`}>
    {children}
  </th>
);

export const Td = ({ children, r }: { children?: React.ReactNode; r?: boolean }) => (
  <td className={`px-3 py-1.5 ${r ? "text-right num" : ""}`}>{children}</td>
);
