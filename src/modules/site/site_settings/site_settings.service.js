"use strict";
/**
 * Website settings — the tenant's colours, faces, social links, partners,
 * credentials, group story and leadership.
 *
 * ── THE ONE PIECE OF REAL LOGIC IN HERE ────────────────────────────────────
 *
 * `publicTheme()`. Everything else is CRUD over small tables; this is the read
 * that turns three hex values into a complete, accessible, two-theme token set
 * by calling the shared palette engine.
 *
 * It runs SERVER-SIDE on purpose. `public-web` has roughly 11 kB of gzipped
 * first-paint headroom, and importing `@praxis/shared` there pulls Zod and the
 * ISO country tables through a CommonJS interop boundary to do arithmetic a
 * server can do once and cache. Deriving here also means the settings preview
 * and the live site cannot disagree: both read this endpoint's output rather
 * than each running their own copy of the maths.
 *
 * The engine is imported by DEEP PATH (`@praxis/shared/design/palette`) rather
 * than from the package root, for the same reason it is not re-exported from
 * `index.js` — see the note there.
 */

const { atomically } = require("../../../shared/db/tx");
const { audit } = require("../../../shared/events/emit");
// The careers switches live in the HR module's own repo because that is what
// reads them on the public path; this module owns the AUTHENTICATED side of the
// same two rows. A plain top-level require, because there is no cycle to break:
// careers.repo imports nothing but its own SQL.
const careersRepo = require("../../hr/careers/careers.repo");
const { AppError } = require("../../../utils/errors");
const events = require("./site_settings.events");
const repo = require("./site_settings.repo");
const { derivePalette } = require("@praxis/shared/design/palette");
const {
  resolveSiteFont,
  SITE_FONT_ROLES,
  SITE_FONT_DEFAULTS,
} = require("@praxis/shared/design/site-fonts");
const { SOCIAL_IDS, isValidSocialUrl } = require("@praxis/shared/design/social");

const ref = (kind, id) => `${kind}:${id}`;

/* ── theme ──────────────────────────────────────────────────────────────────*/

async function getTheme(client) {
  // The singleton is seeded by 13780, so this is never null in practice. The
  // fallback exists for a database restored from a partial backup: the default
  // palette is a better answer than a 500 on the tenant's home page.
  return (await repo.getTheme(client)) || {
    primary_hex: "#ff5a00",
    secondary_hex: null,
    tertiary_hex: null,
    // From the registry, not written out here. Two reasons, and the second is
    // the one that bit: a second copy of the defaults drifts the day a face
    // changes, and `scripts/check-fonts.mjs` reads a bare "jetbrains-mono" as a
    // FAMILY NAME outside the shipped library — it cannot tell an id from a
    // font-family, and it is not wrong to complain about a string that looks
    // like one.
    font_display: SITE_FONT_DEFAULTS.display,
    font_body: SITE_FONT_DEFAULTS.body,
    font_mono: SITE_FONT_DEFAULTS.mono,
    radius_px: 10,
    default_mode: "light",
  };
}

async function updateTheme(client, { patch, actor = {} }) {
  // Fonts are checked against what public-web can actually RENDER, not against
  // the ERP's seventeen-family library. A face the site does not self-host
  // resolves to a stack no @font-face declares and the browser falls silently
  // through — see packages/shared/design/site-fonts.js.
  for (const role of ["display", "body", "mono"]) {
    const key = `font_${role}`;
    if (patch[key] !== undefined && !SITE_FONT_ROLES[role].includes(patch[key])) {
      throw new AppError(
        "VALIDATION_ERROR",
        `The website can only render ${SITE_FONT_ROLES[role].join(", ")} as its ${role} face.`,
        422,
        { [key]: [`Not available on the public site.`] },
      );
    }
  }

  return atomically(client, async () => {
    const before = await repo.getTheme(client);
    const row = await repo.updateTheme(client, patch, actor.user_id);
    await audit(client, {
      actorUserId: actor.user_id || null,
      action: events.THEME_UPDATED,
      moduleKey: events.MODULE,
      entityRef: "site_theme:singleton",
      before,
      after: row,
    });
    return row;
  });
}

