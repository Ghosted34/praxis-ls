"use strict";
/**
 * Website media — the upload control's server half (guide §6.3).
 *
 * ── WHAT WAS ALREADY BUILT, AND WHAT WAS MISSING ───────────────────────────
 *
 * 13788 widened the vault so a document can be scoped 'SITE', and every table
 * that needs one has its `*_vault_id` column and FK. Nothing could put a byte
 * into any of them: there was no upload path. §6.3 was carried out of PR 2, PR
 * 3 and PR 4 — §9.3 renders leaders with no portraits and §9.4 renders partners
 * with no logos until this file exists.
 *
 * ── IT IS `insight.setCover`, WITH THREE THINGS ADDED ──────────────────────
 *
 * The pattern is deliberately the one already in the tree: vault upload with a
 * SNIFFED content type, a size cap, an allow-list, the public scope set in the
 * same transaction, and the replaced document archived with its scope cleared
 * so old bytes stop being a public URL nobody remembers owning.
 *
 * What this adds, because the website needs it and an article cover does not:
 *
 *   1. PROVENANCE (§1.3). Recorded on the row and constrained by 13789. Every
 *      slot here is an evidence slot, so `generated` is refused at the door
 *      with the reason rather than at the constraint with an error code.
 *   2. TRANSPARENCY, for the two mark slots. See `assertUsable`.
 *   3. DERIVATIVES. AVIF and WebP at three widths, so a 2 MB portrait reaches a
 *      phone as 30 kB. §6.3: "this is where the page budget is won or lost".
 *
 * ── THE SLOT IS THE UNIT, NOT THE TABLE ────────────────────────────────────
 *
 * One endpoint, four slots, and the slot decides everything: which table owns
 * the row, which column holds the id, which vault role is written, what the
 * caps are, and whether the image has to be transparent. `SITE_MEDIA_SLOTS` in
 * `packages/shared` carries the half the upload control also needs — so a
 * tenant is told the constraint before the file dialog opens rather than after
 * a rejected upload — and `OWNERS` below carries the half that is nobody's
 * business but this file's.
 *
 * OWNERS IS A CLOSED TABLE AND ITS VALUES NEVER COME FROM A REQUEST. The slot
 * name is validated against an enum by the shared schema before it reaches
 * here; the table and column names are then looked up, never interpolated from
 * input. That is the SEC H3 rule — request-body keys must not become column
 * identifiers — applied to a lookup that would be trivially easy to write the
 * other way.
 */

const sharp = require("sharp");
const { atomically } = require("../../../shared/db/tx");
const { audit } = require("../../../shared/events/emit");
const { AppError } = require("../../../utils/errors");
const { parseDataUrl } = require("../../../utils/data-url");
const storage = require("../../../services/storage.service");
const vault = require("../../vault/document_vault/document_vault.service");
const events = require("./site_settings.events");
const {
  SITE_MEDIA_SLOTS,
} = require("@praxis/shared").siteSettings;

/** What the vault's own sniffer can verify (`document_vault.service.js`), and
 *  therefore what may be stored.
 *
 *  SVG IS NOT HERE, AND THAT IS THE ANSWER TO HALF OF O-3. Two reasons, and
 *  either alone is enough. The sniffer works on magic bytes and SVG has none —
 *  it is XML, so verifying one means parsing it, and `sniff: true` would have
 *  to be turned off for exactly the format that most needs it. And an SVG is
 *  markup executed by the browser: served from this app's own origin, a
 *  malicious one is stored XSS on the tenant's marketing site. §9.4 asks for
 *  "SVG or transparent PNG @2x"; the transparency check below is what makes the
 *  second half of that a real answer rather than a fallback. */
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];

