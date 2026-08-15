/**
 * The shared primitives, every state, both themes.
 *
 * F15 listed "component workbench" and "usage examples per primitive" as
 * missing, and the audit's Phase 2 deliverable is "every primitive, all states
 * (default/hover/focus/disabled/loading/error), light + dark".
 *
 * Focus and hover are not separate stories — they are states of the controls
 * below, reachable by tabbing and pointing, which is the honest way to check
 * them. Use Ladle's theme toggle for light/dark; every story is written to be
 * legible in both.
 */
import * as React from "react";

import { Button } from "./button";
import { Input } from "./input";
import { Textarea } from "./textarea";
import { Field, Modal } from "./modal";
import { Dialog, ConfirmDialog } from "./dialog";
import { Select, NativeSelect } from "./select";
import { Checkbox, RadioGroup } from "./checkbox";
import { Segmented } from "./segmented";
import { Chips } from "./chips";
import { Tabs } from "./tabs";
import {
  DropdownMenu,
  DropdownItem,
  DropdownSeparator,
  DropdownLabel,
} from "./dropdown-menu";
import { Popover } from "./popover";
import { Tooltip } from "./tooltip";
import { Pill, StatusPill, statusTone } from "./pill";
import { Stat } from "./stat";
import { Panel } from "./panel";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "./card";
import { Avatar } from "./avatar";
import { EmptyState, ErrorState, LoadingRow, Spinner } from "./states";
import { Pagination } from "./pagination";
import { ErrorBoundary } from "./error-boundary";
import { useToast } from "./toast";
import { DataView } from "./data-view";
import { FormButtons } from "./form-buttons";
import { KpiRow, KpiTile } from "./kpi-tile";
import { SearchSelect } from "./search-select";

/** Consistent scaffolding so a story reads as "here is the thing, in each state". */
function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-6">
      <p className="mb-2 text-micro uppercase text-muted-foreground">{label}</p>
      <div className="flex flex-wrap items-start gap-3">{children}</div>
    </div>
  );
}

/* ────────────────────────────────── Button ───────────────────────────────── */

export const Buttons = () => (
  <>
    <Row label="Variants">
      <Button>Primary</Button>
      <Button variant="outline">Outline</Button>
      <Button variant="ghost">Ghost</Button>
    </Row>
    <Row label="Loading">
      <Button loading>Saving</Button>
      <Button variant="outline" loading>
        Exporting
      </Button>
    </Row>
    <Row label="Disabled">
      <Button disabled>Primary</Button>
      <Button variant="outline" disabled>
        Outline
      </Button>
    </Row>
    <Row label="Focus — tab into these">
      <Button>First</Button>
      <Button variant="outline">Second</Button>
    </Row>
  </>
);

/* ─────────────────────────────── Form controls ───────────────────────────── */

export const FormControls = () => {
  const [checked, setChecked] = React.useState(false);
  const [radio, setRadio] = React.useState("BANK");
  const [sel, setSel] = React.useState("");

  return (
    <div className="max-w-reading space-y-5">
      <Row label="Field — the 565-site label association fix (F4)">
        <div className="w-full space-y-4">
          <Field label="Client">
            <Input placeholder="Acme Logistics" />
          </Field>
          <Field label="Amount" required hint="Excluding TVA.">
            <Input inputMode="decimal" defaultValue="1500.00" />
          </Field>
          <Field label="Amount" required error="Must be greater than zero.">
            <Input inputMode="decimal" defaultValue="0" />
          </Field>
          <Field label="Reference" hint="Disabled while the period is closed.">
            <Input disabled defaultValue="INV-2026-0041" />
          </Field>
          <Field label="Narration" hint="Appears on the journal entry.">
            <Textarea
              rows={3}
              placeholder="Freight forwarding, Douala–Yaoundé"
            />
          </Field>
        </div>
      </Row>

      <Row label="Select — native (default) and Radix (rich options)">
        <div className="w-full space-y-4">
          <Field label="Currency" required>
            <NativeSelect defaultValue="XAF">
              <option value="XAF">XAF</option>
              <option value="EUR">EUR</option>
            </NativeSelect>
          </Field>
          <Field label="Status">
            <Select
              value={sel}
              onValueChange={setSel}
              placeholder="Any status"
              options={[
                {
                  value: "OPEN",
                  label: <Pill tone="blue">Open</Pill>,
                  text: "Open",
                },
                {
                  value: "WON",
                  label: <Pill tone="ok">Won</Pill>,
                  text: "Won",
                },
                {
                  value: "LOST",
                  label: <Pill tone="bad">Lost</Pill>,
                  text: "Lost",
                },
              ]}
            />
          </Field>
          <Field label="Client (server-backed typeahead)">
            <SearchSelect
              path="/clients"
              label="Client"
              placeholder="Search clients…"
              getKey={(r) => String(r.client_id)}
              getLabel={(r) => String(r.name)}
              onSelect={() => {}}
            />
          </Field>
        </div>
      </Row>

      <Row label="Checkbox and RadioGroup">
        <div className="w-full space-y-4">
          <Checkbox
            checked={checked}
            onCheckedChange={setChecked}
            label="Include resolved"
            hint="Adds closed flags."
          />
          <Checkbox
            checked="indeterminate"
            onCheckedChange={() => {}}
            label="Select all rows"
          />
          <Checkbox
            checked={false}
            onCheckedChange={() => {}}
            label="Disabled"
            disabled
          />
          <Field label="Payment method" required>
            <RadioGroup
              value={radio}
              onValueChange={setRadio}
              options={[
                { value: "BANK", label: "Bank transfer" },
                {
                  value: "MOMO",
                  label: "Mobile money",
                  hint: "MTN and Orange.",
                },
                { value: "CASH", label: "Cash", disabled: true },
              ]}
            />
          </Field>
        </div>
      </Row>

      <Row label="FormButtons">
        <div className="w-full">
          <FormButtons
            busy={false}
            onCancel={() => {}}
            saveLabel="Create client"
          />
        </div>
      </Row>
      <Row label="FormButtons — saving">
        <div className="w-full">
          <FormButtons busy onCancel={() => {}} saveLabel="Create client" />
        </div>
      </Row>
    </div>
  );
};