/**
 * The theme a visitor's browser gets: the tenant's input, the engine's derived
 * tokens for both themes, and the resolved font ids.
 *
 * `corrections` travels with it deliberately. The settings preview shows a
 * tenant, in words, that their orange failed as text at 3.1:1 and what it
 * became — the same array, from the same call, so the explanation cannot drift
 * from the palette it explains.
 */
async function publicTheme(client) {
  const row = await getTheme(client);
  const palette = derivePalette({
    primary: row.primary_hex,
    secondary: row.secondary_hex,
    tertiary: row.tertiary_hex,
    // The public site harmonises transport-mode colours toward the tenant's
    // palette; the ERP passes false and keeps its fixed values. See
    // doc/PUBLIC_WEB_EXPERIENCE_GUIDE.md §1.4.
    harmoniseModes: true,
  });
  return {
    input: {
      primary: row.primary_hex,
      secondary: row.secondary_hex,
      tertiary: row.tertiary_hex,
    },
    fonts: {
      display: resolveSiteFont("display", row.font_display),
      body: resolveSiteFont("body", row.font_body),
      mono: resolveSiteFont("mono", row.font_mono),
    },
    radius: `${row.radius_px}px`,
    defaultMode: row.default_mode,
    light: palette.light,
    dark: palette.dark,
    corrections: palette.meta.corrections,
    derived: palette.meta.derived,
  };
}

/* ── social ─────────────────────────────────────────────────────────────────*/

const listSocial = (client) => repo.listSocial(client);

/**
 * Save the whole set in one call, because that is what the screen is: one row
 * per platform, all of them visible, Save meaning "this is the set now".
 *
 * A blank URL DELETES. Absence is the empty state (13781) — storing an empty
 * string would put a footer icon on the tenant's site linking nowhere.
 */
async function saveSocial(client, { links, actor = {} }) {
  const entries = Object.entries(links || {});
  for (const [platform, url] of entries) {
    if (!SOCIAL_IDS.includes(platform)) {
      throw new AppError("VALIDATION_ERROR", `Unknown platform '${platform}'.`, 422, {
        platform: [`Must be one of: ${SOCIAL_IDS.join(", ")}`],
      });
    }
    const trimmed = String(url || "").trim();
    if (trimmed && !isValidSocialUrl(platform, trimmed)) {
      throw new AppError("VALIDATION_ERROR", `That is not a ${platform} link.`, 422, {
        [platform]: ["Must be an https link on that platform's own domain."],
      });
    }
  }

  return atomically(client, async () => {
    const before = await repo.listSocial(client);
    for (const [platform, url] of entries) {
      const trimmed = String(url || "").trim();
      if (trimmed) await repo.setSocial(client, platform, trimmed, actor.user_id);
      else await repo.clearSocial(client, platform);
    }
    const after = await repo.listSocial(client);
    await audit(client, {
      actorUserId: actor.user_id || null,
      action: events.SOCIAL_UPDATED,
      moduleKey: events.MODULE,
      entityRef: "site_social_link:all",
      before,
      after,
    });
    return after;
  });
}

/* ── a small CRUD factory ───────────────────────────────────────────────────*/

/**
 * Partners, credentials and leaders are the same shape: a flat row, list /
 * create / update / delete, audited, with a NOT_FOUND on a missing id. Writing
 * that four times is four places for the audit call to be forgotten in.
 *
 * The factory takes only what actually differs — the repo functions, the ref
 * prefix and the event names — so a reader can see at a glance that the three
 * resources behave identically, which they should.
 */
function crud({ name, idKey, list, get, create, update, remove, created, updated, deleted }) {
  return {
    list,
    async create(client, { patch, actor = {} }) {
      return atomically(client, async () => {
        const row = await create(client, patch, actor.user_id);
        await audit(client, {
          actorUserId: actor.user_id || null,
          action: created,
          moduleKey: events.MODULE,
          entityRef: ref(name, row[idKey]),
          after: row,
        });
        return row;
      });
    },
    async update(client, { id, patch, actor = {} }) {
      const before = await get(client, id);
      if (!before) throw new AppError("NOT_FOUND", "Not found", 404);
      return atomically(client, async () => {
        const row = await update(client, id, patch, actor.user_id);
        await audit(client, {
          actorUserId: actor.user_id || null,
          action: updated,
          moduleKey: events.MODULE,
          entityRef: ref(name, id),
          before,
          after: row,
        });
        return row;
      });
    },
    async remove(client, { id, actor = {} }) {
      const before = await get(client, id);
      if (!before) throw new AppError("NOT_FOUND", "Not found", 404);
      return atomically(client, async () => {
        await remove(client, id);
        await audit(client, {
          actorUserId: actor.user_id || null,
          action: deleted,
          moduleKey: events.MODULE,
          entityRef: ref(name, id),
          before,
        });
        return { deleted: true };
      });
    },
  };
}