/**
 * Slot → the row that owns the image.
 *
 * `publishable` is the clause that decides whether the bytes may be SERVED, and
 * it is not the same question as whether they may be stored. A portrait belongs
 * to a leader who may be inactive; a partner mark belongs to a row that may
 * have no clearance. Fail-closed, joined to the owner, and re-asserted on every
 * request — the shape `insight.repo.publicCoverForServe` uses and for the same
 * reason.
 *
 * `site_partner.is_active` carries `permission_note` with it: 13782's
 * `ck_site_partner_active_needs_permission` makes an active row without a note
 * impossible, so "active" here IS "cleared". That is why §9.7's assertion can
 * be made about the database rather than about a renderer.
 */
const OWNERS = {
  "leader-portrait": {
    refPrefix: "site_leader",
    event: events.LEADER_UPDATED,
    read: `SELECT photo_vault_id AS vault_id FROM site_leader WHERE leader_id = $1`,
    set: `UPDATE site_leader
             SET photo_vault_id = $2, updated_at = now(), updated_by = $3
           WHERE leader_id = $1 RETURNING *`,
    column: "photo_vault_id",
    serve: `SELECT v.doc_id, v.public_media_content_type, v.public_media_variants, v.storage_path
              FROM document_vault v
              JOIN site_leader o ON o.photo_vault_id = v.doc_id
             WHERE v.doc_id = $1
               AND v.status = 'VERIFIED'
               AND v.public_media_scope = 'SITE'
               AND v.public_media_role = $2
               AND v.public_media_content_type = ANY($3::text[])
               AND o.is_active = true`,
  },
  "partner-mark": {
    refPrefix: "site_partner",
    event: events.PARTNER_UPDATED,
    read: `SELECT logo_vault_id AS vault_id FROM site_partner WHERE partner_id = $1`,
    set: `UPDATE site_partner
             SET logo_vault_id = $2, updated_at = now(), updated_by = $3
           WHERE partner_id = $1 RETURNING *`,
    column: "logo_vault_id",
    /* `o.is_active` IS "cleared": 13782's ck_site_partner_active_needs_permission
       makes an active row without a permission_note impossible, so there is no
       state in which an uncleared mark has a live URL. */
    serve: `SELECT v.doc_id, v.public_media_content_type, v.public_media_variants, v.storage_path
              FROM document_vault v
              JOIN site_partner o ON o.logo_vault_id = v.doc_id
             WHERE v.doc_id = $1
               AND v.status = 'VERIFIED'
               AND v.public_media_scope = 'SITE'
               AND v.public_media_role = $2
               AND v.public_media_content_type = ANY($3::text[])
               AND o.is_active = true`,
  },
  "credential-mark": {
    refPrefix: "site_credential",
    event: events.CREDENTIAL_UPDATED,
    read: `SELECT logo_vault_id AS vault_id FROM site_credential WHERE credential_id = $1`,
    set: `UPDATE site_credential
             SET logo_vault_id = $2, updated_at = now(), updated_by = $3
           WHERE credential_id = $1 RETURNING *`,
    column: "logo_vault_id",
    /* Expiry is applied to the MARK as well as to the row: a strip that has
       dropped an expired credential should not still be serving its logo from a
       URL somebody bookmarked. */
    serve: `SELECT v.doc_id, v.public_media_content_type, v.public_media_variants, v.storage_path
              FROM document_vault v
              JOIN site_credential o ON o.logo_vault_id = v.doc_id
             WHERE v.doc_id = $1
               AND v.status = 'VERIFIED'
               AND v.public_media_scope = 'SITE'
               AND v.public_media_role = $2
               AND v.public_media_content_type = ANY($3::text[])
               AND o.is_active = true
               AND (o.expires_on IS NULL OR o.expires_on >= CURRENT_DATE)`,
  },
  "entity-cover": {
    refPrefix: "corporate_entity",
    event: events.ENTITY_STORY_UPDATED,
    read: `SELECT public_cover_vault_id AS vault_id FROM corporate_entity WHERE entity_id = $1`,
    /* `corporate_entity` has no `updated_by`, so this one takes two parameters
       where the other three take three. That difference is why each statement is
       written out rather than assembled: the assembled version needed a ternary
       to decide the parameter list, and a ternary that changes a query's arity
       is the kind of thing that is correct until somebody adds a fifth slot. */
    set: `UPDATE corporate_entity
             SET public_cover_vault_id = $2
           WHERE entity_id = $1 RETURNING *`,
    setParams: 2,
    column: "public_cover_vault_id",
    serve: `SELECT v.doc_id, v.public_media_content_type, v.public_media_variants, v.storage_path
              FROM document_vault v
              JOIN corporate_entity o ON o.public_cover_vault_id = v.doc_id
             WHERE v.doc_id = $1
               AND v.status = 'VERIFIED'
               AND v.public_media_scope = 'SITE'
               AND v.public_media_role = $2
               AND v.public_media_content_type = ANY($3::text[])
               AND o.public_enabled = true`,
  },
};


