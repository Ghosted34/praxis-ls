/**
 * Client-portal settings that apply to EVERY client — the "Client portal"
 * section of ⚙ Settings on the Clients list. One client's people and checklist
 * are on that client's 360; what is the same for all of them is here:
 *
 *   NEW INVITATIONS   what a newly invited person sees unless someone chooses
 *                     otherwise, and whether a client's first portal user
 *                     becomes its admin (so someone on their side can add
 *                     colleagues). Used by staff invites AND by a client
 *                     admin's own invite sheet in the portal.
 *   ONBOARDING STEPS  the checklist every client starts from (14240). Adding a
 *                     step reaches every client the next time their checklist
 *                     opens; switching one off drops it only where it is still
 *                     unticked — a ticked step is a record, not a setting.
 *   ELSEWHERE         the portal settings that belong to another screen, one
 *                     tap away rather than re-implemented here.
 *
 * It sits beside the Categories and Document types editors in the same
 * dialog, so on a desktop it is built the way they are (master-data-settings
 * `RegistryManager`): a plain heading with "+ Add new" on its right, a bordered
 * table with the row's actions as text at its end, the add form opening in
 * place. On a phone the table becomes a list of rows sized for a thumb — the
 * same records and actions, `useIsCompact()` choosing one shell.
 */
import * as React from "react";
import { Link } from "react-router-dom";
import { tr, tv, currentLocale } from "@/lib/i18n";
import { tenant } from "@/lib/api-client";
import { errMsg, isFeatureDisabled, useResource } from "@/lib/use-resource";
import { useCanOpenRoute } from "@/lib/route-access";
import { useIsCompact } from "@/lib/use-media-query";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/modal";
import { Checkbox, RadioGroup } from "@/components/ui/checkbox";
import { MoreMenu } from "@/components/ui/more-menu";
import { DropdownItem } from "@/components/ui/dropdown-menu";
import { EmptyState, ErrorState, LoadingRow } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { ChevronIcon } from "@/components/ui/icons";
import { SCOPE_LABEL, type PortalScope } from "./portal-scope";
import type { InviteDefaults } from "./client-portal-people";

type TemplateStep = {
  step_key: string;
  label_en: string;
  label_fr: string;
  sort_order: number;
  is_active: boolean;
};
type Settings = { invite_defaults: InviteDefaults; onboarding_steps: TemplateStep[] };

const SCOPES: PortalScope[] = ["ALL", "OPERATIONS", "BILLING"];

/** The text-link action RegistryManager's rows use ("Deactivate"), for the same kind of row. */
const LINK_ACTION =
  "text-sm text-primary-ink underline underline-offset-2 hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-40 disabled:no-underline";

