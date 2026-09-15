/**
 * Settings › Website › Social — the links in the public footer.
 *
 * ── THE SCREEN IS THE REGISTRY ─────────────────────────────────────────────
 *
 * One row per platform this product knows how to render, all of them always
 * visible, each with a single URL field. There is no "add a platform" button
 * and no delete: paste a URL and the icon appears in the footer, clear the
 * field and it does not exist. That is the entire feature, and it has no empty
 * state to design because the form is the same whether nothing is filled in or
 * everything is.
 *
 * ── WHY THE URL IS CHECKED AGAINST THE PLATFORM'S OWN DOMAIN ──────────────
 *
 * A LinkedIn glyph, in the tenant's own footer, under their branding, pointing
 * at any URL at all, is a phishing primitive with the tenant's reputation
 * attached. Anyone who can reach this screen can already publish copy, so this
 * is not a privilege boundary — it is a guard against a mistake (a pasted
 * tracking link, a shortener, a typo'd domain) becoming a link customers trust
 * *because of the icon beside it*.
 *
 * The rule lives in `packages/shared/design/social.js`, so this field and the
 * API refuse exactly the same strings and the check here is genuine feedback
 * rather than decoration the server repeats.
 *
 * ── A REJECTION MUST NAME THE FIELD IT IS ABOUT ────────────────────────────
 *
 * This form is SEVEN fields saved by ONE button, so "not saved" on its own is
 * not feedback — it is a puzzle with seven candidates. The screen used to print
 * whatever message came back in a banner at the bottom and leave the tenant to
 * guess, which cost a real support round: the message read "One of the values
 * is in the wrong format", the wrong field was edited twice, and the actual
 * fault was not in any of them (see `shared/events/emit.js` — the audit write
 * was mis-serialising a list into a jsonb column and 400'ing every save).
 *
 * So every refusal here, wherever it came from, is resolved to a FIELD:
 *
 *   - the message is rendered under that field, in that field's own row;
 *   - `aria-invalid` marks the input, so a screen reader says so on arrival;
 *   - the input is FOCUSED and scrolled to, because on a narrow viewport the
 *     offending row is frequently off-screen behind the banner;
 *   - the banner names the platform by its DISPLAY name ("WhatsApp"), never
 *     the `whatsapp` id the API keys its `fields` bag by.
 *
 * A refusal the server does not attribute to a field (a 500, an offline fetch)
 * still gets the banner — but it says so plainly rather than implying one of
 * these seven values is at fault.
 */
import * as React from "react";
import { PageHeader } from "@/components/data-list";
import { HubCrumb } from "@/components/tabbed-hub";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Input } from "@/components/ui/input";
import { SettingsCard, Field } from "@/components/settings/controls";
import { ErrorState } from "@/components/ui/states";
import { tr } from "@/lib/i18n";
import { ApiError } from "@/lib/api-client";
import { errMsg } from "@/lib/use-resource";
import * as api from "@/lib/site-settings-api";
import { SOCIAL_PLATFORMS, isValidSocialUrl } from "@praxis/shared/design/social";
import { WebsiteNav } from "./website-nav";

/** The message a field carries when this screen — not the server — refuses it.
 *  Written once so the inline row and the summary cannot drift apart. */
const localMessage = (name: string) =>
  `${tr("This is not a")} ${name} ${tr("link. Check the address.")}`;

/**
 * The server's `fields` bag → `{ whatsapp: "Must be an https link…" }`.
 *
 * Only keys that ARE a platform survive: a 422 about something else (the
 * `platform` key the service uses for an unknown id) has no row to attach to,
 * and silently dropping it into a field nobody can see would lose it. Those
 * fall through to the banner instead, which is what `unattributed` reports.
 */
function attribute(fields: ApiError["fields"]): {
  byPlatform: Record<string, string>;
  unattributed: string[];
} {
  const byPlatform: Record<string, string> = {};
  const unattributed: string[] = [];
  const known = new Set(SOCIAL_PLATFORMS.map((p) => p.id));
  for (const [key, value] of Object.entries(
    (fields ?? {}) as Record<string, string[] | string>,
  )) {
    const text = Array.isArray(value) ? value.join(" ") : String(value);
    if (known.has(key)) byPlatform[key] = text;
    else unattributed.push(`${key}: ${text}`);
  }
  return { byPlatform, unattributed };
}