/**
 * The derivative ladder.
 *
 * Three widths and two formats, per §6.3. AVIF first in the `<picture>` the
 * renderer emits, because it is roughly 30% smaller than WebP at the same
 * quality on the flat-colour marks and the portraits this serves.
 *
 * A width is only WRITTEN when the original is at least that wide — sharp is
 * told never to enlarge, and a listed width that does not exist is a 404 per
 * visitor per image in a `srcset` the browser has already committed to.
 */
const VARIANT_WIDTHS = [480, 960, 1600];
const VARIANT_FORMATS = ["avif", "webp"];

/** The storage key of one derivative, derived from the original's.
 *
 *  THE ONE FUNCTION THAT KNOWS HOW A VARIANT IS NAMED. Both the writer and the
 *  serve route call it, so a variant cannot be written under a name the reader
 *  cannot rebuild — and no part of a request ever becomes part of a path: the
 *  width and the format are matched against the two constants above before this
 *  is reached. */
function variantKey(storagePath, width, format) {
  const base = String(storagePath).replace(/\.[a-z0-9]+$/i, "");
  return `${base}@${width}.${format}`;
}

/**
 * Is this image usable in this slot?
 *
 * ── THE TRANSPARENCY CHECK IS O-3, ENFORCED ────────────────────────────────
 *
 * §9.4: "Any logo without SVG/transparent PNG does not render — a white
 * rectangle on a dark band is worse than an absent logo." O-3 records that the
 * supplied marks are screen-resolution rasters with white backgrounds baked in.
 *
 * A note in a document does not stop that file being uploaded. `stats.isOpaque`
 * does: it is true when every pixel's alpha is 255, which is exactly "this
 * image has a background", whether it arrived as a JPEG (no alpha channel at
 * all) or as a PNG somebody exported with the canvas filled. The refusal names
 * the fix, because the person uploading is usually not the person who can
 * re-export it.
 *
 * Portraits and covers are NOT subject to it. They are photographs and sit on
 * their own plate; an opaque rectangle is what they are supposed to be.
 */
async function assertUsable(buffer, slot, spec) {
  let meta;
  let stats;
  try {
    const image = sharp(buffer, { failOn: "error" });
    meta = await image.metadata();
    stats = spec.transparent ? await image.stats() : null;
  } catch {
    // A buffer the vault's sniffer accepted but sharp cannot open is a
    // truncated or malformed file. Refused here rather than stored and found
    // later by a visitor's browser.
    throw new AppError("BAD_FILE_TYPE", "That image could not be read. Please re-export it.", 422);
  }

  const width = meta.width || 0;
  if (width < spec.minWidth) {
    throw new AppError(
      "VALIDATION_ERROR",
      `This slot needs an image at least ${spec.minWidth} px wide; that one is ${width} px.`,
      422,
      { data_url: [`Minimum width ${spec.minWidth} px.`] },
    );
  }

  if (spec.transparent && stats && stats.isOpaque) {
    throw new AppError(
      "VALIDATION_ERROR",
      "This mark needs a transparent background — every pixel in that file is opaque, so it would render as a white rectangle on the dark band. Export it as a PNG with transparency at twice the display size.",
      422,
      { data_url: ["Needs a transparent background (PNG with an alpha channel)."] },
    );
  }

  return { width, height: meta.height || 0 };
}