const partners = crud({
  name: "site_partner",
  idKey: "partner_id",
  list: repo.listPartners, get: repo.getPartner,
  create: repo.createPartner, update: repo.updatePartner, remove: repo.deletePartner,
  created: events.PARTNER_CREATED, updated: events.PARTNER_UPDATED, deleted: events.PARTNER_DELETED,
});

const credentials = crud({
  name: "site_credential",
  idKey: "credential_id",
  list: repo.listCredentials, get: repo.getCredential,
  create: repo.createCredential, update: repo.updateCredential, remove: repo.deleteCredential,
  created: events.CREDENTIAL_CREATED, updated: events.CREDENTIAL_UPDATED, deleted: events.CREDENTIAL_DELETED,
});

const leaders = crud({
  name: "site_leader",
  idKey: "leader_id",
  list: repo.listLeaders, get: repo.getLeader,
  create: repo.createLeader, update: repo.updateLeader, remove: repo.deleteLeader,
  created: events.LEADER_CREATED, updated: events.LEADER_UPDATED, deleted: events.LEADER_DELETED,
});

/* ── careers (13792) ────────────────────────────────────────────────────────*/

/**
 * The two switches on the careers page, read and written from the WEBSITE
 * permission rather than the HR one.
 *
 * That split is the same judgement the entity-story routes below record: the
 * rows live next to recruitment, but what they decide is what a page on the
 * tenant's public site offers a stranger. A marketing administrator who may
 * write the homepage should be able to turn open applications on without also
 * holding MOD-11, which carries every candidate's salary expectation and score.
 *
 * Reading is separate from `careers.service.publicSettings`, which serves the
 * same rows to the public: this one returns the ROW, stamps and all, because
 * the person reading it is signed in and the settings screen wants to show who
 * changed it last.
 */
const getCareers = (client) => careersRepo.getSettings(client);

async function updateCareers(client, { patch, actor = {} }) {
  return atomically(client, async () => {
    const before = await careersRepo.getSettings(client);
    const row = await careersRepo.updateSettings(client, patch, actor.user_id);
    await audit(client, {
      actorUserId: actor.user_id || null,
      action: events.CAREERS_UPDATED,
      moduleKey: events.MODULE,
      entityRef: "site_careers:singleton",
      before,
      after: row,
    });
    return row;
  });
}

/* ── about ──────────────────────────────────────────────────────────────────*/

const getAbout = (client) => repo.getAbout(client);

async function updateAbout(client, { patch, actor = {} }) {
  return atomically(client, async () => {
    const before = await repo.getAbout(client);
    const row = await repo.updateAbout(client, patch, actor.user_id);
    await audit(client, {
      actorUserId: actor.user_id || null,
      action: events.ABOUT_UPDATED,
      moduleKey: events.MODULE,
      entityRef: "site_about:singleton",
      before,
      after: row,
    });
    return row;
  });
}

/* ── an entity's public story ───────────────────────────────────────────────*/

const getEntityStory = (client, entityId) => repo.getEntityStory(client, entityId);

async function updateEntityStory(client, { entityId, patch, actor = {} }) {
  const before = await repo.getEntityStory(client, entityId);
  if (!before) throw new AppError("NOT_FOUND", "Entity not found", 404);
  return atomically(client, async () => {
    const row = await repo.updateEntityStory(client, entityId, patch);
    await audit(client, {
      actorUserId: actor.user_id || null,
      action: events.ENTITY_STORY_UPDATED,
      moduleKey: events.MODULE,
      entityRef: ref("corporate_entity", entityId),
      before,
      after: row,
    });
    return row;
  });
}