export function WebsiteSocialPage() {
  const [links, setLinks] = React.useState<Record<string, string> | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  /** A refusal the server did not pin to one of these seven fields. */
  const [saveError, setSaveError] = React.useState<string | null>(null);
  /** A refusal the server DID pin to a field, keyed by platform id. */
  const [serverFieldErrors, setServerFieldErrors] = React.useState<
    Record<string, string>
  >({});
  const [saved, setSaved] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const inputs = React.useRef<Record<string, HTMLInputElement | null>>({});

  const load = React.useCallback(() => {
    api
      .listSocial()
      .then((rows) => {
        const next: Record<string, string> = {};
        for (const p of SOCIAL_PLATFORMS) next[p.id] = "";
        for (const r of rows) next[r.platform] = r.url;
        setLinks(next);
        setLoadError(null);
        setSaveError(null);
        setServerFieldErrors({});
      })
      .catch((e) => setLoadError(errMsg(e)));
  }, []);

  React.useEffect(load, [load]);

  /** Only a NON-EMPTY value can be wrong. A blank field is how a tenant removes
   *  a link, so flagging it would make the remove gesture look like an error. */
  const invalid = React.useMemo(() => {
    if (!links) return {};
    const out: Record<string, boolean> = {};
    for (const p of SOCIAL_PLATFORMS) {
      const v = (links[p.id] || "").trim();
      out[p.id] = Boolean(v) && !isValidSocialUrl(p.id, v);
    }
    return out;
  }, [links]);

  /** What each row actually shows: this screen's own verdict first, because the
   *  user can act on it without a round trip, then whatever the API said. */
  const messageFor = React.useCallback(
    (id: string, name: string) =>
      invalid[id] ? localMessage(name) : serverFieldErrors[id] || null,
    [invalid, serverFieldErrors],
  );

  /** Focus the row a message is about, and bring it into view — it is often
   *  above the fold-line the banner sits on, or off-screen entirely on a phone. */
  const focusField = React.useCallback((id: string) => {
    const el = inputs.current[id];
    if (!el) return;
    // A frame later: the banner and the inline message mount in this same
    // commit and change the layout, so scrolling before paint lands short.
    window.requestAnimationFrame(() => {
      el.focus();
      el.scrollIntoView({ block: "center", behavior: "smooth" });
    });
  }, []);

  /**
   * "Check the link for WhatsApp." / "Check the links for Instagram, WhatsApp."
   *
   * The rows are named in the REGISTRY's order, so the banner reads in the same
   * order the eye scans the form.
   *
   * Two whole clauses rather than one with a `tr("and")` spliced into it. A
   * conjunction is not a translatable unit — it inflects with what surrounds
   * it — and `Intl.ListFormat`, which would do this properly, is ES2021 while
   * this app's `lib` is ES2020. A comma list under a correctly-numbered clause
   * is the version that is right in every language the toggle offers.
   */
  const summary = (ids: string[]) => {
    const names = SOCIAL_PLATFORMS.filter((p) => ids.includes(p.id)).map((p) => p.name);
    const lead = names.length > 1 ? tr("Check the links for") : tr("Check the link for");
    return `${lead} ${names.join(", ")}.`;
  };

  async function save() {
    if (!links) return;
    setSaved(false);

    // This screen's own verdict first. The Save button stays ENABLED while a
    // field is wrong on purpose: a disabled button is the one control that
    // cannot explain why it will not work, and "which of these seven?" is
    // exactly the question this screen kept failing to answer.
    const badLocally = SOCIAL_PLATFORMS.filter((p) => invalid[p.id]).map((p) => p.id);
    if (badLocally.length) {
      setServerFieldErrors({});
      setSaveError(summary(badLocally));
      focusField(badLocally[0]);
      return;
    }

    setBusy(true);
    setSaveError(null);
    setServerFieldErrors({});
    try {
      await api.saveSocial(links);
      setSaved(true);
    } catch (e) {
      const { byPlatform, unattributed } =
        e instanceof ApiError ? attribute(e.fields) : { byPlatform: {}, unattributed: [] };
      const ids = SOCIAL_PLATFORMS.filter((p) => byPlatform[p.id]).map((p) => p.id);
      setServerFieldErrors(byPlatform);
      if (ids.length) {
        // The rows carry the detail; the banner only has to point at them.
        setSaveError(
          unattributed.length
            ? `${summary(ids)} ${unattributed.join("; ")}`
            : summary(ids),
        );
        focusField(ids[0]);
      } else {
        // Nothing the server said maps to a field on this screen. Say that,
        // rather than leaving the tenant hunting through seven valid values.
        setSaveError(errMsg(e));
      }
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
        title={tr("Social links")}
        description={tr(
          "Paste a link and it appears in your website footer. Leave one blank and it does not.",
        )}
      />
      <WebsiteNav />

      {!links ? null : (
        <>
          <SettingsCard
            title={tr("Footer links")}
            desc={tr("Each link must be on that platform's own domain, over https.")}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              {SOCIAL_PLATFORMS.map((p) => {
                const message = messageFor(p.id, p.name);
                return (
                  <Field key={p.id} label={p.name}>
                    <Input
                      ref={(el) => {
                        inputs.current[p.id] = el;
                      }}
                      value={links[p.id] ?? ""}
                      placeholder={p.placeholder}
                      aria-invalid={message ? true : undefined}
                      aria-describedby={message ? `social-error-${p.id}` : undefined}
                      onChange={(e) => {
                        setSaved(false);
                        // The server's verdict was about the OLD value. Keeping
                        // it while the field is being retyped would leave the
                        // tenant correcting a field the screen still calls bad.
                        setServerFieldErrors((prev) => {
                          if (!prev[p.id]) return prev;
                          const next = { ...prev };
                          delete next[p.id];
                          return next;
                        });
                        setLinks((l) => (l ? { ...l, [p.id]: e.target.value } : l));
                      }}
                    />
                    {message && (
                      <p id={`social-error-${p.id}`} className="text-xs text-bad">
                        {message}
                      </p>
                    )}
                  </Field>
                );
              })}
            </div>
          </SettingsCard>

          {saveError && (
            <Callout tone="bad" title={tr("Not saved")}>
              {saveError}
            </Callout>
          )}
          {saved && !saveError && (
            <Callout tone="ok" title={tr("Saved")}>
              {tr("Your footer picks this up on the next page load.")}
            </Callout>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={load} disabled={busy}>
              {tr("Discard changes")}
            </Button>
            <Button onClick={save} disabled={busy}>
              {busy ? tr("Saving…") : tr("Save links")}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