/**
 * Write the derivatives and return what was actually written.
 *
 * Failure to encode ONE variant is not a failure of the upload. The original is
 * already stored and servable, the renderer falls back to it, and refusing the
 * whole upload because libvips could not produce an AVIF would lose the
 * tenant's file over an optimisation. What is returned is the truth about what
 * exists — which is the whole reason `public_media_variants` records it rather
 * than the renderer assuming a fixed ladder.
 */
async function writeVariants(buffer, storagePath, sourceWidth) {
  const widths = VARIANT_WIDTHS.filter((w) => w <= sourceWidth);
  // A mark narrower than the smallest rung still gets one derivative at its own
  // width: the format change alone is most of the saving on a flat-colour logo.
  if (!widths.length) widths.push(sourceWidth);

  const written = { widths: [], formats: [] };
  for (const format of VARIANT_FORMATS) {
    const done = [];
    for (const width of widths) {
      try {
        const out = await sharp(buffer)
          .resize({ width, withoutEnlargement: true })
          .toFormat(format, { quality: format === "avif" ? 55 : 78 })
          .toBuffer();
        await storage.put(out, {
          key: variantKey(storagePath, width, format),
          contentType: `image/${format}`,
        });
        done.push(width);
      } catch {
        /* One rung, one format. See the note above: the original is already
           stored, and the renderer's `<picture>` degrades to it. Taxonomy:
           BEST_EFFORT — doc/ERROR_HANDLING.md. */
      }
    }
    if (done.length) {
      written.formats.push(format);
      for (const w of done) if (!written.widths.includes(w)) written.widths.push(w);
    }
  }
  written.widths.sort((a, b) => a - b);
  return written.formats.length ? written : null;
}

const ref = (prefix, id) => `${prefix}:${id}`;

/**
 * Put an image in a slot.
 *
 * Everything after the bytes are stored happens in one transaction: the vault
 * row is scoped public, the owning row is pointed at it, and the document it
 * replaced is archived with its scope cleared. Interleaving those is how a
 * tenant ends up with two public documents for one slot and no record of which
 * one the page is showing.
 */
async function upload(client, { slot, ownerId, dataUrl, originalName, provenance, actor = {}, slug }) {
  const spec = SITE_MEDIA_SLOTS[slot];
  const owner = OWNERS[slot];
  // Both come from a `z.enum` in the shared schema, so an unknown slot cannot
  // reach here through the route. The guard is for the OTHER callers — a seed
  // script, a repair task — where there is no validator in front.
  if (!spec || !owner) throw new AppError("VALIDATION_ERROR", `Unknown slot '${slot}'.`, 422);

  if (spec.evidence && provenance === "generated") {
    throw new AppError(
      "VALIDATION_ERROR",
      "A generated image cannot go in this slot. It sits beside a named person or a named company, so a visitor reads it as a photograph of your own operation — see the website guide §1.3. Atmosphere bands accept generated imagery; this does not.",
      422,
      { provenance: ["Generated imagery is not permitted in this slot."] },
    );
  }

  const parsed = parseDataUrl(dataUrl);
  if (!parsed || !IMAGE_TYPES.includes(parsed.mimeType)) {
    throw new AppError("BAD_FILE_TYPE", "An image must be PNG, JPEG or WebP", 422);
  }

  const before = await currentOwner(client, owner, ownerId);
  if (!before) throw new AppError("NOT_FOUND", "Not found", 404);

  const size = await assertUsable(parsed.buffer, slot, spec);

  const created = await vault.createDocument(client, {
    entityRef: ref(owner.refPrefix, ownerId),
    docType: "SITE_MEDIA",
    dataUrl,
    originalName,
    maxBytes: spec.maxBytes,
    allowedTypes: IMAGE_TYPES,
    // Sniffed, not trusted: the content type in a data URL is written by the
    // caller, and the public route serves these bytes to strangers with the
    // stored type in the header.
    sniff: true,
    slug,
    actor,
  });

  const stored = await client.query(
    `SELECT storage_path FROM document_vault WHERE doc_id = $1`,
    [created.doc_id],
  );
  const variants = await writeVariants(
    parsed.buffer,
    stored.rows[0]?.storage_path || "",
    size.width,
  );

  return atomically(client, async () => {
    await client.query(
      `UPDATE document_vault
          SET public_media_scope = 'SITE', public_media_entity_ref = $2,
              public_media_role = $3, public_media_content_type = $4,
              public_media_provenance = $5, public_media_variants = $6
        WHERE doc_id = $1`,
      [
        created.doc_id,
        ref(owner.refPrefix, ownerId),
        spec.role,
        parsed.mimeType,
        provenance,
        variants ? JSON.stringify(variants) : null,
      ],
    );
    const row = await setOwnerVaultId(client, owner, ownerId, created.doc_id, actor.user_id);
    if (before.vault_id && before.vault_id !== created.doc_id) {
      await archive(client, owner, before.vault_id, ref(owner.refPrefix, ownerId));
    }
    await audit(client, {
      actorUserId: actor.user_id || null,
      action: owner.event,
      moduleKey: events.MODULE,
      entityRef: ref(owner.refPrefix, ownerId),
      before: { [owner.column]: before.vault_id },
      after: { [owner.column]: created.doc_id, provenance },
    });
    return { ...row, doc_id: created.doc_id, provenance, variants };
  });
}

