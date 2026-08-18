# Tenant Onboarding Checklist — runtime provider enablement (G15)

**Closes:** G15 of `doc/GAP_REVIEW_2026-08-14.md` — *"the documented tenant-onboarding
checklist that runs against `POST /ai-vendors/:vendor/test`."*

This is the operator's checklist for turning a freshly provisioned tenant into
a working one. Every step is a click or a curl in the running app — none of
them require a redeploy. Run the steps in order: each one unblocks the next.

---

## 0. Before you start

- Tenant is provisioned (`status = LIVE`), admin user exists and can sign in.
- You hold a **Settings (MOD-70) edit** grant — every runtime test below is
  capability-gated on `settings.write`.
- Keep the tenant URL handy: `https://<slug>.praxisls.com`.

## 1. Branding (white-label)

- [ ] **Logo + login background** — Settings → Appearance → upload logo, login
      image; save and hard-refresh the login page.
- [ ] **Brand colours** — set primary/secondary/accent; confirm the login page
      repaints without a deploy (live CSS variables).
- [ ] **PWA identity** — Settings → App & PWA; verify install prompt uses the
      tenant name/icon.
- [ ] **Verify:** the "Powered by JBS Praxis LLC" footer is present on login.

## 2. Sending identity (SMTP / email)

- [ ] **Configure sender** — Settings → Email (or Mailbox → Setup wizard):
      SMTP host/port/creds + a verified identity for at least one purpose
      (invoices, notifications).
- [ ] **Runtime test** — the settings test endpoint (capability `settings.write`):

      curl -X POST "$TENANT/api/platform/settings/mail.default/test" \
        -H "Authorization: Bearer $TOKEN" -H "X-Praxis-Env: live"

      Expected: `{ ok: true }` and a probe email arrives.
- [ ] **Send a real document** — issue a test invoice and Send from the
      document viewer; confirm delivery + `email_send_log` row status `SENT`.

## 3. AI providers (PDF/vision/voice/generation)

- [ ] **API keys** — Settings → API keys → add the tenant's provider keys
      (Gemini vision, Groq voice, the generation vendor, embeddings).
- [ ] **Runtime test each** — the vendor test endpoint:

      curl -X POST "$TENANT/api/platform/ai-vendors/gemini/test"  \
        -H "Authorization: Bearer $TOKEN"
      curl -X POST "$TENANT/api/platform/ai-vendors/groq/test"     \
        -H "Authorization: Bearer $TOKEN"

      Expected: `{ ok: true }` per vendor; a failed key answers with the
      provider's error, not a timeout.
- [ ] **AI Control** — Settings → AI Control: confirm per-user/per-tenant
      spend caps and feature flags are set (sandbox is always mock).
- [ ] **PDF/Chromium** — generate a PDF from any document (Settings →
      Document templates → Generate PDF). If this fails, the worker image
      lacks Chromium or `PUPPETEER_EXECUTABLE_PATH` is unset — see
      `doc/PDF_RENDERING_SETUP.md`.

## 4. FX rates

- [ ] **Source enabled** — Master data → Currencies → enable the FX source
      (e.g. exchangerate-api) and paste the key.
- [ ] **Runtime test** — trigger **Sync now**; confirm the rate table updates
      and a conversion (`GET /api/tenant/master/currencies/fx/convert`) returns
      the new rate.
- [ ] **Cron** — confirm `fx-sync` is listed in the worker's registered
      repeatables (deploy log) so rates stay current without manual sync.

## 5. Sandbox hygiene (PRD §5.5)

- [ ] **Sandbox wipe window** — set `sandbox_wipe_days` (default 14) on the
      tenant; confirm the daily scheduler tick appears in the worker log.
- [ ] **Side-effect guards** — in TEST mode: sending an email records
      `SUPPRESSED` (never leaves the server), generated PDFs are watermarked
      `TEST SANDBOX`, AI generation takes the mock path. Spot-check all three.

## 6. God Mode (CEO)

- [ ] **Set the PIN** — CEO → God Mode → Set PIN (or wait for the weekly
      rotation email). Confirm purge works and that an expired PIN is refused
      after 7 days.

## 7. External surfaces

- [ ] **Portal** — invite a test client contact via Settings → Portal Access;
      sign in at `/portal`, confirm the client terminal renders.
- [ ] **Public site** — `/public` loads, quote form posts an intake row to the
      sales queue; `/public/track` answers 404 (not 401) for an unknown ref;
      careers + portfolio pages render.
- [ ] **Auditor data room** — grant an AUDITOR portal access; raise a data-room
      request from the portal, attach a VERIFIED vault document as staff,
      confirm the auditor can download it.

## 8. Wrap-up

- [ ] Record anything that needed a config change, not a key entry, in the
      tenant's handover note — the goal is that the NEXT tenant needs only keys
      and brand assets.