/** One concern of the section: a heading, an optional hint and one action — RegistryManager's header. */
function Block({
  title,
  hint,
  action,
  children,
}: {
  title: string;
  hint?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="text-sm font-semibold text-foreground">{title}</h4>
          {hint ? <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p> : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      {children}
    </section>
  );
}

export function ClientPortalSettings() {
  const settings = useResource(() => tenant<Settings>("/portal/settings"), [], { fresh: true });

  if (isFeatureDisabled(settings.errorCode)) {
    return (
      <EmptyState
        title={tr("The client portal is not switched on")}
        hint={tr("It is part of the plan your administrator manages. These settings appear once it is on.")}
      />
    );
  }
  if (settings.error) return <ErrorState message={settings.error} />;
  if (!settings.data) return <LoadingRow label={tr("Loading…")} />;

  return (
    <div className="grid grid-cols-1 gap-6">
      <InviteDefaultsBlock value={settings.data.invite_defaults} onSaved={settings.reload} />
      <OnboardingTemplateBlock steps={settings.data.onboarding_steps} onChanged={settings.reload} />
      <ElsewhereBlock />
    </div>
  );
}

/* ── new invitations ────────────────────────────────────────────────────── */

function InviteDefaultsBlock({ value, onSaved }: { value: InviteDefaults; onSaved: () => void }) {
  const toast = useToast();
  const [scope, setScope] = React.useState<PortalScope>(value.access_scope);
  const [firstAdmin, setFirstAdmin] = React.useState(value.first_is_admin);
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => {
    setScope(value.access_scope);
    setFirstAdmin(value.first_is_admin);
  }, [value.access_scope, value.first_is_admin]);
  const dirty = scope !== value.access_scope || firstAdmin !== value.first_is_admin;

  async function save() {
    setBusy(true);
    try {
      await tenant("/portal/settings/invite-defaults", {
        method: "POST",
        body: { access_scope: scope, first_is_admin: firstAdmin },
      });
      toast.success(tr("Saved. New invitations start from these."));
      onSaved();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Block
      title={tr("New invitations")}
      hint={tr("What someone invited to a client's portal starts with. It can always be changed for one person.")}
    >
      <div className="rounded-lg border p-3">
        {/* Two columns on a desktop — the choice and the rule side by side —
            one in the phone's sheet. */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label={tr("What they see by default")}>
            <RadioGroup
              aria-label={tr("What they see by default")}
              value={scope}
              onValueChange={(v) => setScope(v as PortalScope)}
              options={SCOPES.map((s) => ({ value: s, label: tr(SCOPE_LABEL[s]) }))}
            />
          </Field>
          <div className="md:pt-6">
            <Checkbox
              checked={firstAdmin}
              onCheckedChange={setFirstAdmin}
              label={tr("Make a client's first portal user its admin")}
              hint={tr("So someone on the client's side can invite their colleagues without asking you.")}
            />
          </div>
        </div>
        <div className="mt-3 flex justify-end border-t pt-3">
          <Button size="sm" loading={busy} disabled={!dirty} onClick={() => void save()} className="w-full md:w-auto">
            {tr("Save")}
          </Button>
        </div>
      </div>
    </Block>
  );
}

/* ── onboarding steps ───────────────────────────────────────────────────── */

function OnboardingTemplateBlock({ steps, onChanged }: { steps: TemplateStep[]; onChanged: () => void }) {
  const toast = useToast();
  const compact = useIsCompact();
  const fr = currentLocale().startsWith("fr");
  const active = steps.filter((s) => s.is_active);
  const off = steps.filter((s) => !s.is_active);
  const [editing, setEditing] = React.useState<string | null>(null);
  const [adding, setAdding] = React.useState(false);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [showOff, setShowOff] = React.useState(false);

  async function act(key: string, fn: () => Promise<unknown>, ok?: string) {
    setBusy(key);
    try {
      await fn();
      if (ok) toast.success(ok);
      onChanged();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(null);
    }
  }
  const stepPath = (key: string) => `/portal/settings/onboarding-steps/${encodeURIComponent(key)}`;
  const move = (s: TemplateStep, direction: "up" | "down") =>
    act(s.step_key, () => tenant(`${stepPath(s.step_key)}/move`, { method: "POST", body: { direction } }));
  const setActive = (s: TemplateStep, isActive: boolean) =>
    act(
      s.step_key,
      () => tenant(stepPath(s.step_key), { method: "POST", body: { is_active: isActive } }),
      isActive ? tr("Step switched back on.") : tr("Step switched off. Clients who already ticked it keep it."),
    );
  const rename = (s: TemplateStep, v: { en: string; fr: string }) =>
    act(
      s.step_key,
      async () => {
        await tenant(stepPath(s.step_key), { method: "POST", body: { label_en: v.en, label_fr: v.fr || v.en } });
        setEditing(null);
      },
      tr("Step renamed for every client."),
    );
  const label = (s: TemplateStep) => (fr ? s.label_fr || s.label_en : s.label_en || s.label_fr);

  const addForm = adding ? (
    <div className="rounded-lg border bg-card p-3">
      <StepForm
        initial={{ en: "", fr: "" }}
        busy={busy === "__new"}
        submitLabel={tr("Add step")}
        onCancel={() => setAdding(false)}
        onSubmit={(v) =>
          act(
            "__new",
            async () => {
              await tenant("/portal/settings/onboarding-steps", { method: "POST", body: { label_en: v.en, label_fr: v.fr || null } });
              setAdding(false);
            },
            tr("Step added — every client's checklist now has it."),
          )
        }
      />
    </div>
  ) : null;

  const moveButtons = (s: TemplateStep, i: number) => (
    <>
      <IconButton
        label={tv("Move {{step}} up", { step: label(s) })}
        disabled={i === 0 || busy !== null}
        compact={compact}
        onClick={() => void move(s, "up")}
      >
        <ChevronIcon className="rotate-180" width={16} height={16} />
      </IconButton>
      <IconButton
        label={tv("Move {{step}} down", { step: label(s) })}
        disabled={i === active.length - 1 || busy !== null}
        compact={compact}
        onClick={() => void move(s, "down")}
      >
        <ChevronIcon width={16} height={16} />
      </IconButton>
    </>
  );

  return (
    <Block
      title={tr("Onboarding steps")}
      hint={tr("The checklist every client starts from, shown in their portal. A new step reaches every client; a step switched off leaves the lists where it is already ticked.")}
      action={
        <Button size="sm" variant="outline" icon={null} onClick={() => setAdding((a) => !a)}>
          {tr("+ Add new")}
        </Button>
      }
    >
      {addForm}
      {steps.length === 0 ? (
        <EmptyState title={tr("No steps yet — clients see no checklist.")} hint={tr("Add the first step.")} />
      ) : compact ? (
        /* ── phone: a row per step, big enough for a thumb ── */
        <>
          {active.length ? (
            <ol className="divide-y overflow-hidden rounded-lg border">
              {active.map((s, i) =>
                editing === s.step_key ? (
                  <li key={s.step_key} className="p-3">
                    <StepForm
                      initial={{ en: s.label_en, fr: s.label_fr }}
                      busy={busy === s.step_key}
                      submitLabel={tr("Save")}
                      onCancel={() => setEditing(null)}
                      onSubmit={(v) => rename(s, v)}
                    />
                  </li>
                ) : (
                  <li key={s.step_key} className="flex min-h-[52px] items-center gap-2 px-3 py-2">
                    <span aria-hidden className="w-5 shrink-0 text-center text-xs font-semibold text-muted-foreground">
                      {i + 1}
                    </span>
                    {/* Wraps rather than truncates: beside three 36px buttons a
                        phone leaves ~170px, and "Company profile comp…" is not a
                        step anyone can recognise. */}
                    <span className="min-w-0 flex-1 break-words">
                      <span className="block text-sm font-medium text-foreground">{label(s)}</span>
                      <span className="block text-xs text-muted-foreground">{fr ? s.label_en : s.label_fr}</span>
                    </span>
                    <div className="flex shrink-0 items-center gap-1">
                      {moveButtons(s, i)}
                      <MoreMenu label={tv("Actions for {{step}}", { step: label(s) })}>
                        <DropdownItem onSelect={() => setEditing(s.step_key)}>{tr("Rename")}</DropdownItem>
                        <DropdownItem destructive onSelect={() => void setActive(s, false)}>
                          {tr("Switch off")}
                        </DropdownItem>
                      </MoreMenu>
                    </div>
                  </li>
                ),
              )}
            </ol>
          ) : null}
          {off.length ? (
            <div>
              <button
                type="button"
                aria-expanded={showOff}
                onClick={() => setShowOff((v) => !v)}
                className="flex min-h-9 items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <ChevronIcon className={cn("transition-transform", showOff ? "" : "-rotate-90")} width={14} height={14} />
                {tv("Switched off ({{n}})", { n: off.length })}
              </button>
              {showOff ? (
                <ul className="mt-2 divide-y overflow-hidden rounded-lg border">
                  {off.map((s) => (
                    <li key={s.step_key} className="flex min-h-[48px] items-center gap-2 px-3 py-2">
                      <span className="min-w-0 flex-1 break-words text-sm text-muted-foreground">{label(s)}</span>
                      <Button size="sm" variant="ghost" icon={null} loading={busy === s.step_key} onClick={() => void setActive(s, true)}>
                        {tr("Switch on")}
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </>
      ) : (
        /* ── desktop: the registry table the categories beside it use ── */
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>
                <th className="w-10 px-3 py-2 text-left font-medium">#</th>
                <th className="px-3 py-2 text-left font-medium">{tr("In English")}</th>
                <th className="px-3 py-2 text-left font-medium">{tr("In French")}</th>
                <th className="px-3 py-2 text-right font-medium">
                  <span className="sr-only">{tr("Actions")}</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {active.map((s, i) =>
                editing === s.step_key ? (
                  <tr key={s.step_key}>
                    <td colSpan={4} className="px-3 py-2">
                      <StepForm
                        initial={{ en: s.label_en, fr: s.label_fr }}
                        busy={busy === s.step_key}
                        submitLabel={tr("Save")}
                        onCancel={() => setEditing(null)}
                        onSubmit={(v) => rename(s, v)}
                      />
                    </td>
                  </tr>
                ) : (
                  <tr key={s.step_key}>
                    <td className="num px-3 py-1.5 text-muted-foreground">{i + 1}</td>
                    <td className="px-3 py-1.5 font-medium text-foreground">{s.label_en}</td>
                    <td className="px-3 py-1.5 text-muted-foreground">{s.label_fr}</td>
                    <td className="whitespace-nowrap px-3 py-1.5">
                      <div className="flex items-center justify-end gap-3">
                        <span className="flex items-center gap-1">{moveButtons(s, i)}</span>
                        <button type="button" className={LINK_ACTION} disabled={busy !== null} onClick={() => setEditing(s.step_key)}>
                          {tr("Rename")}
                        </button>
                        <button type="button" className={LINK_ACTION} disabled={busy !== null} onClick={() => void setActive(s, false)}>
                          {tr("Switch off")}
                        </button>
                      </div>
                    </td>
                  </tr>
                ),
              )}
              {/* Switched-off steps stay in the table, dimmed, the way a
                  deactivated category does beside it. */}
              {off.map((s) => (
                <tr key={s.step_key} className="opacity-60">
                  <td className="px-3 py-1.5 text-muted-foreground">—</td>
                  <td className="px-3 py-1.5 text-foreground">{s.label_en}</td>
                  <td className="px-3 py-1.5 text-muted-foreground">{s.label_fr}</td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-right">
                    <button type="button" className={LINK_ACTION} disabled={busy !== null} onClick={() => void setActive(s, true)}>
                      {tr("Switch on")}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Block>
  );
}

/** ↑ / ↓ — 36px for a thumb, 28px in a desktop table row. */
function IconButton({
  label,
  disabled,
  compact,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  compact: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "grid place-items-center rounded-md border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40",
        compact ? "h-9 w-9" : "h-7 w-7",
      )}
    >
      {children}
    </button>
  );
}

function StepForm({
  initial,
  busy,
  submitLabel,
  onCancel,
  onSubmit,
}: {
  initial: { en: string; fr: string };
  busy: boolean;
  submitLabel: string;
  onCancel: () => void;
  onSubmit: (v: { en: string; fr: string }) => void;
}) {
  const [en, setEn] = React.useState(initial.en);
  const [frLabel, setFr] = React.useState(initial.fr);
  const valid = en.trim().length >= 2;
  return (
    <form
      className="grid grid-cols-1 gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) onSubmit({ en: en.trim(), fr: frLabel.trim() });
      }}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={tr("In English")} required>
          <Input value={en} onChange={(e) => setEn(e.target.value)} maxLength={160} placeholder="Customs mandate signed" />
        </Field>
        <Field label={tr("In French")} hint={tr("Optional — the English is shown when empty.")}>
          <Input value={frLabel} onChange={(e) => setFr(e.target.value)} maxLength={160} placeholder="Mandat de dédouanement signé" />
        </Field>
      </div>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" size="sm" variant="ghost" onClick={onCancel} className="w-full sm:w-auto">
          {tr("Cancel")}
        </Button>
        <Button type="submit" size="sm" loading={busy} disabled={!valid} className="w-full sm:w-auto">
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

/* ── elsewhere ──────────────────────────────────────────────────────────── */

const ELSEWHERE: { to: string; label: string; desc: string }[] = [
  { to: "/comms/clients", label: "Client conversations", desc: "Every client's portal chat, those waiting for an answer first" },
  { to: "/appearance", label: "How the portal looks", desc: "Your logo and colours, used on the portal too" },
  { to: "/settings/catalogue", label: "Portal features on your plan", desc: "Which portals and features are switched on" },
  { to: "/settings/portal-access", label: "Investor & auditor access", desc: "The other two portals, and who can open them" },
];

function ElsewhereBlock() {
  const canOpen = useCanOpenRoute();
  const links = ELSEWHERE.filter((l) => canOpen(l.to));
  if (!links.length) return null;
  return (
    <Block title={tr("Also for the portal")}>
      <ul className="divide-y overflow-hidden rounded-lg border">
        {links.map((l) => (
          <li key={l.to}>
            <Link
              to={l.to}
              className="flex min-h-[52px] items-center gap-3 px-3 py-2 transition-colors hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring md:min-h-0"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-foreground">{tr(l.label)}</span>
                <span className="block text-xs text-muted-foreground">{tr(l.desc)}</span>
              </span>
              <ChevronIcon className="-rotate-90 shrink-0 text-muted-foreground" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </Block>
  );
}