/** Take the image out of a slot. The document is ARCHIVED rather than deleted,
 *  because an audit entry may reference it and a hard delete would make that
 *  entry a dangling id — the rule `insight.removeCover` follows. */
async function remove(client, { slot, ownerId, actor = {} }) {
  const owner = OWNERS[slot];
  if (!owner) throw new AppError("VALIDATION_ERROR", `Unknown slot '${slot}'.`, 422);
  const before = await currentOwner(client, owner, ownerId);
  if (!before) throw new AppError("NOT_FOUND", "Not found", 404);
  if (!before.vault_id) return before.row;

  return atomically(client, async () => {
    const row = await setOwnerVaultId(client, owner, ownerId, null, actor.user_id);
    await archive(client, owner, before.vault_id, ref(owner.refPrefix, ownerId));
    await audit(client, {
      actorUserId: actor.user_id || null,
      action: owner.event,
      moduleKey: events.MODULE,
      entityRef: ref(owner.refPrefix, ownerId),
      before: { [owner.column]: before.vault_id },
      after: { [owner.column]: null },
    });
    return row;
  });
}

/* ── the queries, and why none of them is built ────────────────────────────
 *
 * EVERY STATEMENT ABOVE IS A LITERAL. The first version of this file assembled
 * them — `` `SELECT ${owner.vaultColumn} FROM ${owner.table} …` `` — from a
 * closed table keyed by a validated enum, which is safe and which CodeQL
 * correctly refused to believe: it traces `req.params.slot` into `OWNERS[slot]`
 * and out again into a query string, and it cannot know the table has four
 * hardcoded entries. It reported a high-severity `js/sql-injection`.
 *
 * The alert was a false positive and the fix is not a suppression, for the
 * reason F-8 already recorded about the route loop this module's own routes
 * file unrolled: a gate that cannot see a statement cannot vouch for it, and
 * "the validator was there" is not the point. SEC H3 exists because request-body
 * keys reached `insertOne` as column identifiers; a file that interpolates
 * identifiers at all is a file where that has to be re-proved by reading.
 *
 * So the table carries SQL instead of fragments. Nothing here concatenates,
 * every identifier is written where a reader can see it, and the only values
 * that move are bound parameters.
 */

async function currentOwner(client, owner, ownerId) {
  const { rows } = await client.query(owner.read, [ownerId]);
  return rows[0] || null;
}

async function setOwnerVaultId(client, owner, ownerId, docId, actorId) {
  const params = owner.setParams === 2
    ? [ownerId, docId]
    : [ownerId, docId, actorId || null];
  const { rows } = await client.query(owner.set, params);
  return rows[0];
}