/* ── the stranger-facing reads ──────────────────────────────────────────────
 *
 * Everything below is served to the open internet by `site_public`. The rule
 * for all of it is the same and it is worth stating once: these functions build
 * an EXPLICIT object, field by field, rather than handing back a row with a few
 * columns deleted.
 *
 * The difference matters the day somebody adds a column. A `delete row.secret`
 * style redaction publishes every future column by default and fails silently;
 * an allow-list publishes nothing new until a person writes the field name
 * down. On a table that holds RCCM numbers, cap-table references and the note
 * recording who cleared a trademark, that default is the whole design.
 */

/**
 * Partners and credentials, for the public site.
 *
 * `permission_note` NEVER leaves the building. It is an internal record of who
 * cleared a third-party mark — "verbal OK from their marketing lead, 3 Feb" —
 * and it is nobody's business but the tenant's.
 *
 * Credentials filter on expiry here rather than in the renderer: an expired
 * licence number presented as current is the single most damaging thing a
 * forwarder can publish, and the filter belongs where it cannot be forgotten.
 */
/**
 * The derivative ladder for a set of documents, as `{ docId: {widths, formats} }`.
 *
 * ── WHY THE PUBLIC READS CARRY THIS AND NOT A LIST OF URLS ────────────────
 *
 * The renderer needs a `srcset`, and a `srcset` naming a width that was never
 * written is a 404 per visitor per image — the browser has already committed to
 * the candidate it picked. So the ladder is published as DATA and the URL is
 * built by the client from the document id, which is the shape the rest of this
 * app already uses (`/public/site/media/:id`).
 *
 * `public_media_variants` is NULL for a document uploaded before 13789 and for
 * one whose derivatives all failed to encode. Both mean the same thing to a
 * renderer — serve the original — so both answer `null` here rather than an
 * empty ladder a `<source>` would be emitted for.
 *
 * One query for every id on the page. The alternative is a join inside each of
 * the three reads, which would put the same LEFT JOIN in three places and make
 * "does this row still point at that document" a question asked three different
 * ways.
 */
async function mediaVariants(client, ids) {
  const wanted = [...new Set(ids.filter(Boolean))];
  if (!wanted.length) return {};
  const { rows } = await client.query(
    `SELECT doc_id, public_media_variants
       FROM document_vault
      WHERE doc_id = ANY($1::uuid[])
        AND public_media_scope = 'SITE'
        AND public_media_variants IS NOT NULL`,
    [wanted],
  );
  return Object.fromEntries(rows.map((r) => [r.doc_id, r.public_media_variants]));
}

async function publicPartners(client) {
  const partners = (await repo.listPartners(client))
    /* TWO CONDITIONS, AND THE SECOND ONE IS DELIBERATELY REDUNDANT.
 
       13782's `ck_site_partner_active_needs_permission` makes an active row
       without a permission note impossible, so `is_active` alone already
       carries both facts today. The note is checked anyway, for the reason
       13782's own header gives about why that constraint exists at all: "three
       layers because the cost of the check is nil and the cost of publishing
       an uncleared mark is a letter from someone's counsel".
 
       It also turns §9.7's requirement — "every partner rendered has a
       permission_note, asserted by a test, not by inspection" — into something
       a test can actually assert. With only `is_active`, a test would have to
       construct a row the database forbids and would be proving the
       constraint, not this read. */
    .filter((p) => p.is_active && String(p.permission_note || "").trim() !== "")
    .map((p) => ({
      id: p.partner_id,
      name: p.name,
      kind: p.kind,
      logo_id: p.logo_vault_id || null,
      url: p.url || null,
    }));

  const today = new Date().toISOString().slice(0, 10);
  const credentials = (await repo.listCredentials(client))
    .filter((c) => c.is_active)
    .filter((c) => !c.expires_on || String(c.expires_on).slice(0, 10) >= today)
    .map((c) => ({
      id: c.credential_id,
      name: c.name,
      issuer: c.issuer || null,
      identifier: c.identifier || null,
      issued_on: c.issued_on || null,
      expires_on: c.expires_on || null,
      logo_id: c.logo_vault_id || null,
      url: c.url || null,
    }));

  const variants = await mediaVariants(client, [
    ...partners.map((p) => p.logo_id),
    ...credentials.map((c) => c.logo_id),
  ]);
  const withLadder = (row) => ({ ...row, logo_variants: variants[row.logo_id] || null });

  return {
    partners: partners.map(withLadder),
    credentials: credentials.map(withLadder),
  };
}