/* ─────────────────────────── Selection controls ──────────────────────────── */

export const SelectionControls = () => {
  const [seg, setSeg] = React.useState("open");
  const [solid, setSolid] = React.useState("ledger");
  const [chip, setChip] = React.useState("");

  return (
    <>
      <Row label="Segmented — inset (default). Tab in, then arrow keys.">
        <Segmented
          label="Deal status"
          value={seg}
          onChange={setSeg}
          options={[
            { value: "open", label: "Open" },
            { value: "won", label: "Won" },
            { value: "lost", label: "Lost" },
          ]}
        />
      </Row>
      <Row label="Segmented — solid (page-level view switch)">
        <Segmented
          label="Audit section"
          variant="solid"
          value={solid}
          onChange={setSolid}
          options={[
            { value: "ledger", label: "Ledger" },
            { value: "events", label: "Security events" },
            { value: "reviews", label: "Access reviews", disabled: true },
          ]}
        />
      </Row>
      <Row label="Chips — wrapping filter row with counts">
        <Chips
          label="Filter by status"
          value={chip}
          onChange={setChip}
          options={[
            { value: "", label: "All", count: 128 },
            { value: "draft", label: "Draft", count: 12 },
            { value: "sent", label: "Sent", count: 64 },
            { value: "paid", label: "Paid", count: 52 },
          ]}
        />
      </Row>
    </>
  );
};

/* ───────────────────────────────── Status ────────────────────────────────── */

export const StatusAndData = () => (
  <>
    <Row label="Pill — every tone">
      <Pill tone="ok">Approved</Pill>
      <Pill tone="warn">In review</Pill>
      <Pill tone="bad">Rejected</Pill>
      <Pill tone="blue">Open</Pill>
      <Pill tone="orange">Qualified</Pill>
      <Pill tone="mute">Draft</Pill>
    </Row>
    <Row label="StatusPill — replaces Badge's 27-entry raw-palette map (F14)">
      {[
        "NEW",
        "IN_PROGRESS",
        "QUALIFIED",
        "WON",
        "LOST",
        "DRAFT",
        "SOME_UNKNOWN_STATE",
      ].map((s) => (
        <StatusPill key={s} status={s} />
      ))}
    </Row>
    <Row label="Avatar">
      <Avatar name="Ada Lovelace" />
      <Avatar name="Ada Lovelace" size="sm" />
      <Avatar
        name="Douala Terminal Services"
        title="Douala Terminal Services"
      />
    </Row>
    <Row label="Stat — tone carries meaning, not decoration">
      <div className="grid w-full grid-cols-2 gap-2 xl:grid-cols-4">
        <Stat label="Planned cost" value="12,400,000" />
        <Stat label="Billed" value="9,800,000" tone="ok" />
        <Stat label="Outstanding" value="2,600,000" tone="warn" />
        <Stat label="Overdue" value="450,000" tone="bad" hint="Over 60 days" />
      </div>
    </Row>
    <Row label="KpiRow — the slim strip above a list screen">
      <div className="w-full">
        <KpiRow>
          <KpiTile label="Open dossiers" value="42" />
          <KpiTile label="In transit" value="17" tone="info" />
          <KpiTile label="Delayed" value="3" tone="warn" />
        </KpiRow>
      </div>
    </Row>
    <Row label="DataView — replaces the raw JSON.stringify fallbacks (A4)">
      <div className="w-full space-y-3">
        <DataView
          data={[
            {
              client_id: "c-1",
              total_ttc: 1500000,
              created_at: "2026-03-21T10:30:00Z",
            },
          ]}
        />
        <DataView
          data={{
            report_key: "receivables_ageing",
            montant_ht: 980000,
            niu: "M0123456789",
          }}
        />
        <DataView data={null} emptyTitle="This report returned no rows" />
      </div>
    </Row>
  </>
);

