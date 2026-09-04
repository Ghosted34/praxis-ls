-- ============================================================================
-- TENANT SEED — 9086 The home page bands, as editable blocks.
--
-- ── WHAT THIS FINISHES ─────────────────────────────────────────────────────
--
-- 9085 seeded the home page and the figures. This seeds the words that were
-- already on the tenant's homepage — the hero, the three-step explanation, the
-- closing call to action — as blocks they can open and rewrite.
--
-- Those words were never blank. They live in `public-web/src/lib/i18n-dict.ts`
-- and every tenant's site has been showing them since it went up: generic
-- enough to be true of any forwarder, specific enough to look finished. What no
-- tenant could do was change them. They were behind a build, in a bundle, in a
-- language file — so a client who disliked the headline on their own homepage
-- had to ask an engineer.
--
-- The copy below is that dictionary text, transcribed. Not a rewrite and not an
-- improvement: the same sentences, so that publishing this page changes nothing
-- a visitor sees and everything about who can change it. `site-api.ts` reads
-- these blocks and the bands prefer them over the dictionary — whole-block,
-- never merged, so a tenant never gets a headline half theirs and half ours.
--
-- ── WHY THE PAGE STAYS A DRAFT ─────────────────────────────────────────────
--
-- Set by 9085 and not changed here. While it is a draft the public read 404s,
-- the bands keep their dictionary copy, and the site is byte-identical to what
-- it is today. Publishing is the tenant's move, and because the seeded blocks
-- say exactly what the dictionary says, publishing an unedited page is a no-op
-- rather than a surprise. That is the property worth having: the editor can be
-- explored, saved and published without anybody risking their own homepage.
--
-- ── WHY THESE THREE TYPES AND NO OTHERS ────────────────────────────────────
--
-- `hero`, `feature_list` and `cta_band` are the types the renderer now reads,
-- alongside the two from 9085. The library has fifteen. Seeding a
-- `testimonials` or a `leader_message` would put content in the editor that no
-- page renders — the exact confusion 9085's header is about.
--
-- The portal band and the contact band are NOT seeded. Both are still
-- dictionary-only in the renderer, and a block nothing reads is worse than no
-- block: it invites somebody to write copy that will never appear.
-- ============================================================================

-- ── The hero ───────────────────────────────────────────────────────────────
-- The dictionary splits the headline across `titleMain` and `titleAccent` so
-- the second half takes the accent colour. A block carries ONE title, and the
-- renderer draws a tenant-authored headline in a single colour on purpose:
-- splitting somebody else's sentence at a word we picked, in two languages, is
-- a decision about their writing we do not get to make. The two halves are
-- joined here so the seeded text reads as the sentence it always was.
-- Guarded by a DO block rather than by the INSERT's own WHERE NOT EXISTS.
-- Both are equally idempotent; only one is legible to
-- `scripts/db/check-migration-idempotency.js`, which reads a DO block as the
-- author's explicit catalog check and cannot see a guard buried in a SELECT.
-- `site_block` carries no unique key over (page_id, type) — a page may hold two
-- card grids — so there is no ON CONFLICT target to use instead.
DO $do$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM site_block b JOIN site_page p ON p.page_id = b.page_id
     WHERE p.key = 'home' AND b.type = 'hero'
  ) THEN
    INSERT INTO site_block (page_id, type, sort_order, is_visible, content)
    SELECT p.page_id, 'hero', 5, true, $j$
    {
      "kicker": {"fr": "Transit et logistique", "en": "Freight forwarding and logistics"},
      "title":  {"fr": "Votre marchandise, suivie de bout en bout",
                 "en": "Your cargo, tracked end to end"},
      "lead":   {"fr": "Le transport, les formalités et les documents sur un seul dossier — et une page où vous voyez où en est votre expédition.",
                 "en": "Transport, formalities and paperwork on one file — and a page where you can see where your shipment is."},
      "cta":    {"label": {"fr": "Demander un devis", "en": "Request a quote"},
                 "href": "/quote"}
    }
    $j$::jsonb
      FROM site_page p
     WHERE p.key = 'home';
  END IF;
END
$do$;