/**
 * Archive a replaced document and strip what made it publicly servable.
 *
 * Scoped to the owning row in the WHERE clause, so a doc id belonging to
 * another owner cannot be archived through this path. Every identifier here is
 * a literal — `document_vault`'s own columns — so unlike the four statements in
 * `OWNERS` this one never needed a per-slot version.
 *
 * ARCHIVED rather than deleted, because an audit entry may reference the
 * document and a hard delete would make that entry a dangling id. The rule
 * `insight.removeCover` follows, for the same reason.
 */
function archive(client, owner, docId, entityRef) {
  return client.query(
    `UPDATE document_vault
        SET status = 'ARCHIVED', public_media_scope = NULL,
            public_media_entity_ref = NULL, public_media_role = NULL,
            public_media_content_type = NULL, public_media_provenance = NULL,
            public_media_variants = NULL
      WHERE doc_id = $1 AND public_media_scope = 'SITE'
        AND public_media_entity_ref = $2`,
    [docId, entityRef],
  );
}

/**
 * One image, for the PUBLIC media route.
 *
 * Fail-closed on every clause, and the owner join is the important one: the
 * document must still be the one its owner points at, and that owner must still
 * be publishable. So a portrait stops being servable the moment the leader is
 * deactivated, a partner mark the moment its clearance is withdrawn (13782
 * makes `is_active` and `permission_note` inseparable), and an entity cover the
 * moment `public_enabled` goes off — without anything having to remember to go
 * and archive the document.
 *
 * Tried in slot order and short-circuits. Four small queries against a primary
 * key beat one four-way UNION that is harder to read and no faster.
 */
async function publicMediaForServe(client, docId) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(docId || ""))) {
    return null;
  }
  for (const [slot, owner] of Object.entries(OWNERS)) {
    const spec = SITE_MEDIA_SLOTS[slot];
    const { rows } = await client.query(owner.serve, [docId, spec.role, IMAGE_TYPES]);
    if (rows[0]) return rows[0];
  }
  return null;
}

/**
 * Resolve a requested derivative against what the document actually has.
 *
 * Returns `null` for anything not listed on the row, which is what makes this
 * safe: the width and the format in the URL are compared against the recorded
 * set before `variantKey` is called, so no request string reaches a storage
 * path. A variant nobody wrote is a 404 rather than a read of a guessed key.
 */
function resolveVariant(doc, width, format) {
  const v = doc.public_media_variants;
  if (!v || !Array.isArray(v.widths) || !Array.isArray(v.formats)) return null;

  /* ── THE VALUES THAT REACH `variantKey` COME FROM THE ROW, NOT THE URL ───
   *
   * `find` rather than `includes`, and that is the whole point of the shape.
   * `includes` would prove the request's value is ON the list and then pass the
   * REQUEST's value onward — safe, and impossible for a static analyser to
   * confirm, because the string that reaches the storage key still originates
   * at `req.params`. CodeQL read it exactly that way and reported a
   * path-injection.
   *
   * `find` returns the element OF THE LIST. So `w` is the number the upload
   * recorded and `f` is the format string it recorded; the request's own
   * characters are used for comparison and then discarded. The guarantee stops
   * being "we checked" and becomes "the request cannot contribute a byte to a
   * path", which is the version a reader — and a scanner — can confirm without
   * following the check backwards.
   *
   * The digit test stays for the reason it was added: `Number("960.0")` is 960,
   * and a guarantee that holds only because of a regex in the route file is one
   * refactor from not holding. */
  if (!/^\d+$/.test(String(width))) return null;
  const asked = Number(width);
  const w = v.widths.find((known) => known === asked);
  if (w === undefined) return null;
  const f = v.formats.find((known) => known === format);
  if (f === undefined || !VARIANT_FORMATS.includes(f)) return null;

  return { key: variantKey(doc.storage_path, w, f), contentType: `image/${f}` };
}

module.exports = {
  IMAGE_TYPES,
  OWNERS,
  VARIANT_WIDTHS,
  VARIANT_FORMATS,
  variantKey,
  upload,
  remove,
  publicMediaForServe,
  resolveVariant,
};