/* ───────────────────────────────── Surfaces ──────────────────────────────── */

export const Surfaces = () => (
  <div className="space-y-4">
    <Card>
      <CardHeader>
        <CardTitle>Receivables ageing</CardTitle>
        <CardDescription>Smart receivables ledger · XAF</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          Card is the one surface. Panel is built on it.
        </p>
      </CardContent>
    </Card>

    <Panel
      title="Cash position"
      subtitle="Treasury · bank · cash · mobile money"
    >
      <p className="text-sm text-muted-foreground">
        Panel replaced six independent copies of this block (A3).
      </p>
    </Panel>

    <Panel
      title="Awaiting your approval"
      action={<Button variant="outline">See all</Button>}
    >
      <p className="text-sm text-muted-foreground">With an action.</p>
    </Panel>
  </div>
);

/* ──────────────────────────────── Overlays ───────────────────────────────── */

export const Overlays = () => {
  const [dialog, setDialog] = React.useState(false);
  const [legacy, setLegacy] = React.useState(false);
  const [confirm, setConfirm] = React.useState(false);

  return (
    <>
      <Row label="Dialog — focus trap + focus restore (F13). Tab around it, then Escape.">
        <Button onClick={() => setDialog(true)}>Open dialog</Button>
        <Button variant="outline" onClick={() => setLegacy(true)}>
          Open via the `Modal` alias
        </Button>
        <Button variant="outline" onClick={() => setConfirm(true)}>
          Confirm a deletion
        </Button>
      </Row>

      <Dialog
        open={dialog}
        onClose={() => setDialog(false)}
        title="New client"
        description="Creates a master-data record."
        footer={
          <FormButtons
            busy={false}
            onCancel={() => setDialog(false)}
            saveLabel="Create client"
          />
        }
      >
        <div className="space-y-4">
          <Field label="Legal name" required>
            <Input />
          </Field>
          <Field label="NIU" hint="Cameroon taxpayer number.">
            <Input />
          </Field>
        </div>
      </Dialog>

      {/* Same component: ui/modal re-exports Dialog so all 56 importers inherit
          the focus trap without being edited. */}
      <Modal
        open={legacy}
        onClose={() => setLegacy(false)}
        title="Opened through the old import path"
      >
        <p className="text-sm text-muted-foreground">
          Identical behaviour — that is the point of the alias.
        </p>
      </Modal>

      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        onConfirm={() => setConfirm(false)}
        title="Delete rate card?"
        body={'"Standard freight 2026" will stop applying to new quotations.'}
        confirmLabel="Delete rate card"
        destructive
      />

      <Row label="DropdownMenu — arrow keys, Escape, focus restore">
        <DropdownMenu trigger={<Button variant="outline">Row actions</Button>}>
          <DropdownLabel>
            <span className="text-xs text-muted-foreground">INV-2026-0041</span>
          </DropdownLabel>
          <DropdownSeparator />
          <DropdownItem onSelect={() => {}}>Edit</DropdownItem>
          <DropdownItem to="/finance/invoices">Open in Finance</DropdownItem>
          <DropdownSeparator />
          <DropdownItem destructive onSelect={() => {}}>
            Delete
          </DropdownItem>
        </DropdownMenu>

        <Popover
          label="Notifications"
          trigger={
            <Button variant="outline">Popover (content, not actions)</Button>
          }
        >
          <div className="w-72 p-3">
            <p className="text-sm">A panel may contain its own controls.</p>
            <Button variant="ghost" className="mt-2">
              Mark all read
            </Button>
          </div>
        </Popover>

        <Tooltip content="Available once the costing is approved">
          <span tabIndex={0}>
            <Button disabled>Issue invoice</Button>
          </span>
        </Tooltip>
      </Row>
    </>
  );
};

/* ────────────────────────────────── Tabs ─────────────────────────────────── */