-- ── How it works ───────────────────────────────────────────────────────────
-- Three steps, transcribed from `site.how.steps`. They describe the shape of
-- working with a forwarder that runs this software, which is why they are
-- honest for any tenant on it — and why a tenant who works differently should
-- be able to say so here rather than living with ours.
-- Guarded by a DO block rather than by the INSERT's own WHERE NOT EXISTS.
-- Both are equally idempotent; only one is legible to
-- `scripts/db/check-migration-idempotency.js`, which reads a DO block as the
-- author's explicit catalog check and cannot see a guard buried in a SELECT.
-- `site_block` carries no unique key over (page_id, type) — a page may hold two
-- card grids — so there is no ON CONFLICT target to use instead.
DO $do$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM site_block b JOIN site_page p ON p.page_id = b.page_id
     WHERE p.key = 'home' AND b.type = 'feature_list'
  ) THEN
    INSERT INTO site_block (page_id, type, sort_order, is_visible, content)
    SELECT p.page_id, 'feature_list', 30, true, $j$
    {
      "title": {"fr": "Comment cela se passe", "en": "What working with us looks like"},
      "items": [
        {
          "title": {"fr": "Vous nous décrivez l'expédition",
                    "en": "You send us the shipment"},
          "text":  {"fr": "Une demande de devis ou un appel, avec l'origine, la destination et ce que vous déplacez.",
                    "en": "A quote request or a phone call, with the origin, the destination and what you are moving."}
        },
        {
          "title": {"fr": "Nous chiffrons et réservons",
                    "en": "We price and book"},
          "text":  {"fr": "Itinéraire, transporteur, traitement douanier et une proposition écrite que vous pouvez transmettre à qui décide.",
                    "en": "Routing, carrier, customs treatment and a written proposal you can forward to whoever approves it."}
        },
        {
          "title": {"fr": "Vous suivez le mouvement",
                    "en": "You watch it move"},
          "text":  {"fr": "Chaque étape sur une page de suivi, chaque document dans votre portail — sans relancer par courriel.",
                    "en": "Every stage on a tracking page, and every document in your portal — no chasing by email."}
        }
      ]
    }
    $j$::jsonb
      FROM site_page p
     WHERE p.key = 'home';
  END IF;
END
$do$;

-- ── The closing call to action ─────────────────────────────────────────────
-- Heading, lead and button only. The three numbered steps rendered beside this
-- band stay dictionary copy: they describe what the software does when a
-- request arrives — a reference on screen, one queue, a reply on the same
-- channel — and a tenant rewriting them would be describing behaviour the
-- product does not have. The `cta_band` schema has no field for them either.
-- Guarded by a DO block rather than by the INSERT's own WHERE NOT EXISTS.
-- Both are equally idempotent; only one is legible to
-- `scripts/db/check-migration-idempotency.js`, which reads a DO block as the
-- author's explicit catalog check and cannot see a guard buried in a SELECT.
-- `site_block` carries no unique key over (page_id, type) — a page may hold two
-- card grids — so there is no ON CONFLICT target to use instead.
DO $do$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM site_block b JOIN site_page p ON p.page_id = b.page_id
     WHERE p.key = 'home' AND b.type = 'cta_band'
  ) THEN
    INSERT INTO site_block (page_id, type, sort_order, is_visible, content)
    SELECT p.page_id, 'cta_band', 60, true, $j$
    {
      "title": {"fr": "Demander un devis", "en": "Get a quote"},
      "text":  {"fr": "Décrivez-nous votre expédition et nous revenons vers vous avec un prix.",
                "en": "Tell us about your shipment and we will come back with a price."},
      "cta":   {"label": {"fr": "Commencer une demande", "en": "Start a quote"},
                "href": "/quote"}
    }
    $j$::jsonb
      FROM site_page p
     WHERE p.key = 'home';
  END IF;
END
$do$;

-- ============================================================================
-- VERIFY
--   SELECT type, sort_order FROM site_block b JOIN site_page p USING (page_id)
--    WHERE p.key = 'home' ORDER BY sort_order;
--     -- hero 5, stat_counters 10, feature_list 30, cta_band 60, stat_chips 20
--   -- draft, so the site is unchanged:
--   -- GET /api/tenant/public/site/pages/home  -> 404
--   -- publish the page, reload the home page: the same words, now from the DB.
--
-- DOWN
--   DELETE FROM site_block
--    WHERE type IN ('hero','feature_list','cta_band')
--      AND page_id = (SELECT page_id FROM site_page WHERE key = 'home');
-- ============================================================================