/** Only platforms with a URL. Absence is the empty state — the footer draws
 *  what is here and nothing else. */
const publicSocial = (client) => repo.listSocial(client);

/** One leadership card. Shared by the group read and the entity read so the two
 *  cannot disagree about what a leader is.
 *
 *  `variants` is the ladder map from `mediaVariants`; it is passed in rather
 *  than looked up here so one query serves every portrait on a page. */
const publicLeader = (l, variants = {}) => ({
  id: l.leader_id,
  name: l.full_name,
  role: { fr: l.role_fr, en: l.role_en },
  bio: { fr: l.bio_fr, en: l.bio_en },
  photo_id: l.photo_vault_id || null,
  photo_variants: variants[l.photo_vault_id] || null,
  linkedin_url: l.linkedin_url || null,
});

/** The group story plus group-level leadership (entity_id IS NULL). */
async function publicAbout(client) {
  const about = (await repo.getAbout(client)) || {};
  // The repo already restricts to `entity_id IS NULL`, and the tier is
  // re-asserted here in JS on purpose. The guarantee "the group's About never
  // shows a subsidiary's country manager" is the kind that should be visible at
  // the point it matters rather than living only inside a SQL string one
  // refactor away from a WHERE clause somebody widened. It also makes the
  // invariant testable without a database.
  const leaders = (await repo.listLeaders(client, { entityId: null }))
    .filter((l) => l.is_active && !l.entity_id);
  const variants = await mediaVariants(client, leaders.map((l) => l.photo_vault_id));
  return {
    headline: { fr: about.headline_fr, en: about.headline_en },
    summary: { fr: about.summary_fr, en: about.summary_en },
    mission: { fr: about.mission_fr, en: about.mission_en },
    vision: { fr: about.vision_fr, en: about.vision_en },
    principles: about.principles || [],
    esg: about.esg || {},
    timeline: about.timeline || [],
    founded_year: about.founded_year ?? null,
    headquarters: about.headquarters ?? null,
    leaders: leaders.map((l) => publicLeader(l, variants)),
  };
}

/**
 * Public-enabled entities, with their leadership.
 *
 * ── WHAT IS NOT HERE, AND WHY IT IS A DECISION ─────────────────────────────
 *
 * `corporate_entity` carries `rccm`, `niu`, legal form, incorporation date, the
 * cap table and governance. None of it is selected. See 13787's header for the
 * argument in full; the short version is that a trade-register number changes
 * no reader's decision and is most of what somebody needs to impersonate a
 * company to its own suppliers.
 *
 * `tests/unit/site-public-redaction.test.js` asserts on the SERIALISED body
 * rather than on this function's shape, because a redaction that is only a
 * SELECT list is one refactor away from leaking.
 */
async function publicEntities(client) {
  const { rows } = await client.query(
    `SELECT entity_id, code, legal_name, trading_name, country_code,
            public_summary_fr, public_summary_en, public_coverage, public_focus,
            public_cover_vault_id
       FROM corporate_entity
      WHERE public_enabled = true
      ORDER BY legal_name`,
  );
  const leaders = (await repo.listLeaders(client)).filter((l) => l.is_active && l.entity_id);
  const variants = await mediaVariants(client, [
    ...rows.map((e) => e.public_cover_vault_id),
    ...leaders.map((l) => l.photo_vault_id),
  ]);
  return rows.map((e) => ({
    id: e.entity_id,
    code: e.code,
    legal_name: e.legal_name,
    trading_name: e.trading_name || null,
    country_code: e.country_code,
    summary: { fr: e.public_summary_fr, en: e.public_summary_en },
    coverage: e.public_coverage || [],
    focus: e.public_focus || [],
    cover_id: e.public_cover_vault_id || null,
    cover_variants: variants[e.public_cover_vault_id] || null,
    leaders: leaders
      .filter((l) => l.entity_id === e.entity_id)
      .map((l) => publicLeader(l, variants)),
  }));
}

module.exports = {
  getTheme, updateTheme, publicTheme,
  mediaVariants,
  listSocial, saveSocial,
  partners, credentials, leaders,
  getAbout, updateAbout,
  getCareers, updateCareers,
  getEntityStory, updateEntityStory,
  publicPartners, publicSocial, publicAbout, publicEntities,
};