export const TabsStory = () => {
  const [tab, setTab] = React.useState("milestones");
  return (
    <Tabs
      value={tab}
      onValueChange={setTab}
      label="Dossier sections"
      tabs={[
        {
          value: "milestones",
          label: "Milestones",
          content: <p className="text-sm">Milestone chain.</p>,
        },
        {
          value: "money",
          label: "Money",
          content: <p className="text-sm">Costs and invoicing.</p>,
        },
        {
          value: "people",
          label: "People",
          content: <p className="text-sm">Assigned staff.</p>,
        },
        {
          value: "docs",
          label: "Documents",
          content: <p className="text-sm">Attachments.</p>,
        },
      ]}
    />
  );
};

/* ───────────────────────────── The four states ───────────────────────────── */

export const States = () => (
  <>
    <Row label="Loading">
      <div className="w-full space-y-3">
        <LoadingRow />
        <Spinner />
      </div>
    </Row>
    <Row label="Empty — new list. The action CREATES.">
      <div className="w-full">
        <EmptyState
          title="No invoices"
          hint="Issue a final invoice from an approved costing."
          action={<Button>New invoice</Button>}
        />
      </div>
    </Row>
    <Row label="Empty — filtered to nothing. The action CLEARS.">
      <div className="w-full">
        <EmptyState
          title="No invoices match"
          hint="Try another status or search term."
          action={<Button variant="outline">Clear filters</Button>}
        />
      </div>
    </Row>
    <Row label="Error — role=alert, and the real server message">
      <div className="w-full space-y-3">
        <ErrorState message="You don't have permission to do this." />
        <ErrorState
          message="Period 2026-03 is already closed."
          action={<Button variant="outline">Reopen period</Button>}
        />
      </div>
    </Row>
    <Row label="Pagination — the API caps lists at 50 rows (F8)">
      <div className="w-full space-y-4">
        <Pagination
          page={1}
          pageSize={50}
          total={1284}
          onPageChange={() => {}}
        />
        <Pagination page={0} pageSize={50} hasMore onPageChange={() => {}} />
      </div>
    </Row>
  </>
);

/* ──────────────────────────── Toast & boundary ───────────────────────────── */

function ToastDemo() {
  const toast = useToast();
  return (
    <div className="flex flex-wrap gap-3">
      <Button onClick={() => toast.success("Invoice posted")}>Success</Button>
      <Button
        variant="outline"
        onClick={() => toast.error("Period 2026-03 is already closed.")}
      >
        Error
      </Button>
      <Button
        variant="ghost"
        onClick={() => toast.info("Export queued — we'll email it.")}
      >
        Info
      </Button>
    </div>
  );
}

export const Toasts = () => <ToastDemo />;

function Boom(): React.ReactElement {
  throw new Error("account_code is undefined");
}

export const Boundary = () => {
  const [crash, setCrash] = React.useState(false);
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Before Phase 2 there was no error boundary anywhere — this throw blanked
        the entire SPA (F12).
      </p>
      <Button onClick={() => setCrash(true)}>Trigger a render throw</Button>
      <ErrorBoundary name="Finance">
        {crash ? <Boom /> : <p className="text-sm">Nothing wrong yet.</p>}
      </ErrorBoundary>
    </div>
  );
};

/* ─────────────────────────── Tone reference table ────────────────────────── */

/** Every mapped status and the tone it resolves to — the replacement for
 *  Badge's hardcoded raw-Tailwind table, in one place to eyeball in both themes. */
export const StatusToneReference = () => {
  const statuses = [
    "DRAFT",
    "CLOSED",
    "ENDED",
    "EXPIRED",
    "CANCELLED",
    "NEW",
    "OPEN",
    "TRIAGED",
    "SENT",
    "ISSUED",
    "SCHEDULED",
    "IN_PROGRESS",
    "CONTACTED",
    "REVIEWING",
    "IN_REVIEW",
    "PENDING",
    "PAUSED",
    "SIGNED_OFF",
    "YELLOW",
    "QUALIFIED",
    "CONVERTED",
    "WON",
    "ACCEPTED",
    "ACTIVE",
    "PUBLISHED",
    "APPROVED",
    "SIGNED",
    "DONE",
    "GREEN",
    "LOST",
    "REJECTED",
    "DECLINED",
    "FAILED",
    "RED",
  ];
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
      {statuses.map((s) => (
        <div
          key={s}
          className="flex items-center justify-between gap-2 rounded-md border px-3 py-2"
        >
          <StatusPill status={s} />
          <code className="text-micro text-muted-foreground">
            {statusTone(s)}
          </code>
        </div>
      ))}
    </div>
  );
};
